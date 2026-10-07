import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  FIXTURE_IDS,
  loadWebhookFixtureText,
  type WebhookFixtureName,
} from "../../../test/support/fixtures";
import { signFixture } from "../../../test/support/sign";
import { memoryAdapter } from "../../adapters/memory";
import { ConfigError, RecordNotFoundError } from "../../errors/errors";
import type { Transport } from "../../transport/types";
import type { Account } from "../../types/entities";
import type { AgentDispatcher } from "../context";
import { createWhatsApp } from "../create-whatsapp";
import type { ConversationStatusEvent, MessageEvent, StatusEvent, UnroutedEvent } from "../events";
import {
  GRAPH,
  TOKENS,
  acceptSends,
  accountInput,
  burstWebhook,
  makeClient,
  openConversation,
  useGraphServer,
  type ClientOptions,
} from "../test-utils";

const graph = useGraphServer();
const SECRET = "app-secret-value";
const URL_BASE = "https://app.example/api/whatsapp";
const DAY_MS = 24 * 60 * 60 * 1000;
const IMAGE_MEDIA_ID = "300000000000001";
const LOOKASIDE = "https://lookaside.example/media/300000000000001";

/** A fixture name or a raw JSON body. */
type Body = string;

function bodyOf(body: Body): string {
  return body.trimStart().startsWith("{")
    ? body
    : loadWebhookFixtureText(body as WebhookFixtureName);
}

function postRequest(body: Body, secret = SECRET): Request {
  const signed = signFixture(bodyOf(body), secret);
  return new Request(URL_BASE, { method: "POST", headers: signed.headers, body: signed.body });
}

interface MessagePatch {
  id?: string;
  timestamp?: Date;
  profileName?: string;
  body?: string;
}

/** The `text` fixture with a different message id, time, profile name or body. */
function textBody(patch: MessagePatch = {}): string {
  const json = JSON.parse(loadWebhookFixtureText("text")) as {
    entry: { changes: { value: Record<string, unknown> }[] }[];
  };
  const value = json.entry[0]?.changes[0]?.value as {
    contacts: { profile: { name: string } }[];
    messages: { id: string; timestamp: string; text: { body: string } }[];
  };
  const message = value.messages[0];
  const contact = value.contacts[0];
  if (!message || !contact) throw new Error("text fixture changed");
  if (patch.id) message.id = patch.id;
  if (patch.timestamp) message.timestamp = String(Math.floor(patch.timestamp.getTime() / 1000));
  if (patch.body) message.text.body = patch.body;
  if (patch.profileName) contact.profile.name = patch.profileName;
  return JSON.stringify(json);
}

async function setup(options: ClientOptions = {}) {
  const client = makeClient(options);
  const account = await client.adapter.accounts.insert(
    accountInput({ phoneNumberId: FIXTURE_IDS.phoneNumberId, wabaId: FIXTURE_IDS.wabaId }),
  );
  const messages: MessageEvent[] = [];
  const statuses: StatusEvent[] = [];
  client.wa.on("message", (e) => {
    messages.push(e);
  });
  client.wa.on("status", (e) => {
    statuses.push(e);
  });

  /** Posts a signed body and waits for the background work. */
  async function deliver(body: Body) {
    const tasks: Promise<unknown>[] = [];
    const response = await client.wa.handleWebhook(postRequest(body), {
      waitUntil: (p) => tasks.push(p),
    });
    expect(response.status).toBe(200);
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    const [event] = [...client.adapter.__state.events.values()].slice(-1);
    if (!event) throw new Error("no event stored");
    return event;
  }

  return { ...client, account, messages, statuses, deliver };
}

function writeCount(state: ReturnType<typeof makeClient>["adapter"]["__state"]): number {
  return (
    state.contacts.size +
    state.conversations.size +
    state.messages.size +
    state.placeholders.size +
    state.media.size +
    state.events.size +
    state.storage.size
  );
}

const downloadHandler = (bytes = new Uint8Array([1, 2, 3, 4])) =>
  http.get(LOOKASIDE, () => new HttpResponse(bytes, { headers: { "content-type": "image/jpeg" } }));

function mediaHandlers(bytes = new Uint8Array([1, 2, 3, 4])) {
  return [
    http.get(`${GRAPH}/${IMAGE_MEDIA_ID}`, () =>
      HttpResponse.json({
        url: LOOKASIDE,
        mime_type: "image/jpeg",
        sha256: "abc123",
        file_size: bytes.byteLength,
        id: IMAGE_MEDIA_ID,
      }),
    ),
    downloadHandler(bytes),
  ];
}

describe("wa.handleWebhook — synchronous part", () => {
  it("answers Meta's GET challenge with the verify token", async () => {
    const { wa } = makeClient();
    const ok = await wa.handleWebhook(
      new Request(
        `${URL_BASE}?hub.mode=subscribe&hub.verify_token=verify-token-value&hub.challenge=4242`,
      ),
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("4242");

    const bad = await wa.handleWebhook(
      new Request(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=4242`),
    );
    expect(bad.status).toBe(403);
  });

  it("returns 401 and writes nothing for a bad or missing signature", async () => {
    const { wa, adapter } = makeClient();
    const insert = vi.spyOn(adapter.events, "insert");
    const tasks: Promise<unknown>[] = [];

    const wrong = await wa.handleWebhook(postRequest("text", "another-secret"), {
      waitUntil: (p) => tasks.push(p),
    });
    const missing = await wa.handleWebhook(
      new Request(URL_BASE, { method: "POST", body: loadWebhookFixtureText("text") }),
    );
    const tampered = signFixture(loadWebhookFixtureText("text"), SECRET);
    const changed = await wa.handleWebhook(
      new Request(URL_BASE, {
        method: "POST",
        headers: tampered.headers,
        body: tampered.body.replace("Hola", "Adios"),
      }),
    );

    expect([wrong.status, missing.status, changed.status]).toEqual([401, 401, 401]);
    expect(insert).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(0);
    expect(writeCount(adapter.__state)).toBe(0);
  });

  it("returns 400 for a signed body that is not JSON", async () => {
    const { wa, adapter } = makeClient();
    const response = await wa.handleWebhook(postRequest("{not json"));
    expect(response.status).toBe(400);
    expect(adapter.__state.events.size).toBe(0);
  });

  it("returns 405 for other methods", async () => {
    const { wa } = makeClient();
    const response = await wa.handleWebhook(new Request(URL_BASE, { method: "PUT", body: "x" }));
    expect(response.status).toBe(405);
  });

  it("stores the event as received and responds before slow background work finishes", async () => {
    const { wa, adapter, messages } = await setup();
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
      setTimeout(resolve, 2000);
    });
    wa.on("message", () => slow);

    const started = performance.now();
    const response = await wa.handleWebhook(postRequest("text"));
    const elapsed = performance.now() - started;

    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(500);
    const [event] = [...adapter.__state.events.values()];
    expect(event?.status).toBe("received");
    expect(event?.payload).toEqual(JSON.parse(loadWebhookFixtureText("text")));

    await vi.waitFor(() => {
      expect(messages).toHaveLength(1);
    });
    expect(adapter.__state.events.get(event?.id ?? "")?.status).toBe("received");
    release();
    await vi.waitFor(() => {
      expect(adapter.__state.events.get(event?.id ?? "")?.status).toBe("processed");
    });
  }, 10_000);

  it("keeps processing detached and logs when waitUntil throws", async () => {
    const { wa, adapter, logs } = await setup();
    const response = await wa.handleWebhook(postRequest("text"), {
      waitUntil: () => {
        throw new Error("no request scope");
      },
    });
    expect(response.status).toBe(200);
    await vi.waitFor(() => {
      expect([...adapter.__state.events.values()][0]?.status).toBe("processed");
    });
    expect(logs.of("warn").some((line) => line.includes("waitUntil"))).toBe(true);
  });

  it("delegates to a custom transport's handleWebhook, else throws ConfigError", async () => {
    const base: Omit<Transport, "handleWebhook"> = {
      kind: "custom",
      send: () => Promise.reject(new Error("unused")),
      fetchMedia: () => Promise.reject(new Error("unused")),
    };
    const delegated = createWhatsApp({
      adapter: memoryAdapter(),
      transport: { ...base, handleWebhook: () => Promise.resolve(new Response("relay")) },
    });
    expect(await (await delegated.handleWebhook(postRequest("text"))).text()).toBe("relay");

    const bare = createWhatsApp({ adapter: memoryAdapter(), transport: base });
    await expect(bare.handleWebhook(postRequest("text"))).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("processEvent — routing, contacts, dedupe and conversations", () => {
  it("marks an unknown phone_number_id unrouted, warns, emits and writes nothing else", async () => {
    const { wa, adapter, logs, deliver, messages } = await setup();
    const unrouted: UnroutedEvent[] = [];
    wa.on("event.unrouted", (e) => {
      unrouted.push(e);
    });

    const event = await deliver("unrouted-phone-number");

    expect(adapter.__state.events.get(event.id)?.status).toBe("unrouted");
    expect(unrouted).toEqual([
      {
        phoneNumberId: FIXTURE_IDS.unroutedPhoneNumberId,
        raw: JSON.parse(loadWebhookFixtureText("unrouted-phone-number")) as unknown,
      },
    ]);
    expect(logs.of("warn").some((line) => line.includes(FIXTURE_IDS.unroutedPhoneNumberId))).toBe(
      true,
    );
    expect(messages).toHaveLength(0);
    expect(writeCount(adapter.__state)).toBe(1);
  });

  it("stores the inbound message, contact, conversation and emits message", async () => {
    const { adapter, account, messages, deliver } = await setup();
    const event = await deliver("text");

    expect(adapter.__state.events.get(event.id)).toMatchObject({
      status: "processed",
      error: null,
    });
    expect(messages).toHaveLength(1);
    const [first] = messages;
    expect(first?.account.id).toBe(account.id);
    expect(first?.contact).toMatchObject({
      phone: `+${FIXTURE_IDS.waId}`,
      waId: FIXTURE_IDS.waId,
      profileName: FIXTURE_IDS.profileName,
    });
    expect(first?.message).toMatchObject({
      metaMessageId: "wamid.TEXT0001",
      direction: "in",
      type: "text",
      status: "received",
      sender: "contact",
      conversationId: first?.conversation.id,
      sentAt: FIXTURE_IDS.timestamp,
      media: null,
    });
    expect(first?.message.text).toBeTypeOf("string");
    expect(first?.conversation).toMatchObject({
      status: "agent",
      unreadCount: 1,
      lastInboundAt: FIXTURE_IDS.timestamp,
      windowExpiresAt: new Date(FIXTURE_IDS.timestamp.getTime() + DAY_MS),
    });
    // A conversation created now keeps its newer activity time.
    expect(first?.conversation.lastActivityAt.getTime()).toBeGreaterThanOrEqual(
      FIXTURE_IDS.timestamp.getTime(),
    );
  });

  it("calls linkContact on first contact and on a profile change, storing appRef", async () => {
    const linkContact = vi.fn(({ contact }: { contact: { profileName: string | null } }) =>
      Promise.resolve(`patient:${contact.profileName ?? "?"}`),
    );
    const { messages, deliver } = await setup({ linkContact });

    await deliver("text");
    await deliver(textBody({ id: "wamid.TEXT0002" }));
    await deliver(textBody({ id: "wamid.TEXT0003", profileName: "Ana P." }));

    expect(linkContact).toHaveBeenCalledTimes(2);
    expect(messages.map((m) => m.contact.appRef)).toEqual([
      `patient:${FIXTURE_IDS.profileName}`,
      `patient:${FIXTURE_IDS.profileName}`,
      "patient:Ana P.",
    ]);
    expect(messages[2]?.contact.profileName).toBe("Ana P.");
  });

  it("dedupes replays: one message, one emit, unread stays 1", async () => {
    const linkContact = vi.fn(() => "patient-1");
    const { adapter, messages, deliver } = await setup({ linkContact });

    const first = await deliver("text");
    const replay = await deliver("text");

    expect(adapter.__state.messages.size).toBe(1);
    expect(messages).toHaveLength(1);
    expect(linkContact).toHaveBeenCalledTimes(1);
    const [conversation] = [...adapter.__state.conversations.values()];
    expect(conversation?.unreadCount).toBe(1);
    expect(adapter.__state.events.get(first.id)?.status).toBe("processed");
    expect(adapter.__state.events.get(replay.id)?.status).toBe("processed");
  });

  it("reopens a closed conversation and advances its window", async () => {
    const { wa, messages, deliver } = await setup();
    const reopened: ConversationStatusEvent[] = [];
    wa.on("conversation.status", (e) => {
      reopened.push(e);
    });
    await deliver("text");
    const conversationId = messages[0]?.conversation.id ?? "";
    await wa.conversations.close(conversationId);

    const later = new Date(FIXTURE_IDS.timestamp.getTime() + 60 * 60 * 1000);
    await deliver(textBody({ id: "wamid.TEXT0002", timestamp: later }));

    const second = messages[1];
    expect(second?.conversation).toMatchObject({
      id: conversationId,
      status: "agent",
      unreadCount: 2,
      lastInboundAt: later,
      windowExpiresAt: new Date(later.getTime() + DAY_MS),
    });
    expect(reopened.map((e) => [e.from, e.to, e.by])).toEqual([
      ["agent", "closed", "system"],
      ["closed", "agent", "system"],
    ]);
  });

  it("processes multi-entry payloads across accounts", async () => {
    const { adapter, messages, deliver } = await setup();
    await adapter.accounts.insert(
      accountInput({
        phoneNumberId: FIXTURE_IDS.secondPhoneNumberId,
        wabaId: FIXTURE_IDS.secondWabaId,
        tokenRef: "WA_TOKEN_B",
        tenantId: "tenant-b",
      }),
    );
    const event = await deliver("multi-entry");
    expect(adapter.__state.events.get(event.id)?.status).toBe("processed");
    expect(messages.map((m) => [m.message.metaMessageId, m.account.phoneNumberId])).toEqual([
      ["wamid.MULTI001", FIXTURE_IDS.phoneNumberId],
      ["wamid.MULTI002", FIXTURE_IDS.phoneNumberId],
      ["wamid.MULTI003", FIXTURE_IDS.secondPhoneNumberId],
    ]);
    expect(messages[2]?.message.tenantId).toBe("tenant-b");
  });
});

describe("processEvent — media", () => {
  it("downloads media, stores it at mediaPath and records wa_media", async () => {
    graph.server.use(...mediaHandlers());
    const { adapter, account, messages, deliver } = await setup();
    await deliver("image");

    const [event] = messages;
    const conversationId = event?.conversation.id ?? "";
    const path = `tenant-a/${account.id}/${conversationId}/${IMAGE_MEDIA_ID}.jpg`;
    expect(event?.message.media).toMatchObject({
      metaMediaId: IMAGE_MEDIA_ID,
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: "abc123",
      storagePath: path,
      downloadStatus: "done",
    });
    expect(await adapter.storage.get(path)).toEqual(new Uint8Array([1, 2, 3, 4]));
    const auth = graph.requests.filter((r) => r.url.startsWith(GRAPH));
    expect(auth).toHaveLength(1);
  });

  it("retries a failed download once", async () => {
    let calls = 0;
    graph.server.use(
      http.get(`${GRAPH}/${IMAGE_MEDIA_ID}`, () => {
        calls++;
        return calls === 1
          ? HttpResponse.json({ error: { code: 2, message: "Temporary" } }, { status: 500 })
          : HttpResponse.json({ url: LOOKASIDE, mime_type: "image/jpeg", file_size: 4 });
      }),
      downloadHandler(),
    );
    const { messages, deliver } = await setup();
    await deliver("image");
    expect(calls).toBe(2);
    expect(messages[0]?.message.media?.downloadStatus).toBe("done");
  });

  it("marks the media failed after the retry and still stores the message", async () => {
    graph.server.use(
      http.get(`${GRAPH}/${IMAGE_MEDIA_ID}`, () =>
        HttpResponse.json({ error: { code: 2, message: "Down" } }, { status: 500 }),
      ),
    );
    const { adapter, messages, deliver, logs } = await setup();
    const event = await deliver("image");

    expect(graph.requests.filter((r) => r.url.includes(IMAGE_MEDIA_ID))).toHaveLength(2);
    expect(adapter.__state.events.get(event.id)?.status).toBe("processed");
    expect(messages[0]?.message).toMatchObject({
      type: "image",
      text: "Mi receta",
      media: {
        metaMediaId: IMAGE_MEDIA_ID,
        mimeType: "image/jpeg",
        downloadStatus: "failed",
        storagePath: null,
      },
    });
    expect(adapter.__state.storage.size).toBe(0);
    expect(
      logs.entries.some((e) => JSON.stringify(e.args).includes(TOKENS.WA_TOKEN_A ?? "-")),
    ).toBe(false);
  });
});

describe("processEvent — statuses", () => {
  async function outbound(ctx: ReturnType<typeof makeClient>["ctx"], account: Account) {
    const { conversation } = await openConversation(ctx, account, `+${FIXTURE_IDS.waId}`);
    return ctx.adapter.messages.insertOutbound({
      tenantId: account.tenantId,
      conversationId: conversation.id,
      type: "text",
      content: { body: "Hola" },
      text: "Hola",
      sender: "system",
    });
  }

  it("applies statuses forward-only and emits status only when the message moved", async () => {
    const { ctx, adapter, account, statuses, deliver } = await setup();
    const sent = await outbound(ctx, account);
    await adapter.messages.markSent(sent.id, FIXTURE_IDS.outboundMetaId);

    await deliver("status-read");
    await deliver("status-delivered");

    expect((await adapter.messages.get(sent.id))?.status).toBe("read");
    expect(statuses.map((s) => [s.status, s.message.id])).toEqual([["read", sent.id]]);
  });

  it("records the Meta error on a failed status", async () => {
    const { ctx, adapter, account, statuses, deliver } = await setup();
    const sent = await outbound(ctx, account);
    await adapter.messages.markSent(sent.id, "wamid.OUT00005");
    await deliver("status-failed");
    expect(statuses[0]).toMatchObject({
      status: "failed",
      error: { code: 131047, title: "Re-engagement message" },
      message: { id: sent.id, status: "failed" },
    });
  });

  it("keeps a placeholder when the status beats the send and merges it on markSent", async () => {
    const { ctx, adapter, account, statuses, deliver } = await setup();
    const event = await deliver("status-delivered");
    expect(adapter.__state.events.get(event.id)?.status).toBe("processed");
    expect(statuses).toHaveLength(0);
    expect(adapter.__state.placeholders.size).toBe(1);

    const sent = await outbound(ctx, account);
    const merged = await adapter.messages.markSent(sent.id, FIXTURE_IDS.outboundMetaId);
    expect(merged.status).toBe("delivered");
    expect(adapter.__state.placeholders.size).toBe(0);
  });
});

describe("processEvent — reply, agent dispatch and failures", () => {
  it("binds reply to the conversation", async () => {
    const sent: unknown[] = [];
    graph.server.use(acceptSends(sent));
    const { wa, adapter, deliver } = await setup();
    wa.on("message", async ({ reply }) => {
      await reply.text("¡Hola!");
    });
    await deliver(textBody({ timestamp: new Date() }));

    const all = [...adapter.__state.messages.values()];
    const out = all.find((m) => m.direction === "out");
    const inbound = all.find((m) => m.direction === "in");
    expect(out).toMatchObject({
      conversationId: inbound?.conversationId,
      sender: "system",
      text: "¡Hola!",
      status: "sent",
    });
    expect(sent).toHaveLength(1);
  });

  it("calls the agent dispatcher after handlers, only for agent conversations", async () => {
    const { wa, ctx, deliver, messages } = await setup();
    const order: string[] = [];
    wa.on("message", () => {
      order.push("handler");
    });
    const handleInbound = vi.fn<AgentDispatcher["handleInbound"]>(() => {
      order.push("agent");
      return Promise.resolve();
    });
    ctx.agentDispatcher = { handleInbound };

    await deliver("text");
    expect(order).toEqual(["handler", "agent"]);
    expect(handleInbound).toHaveBeenCalledTimes(1);
    expect(handleInbound.mock.calls[0]?.[0]).toMatchObject({
      message: { metaMessageId: "wamid.TEXT0001" },
      conversation: { status: "agent" },
    });

    await wa.conversations.assign(messages[0]?.conversation.id ?? "", "user-1");
    await deliver(textBody({ id: "wamid.TEXT0002" }));
    expect(handleInbound).toHaveBeenCalledTimes(1);
  });

  it("dispatches a burst batched in one payload once, after every handler, with the last message", async () => {
    const { wa, ctx, deliver } = await setup();
    const order: string[] = [];
    wa.on("message", ({ message }) => {
      order.push(`handler:${message.metaMessageId}`);
    });
    const handleInbound = vi.fn<AgentDispatcher["handleInbound"]>(({ message }) => {
      order.push(`agent:${message.metaMessageId}`);
      return Promise.resolve();
    });
    ctx.agentDispatcher = { handleInbound };

    const event = await deliver(
      burstWebhook([
        { id: "wamid.B1", body: "hola" },
        { id: "wamid.B2", body: "quiero cita" },
        { id: "wamid.B3", body: "mañana" },
      ]),
    );

    expect(event.status).toBe("processed");
    expect(order).toEqual([
      "handler:wamid.B1",
      "handler:wamid.B2",
      "handler:wamid.B3",
      "agent:wamid.B3",
    ]);
    expect(handleInbound).toHaveBeenCalledTimes(1);
    expect(handleInbound.mock.calls[0]?.[0]).toMatchObject({
      message: { metaMessageId: "wamid.B3", text: "mañana" },
      conversation: { status: "agent", unreadCount: 3 },
    });
  });

  it("dispatches once per conversation in first-appearance order", async () => {
    const { ctx, deliver, messages } = await setup();
    const handleInbound = vi.fn<AgentDispatcher["handleInbound"]>(() => Promise.resolve());
    ctx.agentDispatcher = { handleInbound };

    await deliver(
      burstWebhook([
        { id: "wamid.C1", body: "hola", from: FIXTURE_IDS.secondWaId },
        { id: "wamid.C2", body: "buenas", from: FIXTURE_IDS.waId },
        { id: "wamid.C3", body: "¿hay cita?", from: FIXTURE_IDS.secondWaId },
      ]),
    );

    expect(messages).toHaveLength(3);
    expect(handleInbound).toHaveBeenCalledTimes(2);
    const calls = handleInbound.mock.calls.map(([input]) => ({
      phone: input.contact.phone,
      meta: input.message.metaMessageId,
    }));
    expect(calls).toEqual([
      { phone: `+${FIXTURE_IDS.secondWaId}`, meta: "wamid.C3" },
      { phone: `+${FIXTURE_IDS.waId}`, meta: "wamid.C2" },
    ]);
    expect(new Set(handleInbound.mock.calls.map(([input]) => input.conversation.id)).size).toBe(2);
  });

  it("skips dispatch for a fully replayed burst", async () => {
    const { ctx, deliver } = await setup();
    const handleInbound = vi.fn<AgentDispatcher["handleInbound"]>(() => Promise.resolve());
    ctx.agentDispatcher = { handleInbound };
    const body = burstWebhook([
      { id: "wamid.D1", body: "hola" },
      { id: "wamid.D2", body: "mañana" },
    ]);
    await deliver(body);
    await deliver(body);
    expect(handleInbound).toHaveBeenCalledTimes(1);
  });

  it("re-reads the conversation so a handler's handoff skips the agent", async () => {
    const { wa, ctx, deliver } = await setup();
    wa.on("message", async ({ conversation }) => {
      await wa.conversations.assign(conversation.id, "user-1");
    });
    const handleInbound = vi.fn(() => Promise.resolve());
    ctx.agentDispatcher = { handleInbound };
    await deliver("text");
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it("logs a failing dispatcher without failing the event", async () => {
    const { ctx, adapter, deliver, logs } = await setup();
    ctx.agentDispatcher = { handleInbound: () => Promise.reject(new Error("model down")) };
    const event = await deliver("text");
    expect(adapter.__state.events.get(event.id)?.status).toBe("processed");
    expect(logs.of("error").some((line) => line.includes("agent dispatch failed"))).toBe(true);
  });

  it("marks the event failed with a redacted error and keeps processing other changes", async () => {
    const { adapter, deliver, messages } = await setup();
    const insert = adapter.messages.insertInbound.bind(adapter.messages);
    vi.spyOn(adapter.messages, "insertInbound").mockImplementation((input) =>
      input.metaMessageId === "wamid.MULTI001"
        ? Promise.reject(new Error(`db down for ${SECRET}`))
        : insert(input),
    );
    const event = await deliver("multi-entry");

    const stored = adapter.__state.events.get(event.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.error).toContain("wamid.MULTI001");
    expect(stored?.error).toContain("[REDACTED]");
    expect(stored?.error).not.toContain(SECRET);
    expect(messages.map((m) => m.message.metaMessageId)).toEqual(["wamid.MULTI002"]);
  });

  it("marks a payload that is not a Meta webhook as failed", async () => {
    const { adapter, deliver } = await setup();
    const event = await deliver(JSON.stringify({ hello: "world" }));
    expect(adapter.__state.events.get(event.id)?.status).toBe("failed");
    expect(adapter.__state.events.get(event.id)?.error).toBeTruthy();
  });
});

describe("wa.events and wa.maintenance", () => {
  it("reprocesses a failed event idempotently", async () => {
    const { wa, adapter, deliver, messages } = await setup();
    const spy = vi.spyOn(adapter.messages, "insertInbound");
    spy.mockRejectedValueOnce(new Error("transient"));
    const event = await deliver("multi-entry");
    expect((await wa.events.get(event.id))?.status).toBe("failed");
    expect(messages.map((m) => m.message.metaMessageId)).toEqual(["wamid.MULTI002"]);

    const again = await wa.events.reprocess(event.id);
    expect(again.status).toBe("processed");
    expect(again.error).toBeNull();
    expect(messages.map((m) => m.message.metaMessageId).sort()).toEqual([
      "wamid.MULTI001",
      "wamid.MULTI002",
    ]);
    expect(adapter.__state.messages.size).toBe(2);

    await wa.events.reprocess(event.id);
    expect(messages).toHaveLength(2);
  });

  it("reprocesses received and unrouted events, but not processed ones", async () => {
    const { wa, adapter, account, messages } = await setup();
    const received = await adapter.events.insert({
      payload: JSON.parse(loadWebhookFixtureText("text")),
    });
    expect((await wa.events.reprocess(received.id)).status).toBe("processed");
    expect(messages).toHaveLength(1);

    const processedAt = (await wa.events.get(received.id))?.processedAt;
    const untouched = await wa.events.reprocess(received.id);
    expect(untouched.processedAt).toEqual(processedAt);

    const unrouted = await adapter.events.insert({
      payload: JSON.parse(loadWebhookFixtureText("unrouted-phone-number")),
    });
    expect((await wa.events.reprocess(unrouted.id)).status).toBe("unrouted");
    await adapter.accounts.insert(
      accountInput({
        phoneNumberId: FIXTURE_IDS.unroutedPhoneNumberId,
        tenantId: account.tenantId,
      }),
    );
    expect((await wa.events.reprocess(unrouted.id)).status).toBe("processed");
    expect(messages).toHaveLength(2);
  });

  it("throws RecordNotFoundError for an unknown event", async () => {
    const { wa } = makeClient();
    await expect(
      wa.events.reprocess("00000000-0000-4000-8000-000000000000"),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await wa.events.get("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("prunes events older than eventRetentionDays and returns the count", async () => {
    let now = new Date(Date.now() - 40 * DAY_MS);
    const { wa, adapter } = makeClient({ memory: { now: () => now } });
    await adapter.events.insert({ payload: {} });
    await adapter.events.insert({ payload: {} });
    now = new Date(Date.now() - 10 * DAY_MS);
    const recent = await adapter.events.insert({ payload: {} });

    expect(await wa.maintenance.prune()).toBe(2);
    expect([...adapter.__state.events.keys()]).toEqual([recent.id]);
    expect(await wa.maintenance.prune({ olderThanDays: 5 })).toBe(1);
    await expect(wa.maintenance.prune({ olderThanDays: -1 })).rejects.toBeInstanceOf(ConfigError);
  });

  it("uses a custom eventRetentionDays", async () => {
    let now = new Date(Date.now() - 10 * DAY_MS);
    const { wa, adapter } = makeClient({ eventRetentionDays: 7, memory: { now: () => now } });
    await adapter.events.insert({ payload: {} });
    now = new Date();
    await adapter.events.insert({ payload: {} });
    expect(await wa.maintenance.prune()).toBe(1);
  });
});
