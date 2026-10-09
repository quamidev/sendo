import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InboxConversation, InboxMessage } from "@quami/sendo";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as RouteModule from "@/app/api/sendo/webhook/route";
import { MOCK_REPLY_PREFIX } from "@/lib/mock-model";
import { FIXTURES_DEV_USER_ID, PLAYGROUND_TENANT_ID } from "@/lib/playground-env";
import type * as SendoLib from "@/lib/sendo";

const SECRET = "replay-test-secret";
const fixturesDir = join(import.meta.dirname, "../../../packages/sendo/test/fixtures/webhooks");

type Route = typeof RouteModule;
type SendoModule = typeof SendoLib;

let route: Route;
let lib: SendoModule;

interface TextPatch {
  id: string;
  body?: string;
  from?: string;
}

/** The package's `text` fixture, with "now" as timestamp so the 24-hour window is open. */
function textFixture(patch: TextPatch): string {
  const payload = JSON.parse(readFileSync(join(fixturesDir, "text.json"), "utf8")) as {
    entry: {
      changes: { value: { contacts: { wa_id: string }[]; messages: Record<string, unknown>[] } }[];
    }[];
  };
  const value = payload.entry[0]?.changes[0]?.value;
  const message = value?.messages[0];
  const contact = value?.contacts[0];
  if (!message || !contact) throw new Error("text fixture changed");
  message.id = patch.id;
  message.timestamp = String(Math.floor(Date.now() / 1000));
  if (patch.body !== undefined) message.text = { body: patch.body };
  if (patch.from !== undefined) {
    message.from = patch.from;
    contact.wa_id = patch.from;
  }
  return JSON.stringify(payload);
}

/** The package's `coexistence-echo` fixture (a phone-app message) to `to`, timestamped now. */
function echoFixture(patch: { id: string; to: string }): string {
  const payload = JSON.parse(readFileSync(join(fixturesDir, "coexistence-echo.json"), "utf8")) as {
    entry: { changes: { value: { message_echoes: Record<string, unknown>[] } }[] }[];
  };
  const echo = payload.entry[0]?.changes[0]?.value.message_echoes[0];
  if (!echo) throw new Error("echo fixture changed");
  echo.id = patch.id;
  echo.to = patch.to;
  echo.timestamp = String(Math.floor(Date.now() / 1000) + 1);
  return JSON.stringify(payload);
}

/** The package's `text-source-code` fixture (`[#garita]`) from `from`, timestamped now. */
function sourceCodeFixture(patch: { id: string; from: string }): string {
  const payload = JSON.parse(readFileSync(join(fixturesDir, "text-source-code.json"), "utf8")) as {
    entry: {
      changes: { value: { contacts: { wa_id: string }[]; messages: Record<string, unknown>[] } }[];
    }[];
  };
  const value = payload.entry[0]?.changes[0]?.value;
  const message = value?.messages[0];
  const contact = value?.contacts[0];
  if (!message || !contact) throw new Error("text-source-code fixture changed");
  message.id = patch.id;
  message.from = patch.from;
  message.timestamp = String(Math.floor(Date.now() / 1000));
  contact.wa_id = patch.from;
  return JSON.stringify(payload);
}

function signedPost(body: string, secret = SECRET): Request {
  const signature = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
  return new Request("http://localhost:3000/api/sendo/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    body,
  });
}

async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for the pipeline");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The fixtures-mode dev user, an admin of the playground tenant (`resolveRole` in lib/sendo). */
function devActor() {
  return lib.sendo.actor(FIXTURES_DEV_USER_ID, PLAYGROUND_TENANT_ID);
}

async function conversationOf(phone: string): Promise<InboxConversation | undefined> {
  const page = await lib.sendo.inbox.list({ actor: await devActor(), limit: 100 });
  return page.items.find((item) => item.contact.phone === phone);
}

async function threadOf(conversationId: string): Promise<InboxMessage[]> {
  const page = await lib.sendo.inbox.thread(conversationId, {
    actor: await devActor(),
    limit: 100,
  });
  return page.items;
}

beforeAll(async () => {
  vi.stubEnv("SENDO_PLAYGROUND_MODE", "fixtures");
  vi.stubEnv("SENDO_META_APP_SECRET", SECRET);
  vi.stubEnv("SENDO_VERIFY_TOKEN", "replay-verify-token");
  vi.stubEnv("SENDO_AGENT_MODEL", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
  route = await import("@/app/api/sendo/webhook/route");
  lib = await import("@/lib/sendo");
  await lib.playground.ready;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("playground webhook in fixtures mode", () => {
  it("runs on the memory adapter with the mock model", () => {
    expect(lib.playground.mode).toBe("fixtures");
    expect(lib.playground.memory).not.toBeNull();
    expect(lib.playground.mockModel).toBe(true);
  });

  it("answers Meta's verification challenge", async () => {
    const ok = await route.GET(
      new Request(
        "http://localhost:3000/api/sendo/webhook?hub.mode=subscribe&hub.verify_token=replay-verify-token&hub.challenge=42",
      ),
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");

    const wrong = await route.GET(
      new Request(
        "http://localhost:3000/api/sendo/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42",
      ),
    );
    expect(wrong.status).toBe(403);
  });

  it("rejects a payload signed with another secret without storing anything", async () => {
    const response = await route.POST(
      signedPost(textFixture({ id: "wamid.BADSIG" }), "other-secret"),
    );
    expect(response.status).toBe(401);
    expect(await lib.playground.memory?.messages.getByMetaId("wamid.BADSIG")).toBeNull();
  });

  it("stores a replayed text fixture and the mock agent replies", async () => {
    const response = await route.POST(signedPost(textFixture({ id: "wamid.REPLAYTEST1" })));
    expect(response.status).toBe(200);

    const messages = await waitFor(async () => {
      const conversation = await conversationOf("+50255550001");
      if (!conversation) return undefined;
      const thread = await threadOf(conversation.id);
      return thread.some((message) => message.sender === "agent") ? thread : undefined;
    });

    const inbound = messages.find((message) => message.metaMessageId === "wamid.REPLAYTEST1");
    expect(inbound).toMatchObject({
      direction: "in",
      sender: "contact",
      text: "Hola, quisiera agendar una cita",
    });
    const reply = messages.find((message) => message.sender === "agent");
    expect(reply).toMatchObject({
      direction: "out",
      senderRef: "recepcion",
      status: "sent",
      text: `${MOCK_REPLY_PREFIX} Hola, quisiera agendar una cita`,
    });
    const conversation = await conversationOf("+50255550001");
    expect(conversation?.contact.appRef).toBe("pac_001");
  });

  it("hands off to the dev user when the contact asks for a person", async () => {
    await route.POST(
      signedPost(
        textFixture({
          id: "wamid.REPLAYTEST2",
          from: "50255550002",
          body: "Quiero hablar con una persona",
        }),
      ),
    );
    const conversation = await waitFor(async () => {
      const found = await conversationOf("+50255550002");
      return found?.status === "human" ? found : undefined;
    });
    expect(conversation.assignedTo).toBe(FIXTURES_DEV_USER_ID);
  });

  it("uses buscar_cita for appointment questions", async () => {
    await route.POST(
      signedPost(
        textFixture({ id: "wamid.REPLAYTEST3", from: "50255550003", body: "¿Cuándo es mi cita?" }),
      ),
    );
    const reply = await waitFor(async () => {
      const conversation = await conversationOf("+50255550003");
      if (!conversation) return undefined;
      return (await threadOf(conversation.id)).find((message) => message.sender === "agent");
    });
    expect(reply.text).toContain("Dra. López");
  });

  it("stores a phone-app echo (coexistence) and pauses the agent on that conversation", async () => {
    const phone = "+50255550004";
    await route.POST(
      signedPost(textFixture({ id: "wamid.REPLAYTEST4", from: "50255550004", body: "Hola" })),
    );
    const before = await waitFor(async () => {
      const conversation = await conversationOf(phone);
      if (!conversation) return undefined;
      const thread = await threadOf(conversation.id);
      return thread.some((message) => message.sender === "agent") ? conversation : undefined;
    });

    const response = await route.POST(
      signedPost(echoFixture({ id: "wamid.REPLAYECHO1", to: "50255550004" })),
    );
    expect(response.status).toBe(200);

    const echo = await waitFor(async () =>
      (await threadOf(before.id)).find((message) => message.metaMessageId === "wamid.REPLAYECHO1"),
    );
    expect(echo).toMatchObject({
      direction: "out",
      sender: "human",
      senderRef: "business_app",
      status: "sent",
    });
    const after = await waitFor(async () => {
      const conversation = await conversationOf(phone);
      return conversation?.conversation.agentPaused ? conversation : undefined;
    });
    expect(after.lastInboundAt).toEqual(before.lastInboundAt);
    expect(after.unreadCount).toBe(before.unreadCount);
  });

  it("attributes a [#garita] first message and the agent reads it without the code", async () => {
    const memory = lib.playground.memory;
    if (!memory) throw new Error("fixtures mode has a memory adapter");
    const response = await route.POST(
      signedPost(sourceCodeFixture({ id: "wamid.REPLAYGARITA1", from: "50255550005" })),
    );
    expect(response.status).toBe(200);

    const inbound = await waitFor(async () => {
      const found = await memory.messages.getByMetaId("wamid.REPLAYGARITA1");
      return found ?? undefined;
    });
    expect(inbound.text).toBe("Hola, vi el letrero de la garita [#garita]");
    expect(inbound.metadata.source).toBe("garita");
    const conversation = await memory.conversations.get(inbound.conversationId);
    expect(conversation?.source).toBe("garita");

    const reply = await waitFor(async () =>
      (await memory.messages.history(inbound.conversationId, 20)).find(
        (message) => message.sender === "agent",
      ),
    );
    expect(reply.text).toBe(`${MOCK_REPLY_PREFIX} Hola, vi el letrero de la garita`);
  });
});
