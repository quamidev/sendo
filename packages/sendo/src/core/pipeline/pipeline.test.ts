import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  FIXTURE_IDS,
  loadWebhookFixtureText,
  type WebhookFixtureName,
} from "../../../test/support/fixtures";
import { signFixture } from "../../../test/support/sign";
import type { AgentDispatcher } from "../context";
import type { MessageEvent, StatusEvent } from "../events";
import {
  GRAPH,
  TOKENS,
  accountInput,
  burstWebhook,
  makeClient,
  useGraphServer,
  type ClientOptions,
} from "../test-utils";

const graph = useGraphServer();
const SECRET = "app-secret-value";
const URL_BASE = "https://app.example/api/sendo/webhook";
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

async function setup(options: ClientOptions = {}) {
  const client = makeClient(options);
  const account = await client.adapter.accounts.insert(
    accountInput({ phoneNumberId: FIXTURE_IDS.phoneNumberId, wabaId: FIXTURE_IDS.wabaId }),
  );
  const messages: MessageEvent[] = [];
  const statuses: StatusEvent[] = [];
  client.sendo.on("message", (e) => {
    messages.push(e);
  });
  client.sendo.on("status", (e) => {
    statuses.push(e);
  });

  /** Posts a signed body and waits for the background work. */
  async function deliver(body: Body) {
    const tasks: Promise<unknown>[] = [];
    const response = await client.sendo.handleWebhook(postRequest(body), {
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

const downloadHandler = (bytes = new Uint8Array([1, 2, 3, 4])) =>
  http.get(LOOKASIDE, () => new HttpResponse(bytes, { headers: { "content-type": "image/jpeg" } }));

describe("sendo.handleWebhook — synchronous part", () => {
  it("keeps processing detached and logs when waitUntil throws", async () => {
    const { sendo, adapter, logs } = await setup();
    const response = await sendo.handleWebhook(postRequest("text"), {
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
});

describe("processEvent — routing, contacts, dedupe and conversations", () => {
  it("processes multi-entry payloads across accounts", async () => {
    const { adapter, messages, deliver } = await setup();
    await adapter.accounts.insert(
      accountInput({
        phoneNumberId: FIXTURE_IDS.secondPhoneNumberId,
        wabaId: FIXTURE_IDS.secondWabaId,
        tokenRef: "SENDO_TOKEN_B",
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
      logs.entries.some((e) => JSON.stringify(e.args).includes(TOKENS.SENDO_TOKEN_A ?? "-")),
    ).toBe(false);
  });
});

describe("processEvent — reply, agent dispatch and failures", () => {
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

  it("re-reads the conversation so a handler's handoff skips the agent", async () => {
    const { sendo, ctx, deliver } = await setup();
    sendo.on("message", async ({ conversation }) => {
      await sendo.conversations.assign(conversation.id, "user-1");
    });
    const handleInbound = vi.fn(() => Promise.resolve());
    ctx.agentDispatcher = { handleInbound };
    await deliver("text");
    expect(handleInbound).not.toHaveBeenCalled();
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
});

describe("sendo.events and sendo.maintenance", () => {
  it("reprocesses received and unrouted events, but not processed ones", async () => {
    const { sendo, adapter, account, messages } = await setup();
    const received = await adapter.events.insert({
      payload: JSON.parse(loadWebhookFixtureText("text")),
    });
    expect((await sendo.events.reprocess(received.id)).status).toBe("processed");
    expect(messages).toHaveLength(1);

    const processedAt = (await sendo.events.get(received.id))?.processedAt;
    const untouched = await sendo.events.reprocess(received.id);
    expect(untouched.processedAt).toEqual(processedAt);

    const unrouted = await adapter.events.insert({
      payload: JSON.parse(loadWebhookFixtureText("unrouted-phone-number")),
    });
    expect((await sendo.events.reprocess(unrouted.id)).status).toBe("unrouted");
    await adapter.accounts.insert(
      accountInput({
        phoneNumberId: FIXTURE_IDS.unroutedPhoneNumberId,
        tenantId: account.tenantId,
      }),
    );
    expect((await sendo.events.reprocess(unrouted.id)).status).toBe("processed");
    expect(messages).toHaveLength(2);
  });
});
