/**
 * [CC-PAR-1] Cross-cutting consistency: the memory and Supabase adapters produce identical
 * pipeline results for the same scenario (inbound text + agent reply, inbound image with media
 * download, delivery statuses, an unrouted webhook).
 *
 * Needs a local Supabase (`pnpm supabase start && pnpm supabase db reset`):
 * - `SUPABASE_URL` (default `http://127.0.0.1:55321`)
 * - `SUPABASE_SERVICE_ROLE_KEY` (default: read from `supabase status -o env`)
 * - `WA_LI_STORAGE_BUCKET` (default `whatsapp-media`)
 * Skips with "Supabase unreachable" unless `WA_LI_REQUIRE_SUPABASE=1`, where it fails instead.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../../src/adapters/memory";
import { supabaseAdapter } from "../../src/adapters/supabase";
import type { WhatsAppAdapter } from "../../src/adapters/types";
import { scriptedModel, textResult } from "../../src/agents/test-helpers";
import { createWhatsApp } from "../../src/core/create-whatsapp";
import { GRAPH, captureLogger, useGraphServer } from "../../src/core/test-utils";
import { FIXTURE_IDS, loadWebhookFixtureText, type WebhookFixtureName } from "../support/fixtures";
import { signedPost, mediaHandlers } from "./harness";

const graph = useGraphServer();

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "http://127.0.0.1:55321").replace(/\/+$/, "");
const BUCKET = process.env.WA_LI_STORAGE_BUCKET ?? "whatsapp-media";
const REQUIRED = process.env.WA_LI_REQUIRE_SUPABASE === "1";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

async function isReachable(url: string): Promise<boolean> {
  try {
    await fetch(`${url}/rest/v1/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function readServiceRoleKey(): Promise<string | null> {
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fromEnv) return fromEnv;
  try {
    const { stdout } = await promisify(execFile)(
      "npx",
      ["pnpm@10.34.6", "supabase", "status", "-o", "env"],
      { cwd: REPO_ROOT, timeout: 20_000 },
    );
    const read = (name: string) => new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(stdout)?.[1];
    return read("SERVICE_ROLE_KEY") ?? read("SECRET_KEY") ?? null;
  } catch {
    return null;
  }
}

const reachable = await isReachable(SUPABASE_URL);
const serviceRoleKey = reachable ? await readServiceRoleKey() : null;
const unavailable = !reachable
  ? "Supabase unreachable"
  : !serviceRoleKey
    ? "SUPABASE_SERVICE_ROLE_KEY not set"
    : null;

if (unavailable && REQUIRED) {
  describe("pipeline parity prerequisites", () => {
    it("has a reachable local Supabase with a service role key", () => {
      expect.fail(
        `${unavailable} at ${SUPABASE_URL}. Run \`pnpm supabase start && pnpm supabase db reset\` ` +
          "or set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.",
      );
    });
  });
}

/** Runs the scenario against `base` and returns adapter-independent results. */
async function runScenario(base: WhatsAppAdapter) {
  const run = randomUUID().slice(0, 8);
  const phoneNumberId = `7${String(Date.now()).slice(-9)}${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`;
  const eventIds: string[] = [];
  const adapter: WhatsAppAdapter = {
    ...base,
    events: {
      ...base.events,
      insert: async (input) => {
        const event = await base.events.insert(input);
        eventIds.push(event.id);
        return event;
      },
    },
  };
  const account = await adapter.accounts.insert({
    tenantId: randomUUID(),
    phoneNumberId,
    wabaId: FIXTURE_IDS.wabaId,
    displayPhone: "+15550001111",
    tokenRef: "WA_TOKEN_PARITY",
  });

  let sends = 0;
  graph.server.use(
    ...mediaHandlers(),
    http.post(`${GRAPH}/:phoneNumberId/messages`, () =>
      HttpResponse.json({ messages: [{ id: `wamid.PAR.${run}.${String(++sends)}` }] }),
    ),
  );
  const { logger } = captureLogger();
  const wa = createWhatsApp({
    adapter,
    appSecret: "app-secret-value",
    verifyToken: "verify-token-value",
    resolveToken: () => "parity-token",
    logger,
  });
  wa.agent({
    name: "recepcion",
    model: scriptedModel(textResult("¡Hola! ¿En qué te ayudo?")),
    instructions: "Recepción.",
  });

  const now = String(Math.floor(Date.now() / 1000));
  const body = (name: WebhookFixtureName, replace: [string, string][] = []) => {
    let text = loadWebhookFixtureText(name)
      .replaceAll(FIXTURE_IDS.phoneNumberId, phoneNumberId)
      .replace(/"timestamp":\s*"\d+"/g, `"timestamp": "${now}"`)
      .replace(/"(wamid\.[A-Z]+\d+)"/g, `"$1.${run}"`);
    for (const [from, to] of replace) text = text.replaceAll(from, to);
    return text;
  };
  const deliver = async (text: string) => {
    const tasks: Promise<unknown>[] = [];
    const response = await wa.handleWebhook(signedPost(text), { waitUntil: (p) => tasks.push(p) });
    await Promise.all(tasks);
    return response.status;
  };

  const firstOut = `wamid.PAR.${run}.1`;
  const statuses = [
    await deliver(body("text")),
    await deliver(body("text")),
    await deliver(body("image")),
    await deliver(body("status-delivered", [[`wamid.OUT00001.${run}`, firstOut]])),
    await deliver(body("status-read", [[`wamid.OUT00001.${run}`, firstOut]])),
    await deliver(body("status-delivered", [[`wamid.OUT00001.${run}`, firstOut]])),
    await deliver(body("unrouted-phone-number")),
  ];

  const events = await Promise.all(eventIds.map((id) => adapter.events.get(id)));
  const page = await adapter.conversations.list({ tenantId: account.tenantId, limit: 10 });
  const conversations = page.items;
  const [conversation] = conversations;
  const thread = conversation
    ? (await adapter.messages.thread(conversation.id, { limit: 50 })).items
    : [];
  const contact = conversation ? await adapter.contacts.get(conversation.contactId) : null;

  const result = {
    responses: statuses,
    events: events.map((e) => e?.status),
    conversations: conversations.map((c) => ({
      status: c.status,
      unreadCount: c.unreadCount,
      assignedTo: c.assignedTo,
    })),
    contact: contact && {
      phone: contact.phone,
      waId: contact.waId,
      profileName: contact.profileName,
      appRef: contact.appRef,
    },
    thread: [...thread].reverse().map((m) => ({
      direction: m.direction,
      type: m.type,
      text: m.text,
      status: m.status,
      sender: m.sender,
      senderRef: m.senderRef,
      metaMessageId: m.metaMessageId?.replace(run, "<run>") ?? null,
      media: m.media && {
        mimeType: m.media.mimeType,
        sizeBytes: m.media.sizeBytes,
        downloadStatus: m.media.downloadStatus,
        storagePath: m.media.storagePath
          ?.replace(account.tenantId ?? "", "<tenant>")
          .replace(account.id, "<account>")
          .replace(conversation?.id ?? "", "<conversation>"),
      },
    })),
    sends,
  };
  return { result, account, eventIds };
}

describe("[CC-PAR-1] pipeline scenario", () => {
  it("[CC-PAR-1] gives the same results on two memory adapters (scenario self-check)", async () => {
    const first = await runScenario(memoryAdapter());
    const second = await runScenario(memoryAdapter());
    expect(second.result).toEqual(first.result);
    expect(first.result.events).toEqual([
      "processed",
      "processed",
      "processed",
      "processed",
      "processed",
      "processed",
      "unrouted",
    ]);
    expect(first.result.thread.map((m) => [m.direction, m.type, m.status])).toEqual([
      ["in", "text", "received"],
      ["out", "text", "read"],
      ["in", "image", "received"],
      ["out", "text", "sent"],
    ]);
    expect(first.result.thread[2]?.media).toMatchObject({
      downloadStatus: "done",
      mimeType: "image/jpeg",
    });
  });
});

describe.skipIf(unavailable !== null)(
  `[CC-PAR-1] memory vs Supabase pipeline parity${unavailable ? ` (skipped: ${unavailable})` : ""}`,
  () => {
    it("[CC-PAR-1] memory and Supabase adapters produce identical pipeline results", async () => {
      const client = createClient(SUPABASE_URL, serviceRoleKey ?? "missing-key", {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const memory = await runScenario(memoryAdapter());
      const supabase = await runScenario(supabaseAdapter(client, { storageBucket: BUCKET }));
      try {
        expect(supabase.result).toEqual(memory.result);
      } finally {
        await client.from("wa_accounts").delete().eq("id", supabase.account.id);
        if (supabase.eventIds.length > 0)
          await client.from("wa_events").delete().in("id", supabase.eventIds);
      }
    }, 60_000);
  },
);
