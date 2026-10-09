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

async function conversationOf(phone: string): Promise<InboxConversation | undefined> {
  const page = await lib.sendo.inbox.list({ tenantId: PLAYGROUND_TENANT_ID, limit: 100 });
  return page.items.find((item) => item.contact.phone === phone);
}

async function threadOf(conversationId: string): Promise<InboxMessage[]> {
  const page = await lib.sendo.inbox.thread(conversationId, {
    tenantId: PLAYGROUND_TENANT_ID,
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
});
