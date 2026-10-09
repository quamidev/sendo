/**
 * Product spec — Acceptance Criteria — "Webhook and security".
 *
 * [AC-WS-1] GET returns hub.challenge only when hub.verify_token matches; otherwise 403.
 * [AC-WS-2] POST with an invalid or missing X-Hub-Signature-256 returns 401 and stores nothing.
 * [AC-WS-3] A valid POST returns 200 in under 500 ms regardless of how long the agent takes;
 *           processing continues in the background.
 * [AC-WS-4] A webhook delivered twice (same Meta message id) gives exactly one stored message and
 *           one agent turn.
 * [AC-WS-5] Every raw webhook is stored in sendo_events with a status (received, processed, failed,
 *           unrouted); failed events can be reprocessed with sendo.events.reprocess(id).
 * [AC-WS-6] sendo_events rows older than 30 days are deleted; the retention period is configurable.
 * [AC-WS-7] Meta access tokens never appear in the database, logs or error messages.
 */
import { inspect } from "node:util";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { scriptedModel, textResult } from "../../src/agents/test-helpers";
import type { AccountErrorEvent } from "../../src/core/events";
import { GRAPH, acceptSends, useGraphServer } from "../../src/core/test-utils";
import { MetaApiError } from "../../src/errors/meta-api-error";
import { FIXTURE_IDS } from "../support/fixtures";
import {
  DAY_MS,
  WEBHOOK_URL,
  createHarness,
  dumpState,
  errorSurface,
  freshFixture,
  mediaHandlers,
  signedPost,
} from "./harness";

const graph = useGraphServer();

function writeCount(state: Awaited<ReturnType<typeof createHarness>>["adapter"]["__state"]) {
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

describe("Webhook and security", () => {
  it("[AC-WS-1] GET returns hub.challenge only for the right verify token, else 403", async () => {
    const { sendo } = await createHarness();
    const get = (token: string | null, mode = "subscribe") => {
      const url = new URL(WEBHOOK_URL);
      url.searchParams.set("hub.mode", mode);
      if (token !== null) url.searchParams.set("hub.verify_token", token);
      url.searchParams.set("hub.challenge", "1158201444");
      return sendo.handleWebhook(new Request(url));
    };

    const ok = await get("verify-token-value");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    for (const response of [
      await get("wrong"),
      await get(null),
      await get("verify-token-value", "x"),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("1158201444");
    }
  });

  it("[AC-WS-2] POST with a bad, missing or tampered signature returns 401 and stores nothing", async () => {
    const { sendo, adapter } = await createHarness();
    const body = freshFixture("text");
    const tasks: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => tasks.push(p);
    const valid = signedPost(body);

    const responses = [
      await sendo.handleWebhook(signedPost(body, "not-the-app-secret"), { waitUntil }),
      await sendo.handleWebhook(new Request(WEBHOOK_URL, { method: "POST", body }), { waitUntil }),
      await sendo.handleWebhook(
        new Request(WEBHOOK_URL, {
          method: "POST",
          headers: valid.headers,
          body: body.replace("wamid.TEXT0001", "wamid.FORGED"),
        }),
        { waitUntil },
      ),
      await sendo.handleWebhook(
        new Request(WEBHOOK_URL, {
          method: "POST",
          headers: { "x-hub-signature-256": "sha256=deadbeef", "content-type": "application/json" },
          body,
        }),
        { waitUntil },
      ),
    ];

    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    expect(tasks).toHaveLength(0);
    expect(writeCount(adapter.__state)).toBe(0);
    expect(graph.requests).toHaveLength(0);
  });

  it("[AC-WS-3] a valid POST returns 200 in under 500 ms while a slow agent keeps working", async () => {
    graph.server.use(acceptSends());
    const h = await createHarness();
    const model = scriptedModel(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return textResult("Respuesta lenta");
    });
    h.sendo.agent({ name: "recepcion", model, instructions: "Recepción." });

    const tasks: Promise<unknown>[] = [];
    const started = performance.now();
    const response = await h.sendo.handleWebhook(signedPost(freshFixture("text")), {
      waitUntil: (p) => tasks.push(p),
    });
    const elapsed = performance.now() - started;

    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(500);
    expect(h.messages("out")).toHaveLength(0);
    const [event] = [...h.adapter.__state.events.values()];
    expect(event?.status).toBe("received");

    await Promise.all(tasks);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(h.messages("out").map((m) => m.text)).toEqual(["Respuesta lenta"]);
    expect(h.adapter.__state.events.get(event?.id ?? "")?.status).toBe("processed");
  }, 10_000);

  it("[AC-WS-4] the same webhook delivered twice stores one message and runs one agent turn", async () => {
    graph.server.use(acceptSends());
    const h = await createHarness();
    const model = scriptedModel(textResult("Hola"));
    h.sendo.agent({ name: "recepcion", model, instructions: "Recepción." });
    const body = freshFixture("text");

    const first = await h.deliver(body);
    const second = await h.deliver(body);

    expect(h.messages("in")).toHaveLength(1);
    expect(h.messageEvents).toHaveLength(1);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(h.messages("out")).toHaveLength(1);
    expect([first.status, second.status]).toEqual(["processed", "processed"]);
    expect(h.adapter.__state.events.size).toBe(2);
  });

  describe("[AC-WS-5] raw webhooks in sendo_events with a processing status, and reprocess", () => {
    it("[AC-WS-5] stores the raw payload as received, then processed", async () => {
      const h = await createHarness();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      h.sendo.on("message", () => gate);
      const tasks: Promise<unknown>[] = [];
      const body = freshFixture("text");
      await h.sendo.handleWebhook(signedPost(body), { waitUntil: (p) => tasks.push(p) });

      const [event] = [...h.adapter.__state.events.values()];
      expect(event?.payload).toEqual(JSON.parse(body));
      await vi.waitFor(() => {
        expect(h.messageEvents).toHaveLength(1);
      });
      expect((await h.sendo.events.get(event?.id ?? ""))?.status).toBe("received");
      release();
      await Promise.all(tasks);
      expect((await h.sendo.events.get(event?.id ?? ""))?.status).toBe("processed");
    });

    it("[AC-WS-5] marks unknown numbers unrouted and malformed WhatsApp payloads failed", async () => {
      const h = await createHarness();
      expect((await h.deliver("unrouted-phone-number")).status).toBe("unrouted");
      const failed = await h.deliver(
        JSON.stringify({ object: "whatsapp_business_account", entry: "nope" }),
      );
      expect(failed.status).toBe("failed");
      expect(failed.error).toBeTruthy();
    });

    it("[AC-WS-5] reprocesses a failed event into processed without duplicating", async () => {
      const h = await createHarness();
      vi.spyOn(h.adapter.messages, "insertInbound").mockRejectedValueOnce(new Error("db blip"));
      const event = await h.deliver(freshFixture("text"));
      expect(event.status).toBe("failed");
      expect(h.messages("in")).toHaveLength(0);

      const again = await h.sendo.events.reprocess(event.id);
      expect(again).toMatchObject({ id: event.id, status: "processed", error: null });
      expect(h.messages("in")).toHaveLength(1);
      await h.sendo.events.reprocess(event.id);
      expect(h.messages("in")).toHaveLength(1);
    });
  });

  it("[AC-WS-6] prune deletes events older than 30 days by default, and honours eventRetentionDays", async () => {
    let now = new Date(Date.now() - 31 * DAY_MS);
    const byDefault = await createHarness({ memory: { now: () => now } });
    const custom = await createHarness({ eventRetentionDays: 7, memory: { now: () => now } });
    for (const h of [byDefault, custom]) await h.adapter.events.insert({ payload: { old: true } });
    now = new Date(Date.now() - 10 * DAY_MS);
    for (const h of [byDefault, custom]) await h.adapter.events.insert({ payload: { mid: true } });
    now = new Date();
    for (const h of [byDefault, custom])
      await h.adapter.events.insert({ payload: { fresh: true } });

    expect(await byDefault.sendo.maintenance.prune()).toBe(1);
    expect(byDefault.adapter.__state.events.size).toBe(2);
    expect(await custom.sendo.maintenance.prune()).toBe(2);
    expect(custom.adapter.__state.events.size).toBe(1);
    expect(await byDefault.sendo.maintenance.prune({ olderThanDays: 5 })).toBe(1);
  });

  it("[AC-WS-7] a sentinel token never reaches adapter rows, logs or errors across the full flow", async () => {
    const SENTINEL = "SENTINEL_TOKEN_xyz";
    const seenAuth = new Set<string>();
    const recordAuth = ({ request }: { request: Request }) => {
      seenAuth.add(request.headers.get("authorization") ?? "");
    };
    graph.server.events.on("request:start", recordAuth);
    try {
      graph.server.use(acceptSends(), ...mediaHandlers());
      const h = await createHarness({ resolveToken: () => SENTINEL });
      const accountErrors: AccountErrorEvent[] = [];
      h.sendo.on("account.error", (e) => {
        accountErrors.push(e);
      });
      h.sendo.agent({
        name: "recepcion",
        model: scriptedModel(textResult("Con gusto te ayudo.")),
        instructions: "Recepción.",
        fallbackMessage: "Disculpa, intenta de nuevo.",
      });

      // Happy path: inbound text + agent reply, inbound image (media download) + reply, statuses.
      await h.deliver(freshFixture("text"));
      await h.deliver(freshFixture("image"));
      await h.deliver("status-delivered");
      await h.deliver("status-read");
      expect(h.messages("out").length).toBeGreaterThanOrEqual(2);
      expect(h.adapter.__state.storage.size).toBe(1);

      // Failure paths: Meta echoes the bearer token back in its error payloads.
      const echo = (request: Request, code: number) =>
        HttpResponse.json(
          {
            error: {
              code,
              message: `Invalid OAuth access token ${request.headers.get("authorization") ?? ""} (${SENTINEL})`,
              error_data: { details: `access_token=${SENTINEL}` },
              fbtrace_id: "TRACE",
            },
          },
          { status: 401 },
        );
      graph.server.use(
        http.post(`${GRAPH}/:phoneNumberId/messages`, ({ request }) => echo(request, 190)),
        http.get(`${GRAPH}/:mediaId`, ({ request }) => echo(request, 190)),
      );
      const sendError = await h.sendo.send
        .text(`+${FIXTURE_IDS.waId}`, "Recordatorio")
        .catch((e: unknown) => e);
      expect(sendError).toBeInstanceOf(MetaApiError);
      expect((sendError as MetaApiError).metaCode).toBe(190);

      // The agent's reply and an inbound media download now fail inside the pipeline.
      await h.deliver(freshFixture("text", (s) => s.replace("wamid.TEXT0001", "wamid.TEXT0002")));
      await h.deliver(freshFixture("image", (s) => s.replace("wamid.IMAGE001", "wamid.IMAGE002")));

      expect([...seenAuth]).toContain(`Bearer ${SENTINEL}`);
      expect(accountErrors.length).toBeGreaterThanOrEqual(1);
      expect(h.logs.entries.length).toBeGreaterThan(0);
      const failedRows = h.messages("out").filter((m) => m.status === "failed");
      expect(failedRows.length).toBeGreaterThanOrEqual(2);

      const state = dumpState(h.adapter.__state);
      expect(state).toContain("Con gusto te ayudo.");
      expect(state).toContain("wamid.IMAGE002");
      expect(state).not.toContain(SENTINEL);
      expect(inspect(h.logs.entries, { depth: 20 })).not.toContain(SENTINEL);
      expect(
        h.logs.entries.map((e) => e.args.map((a) => errorSurface(a)).join(" ")).join("\n"),
      ).not.toContain(SENTINEL);
      expect(errorSurface(sendError)).not.toContain(SENTINEL);
      for (const event of accountErrors) expect(errorSurface(event.error)).not.toContain(SENTINEL);
    } finally {
      graph.server.events.removeListener("request:start", recordAuth);
    }
  });
});
