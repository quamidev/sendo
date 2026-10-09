import { ConfigError } from "../../errors/errors";
import type { MetaDirectTransport } from "../../transport/meta-direct";
import type { Transport } from "../../transport/types";
import { SIGNATURE_HEADER, verifyChallenge, verifySignature } from "../../webhook/verify";
import type { WhatsAppContext } from "../context";
import type { HandleWebhookOptions } from "../slots";
import { processEvent } from "./process-event";

function isMetaDirect(transport: Transport): transport is MetaDirectTransport {
  const candidate = transport as Partial<MetaDirectTransport>;
  return (
    transport.kind === "meta-direct" &&
    typeof candidate.appSecret === "string" &&
    typeof candidate.verifyToken === "string"
  );
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** Runs `processEvent` after the Response: through `waitUntil`, else as a detached promise. */
function schedule(ctx: WhatsAppContext, eventId: string, opts: HandleWebhookOptions): void {
  const task = processEvent(ctx, eventId).then(
    () => undefined,
    (error: unknown) => {
      ctx.logger.error(`[wa-li] background processing of event ${eventId} failed`, error);
    },
  );
  if (opts.waitUntil === undefined) return;
  try {
    opts.waitUntil(task);
  } catch (error) {
    ctx.logger.warn("[wa-li] waitUntil threw; event processing continues detached", error);
  }
}

/**
 * Framework-agnostic webhook entry point. GET answers Meta's challenge. POST verifies
 * `X-Hub-Signature-256` on the raw body (401), stores the event as `received`, returns
 * 200 and processes it in the background.
 */
export function createHandleWebhook(ctx: WhatsAppContext) {
  return async function handleWebhook(
    request: Request,
    opts: HandleWebhookOptions = {},
  ): Promise<Response> {
    const { transport } = ctx;
    if (!isMetaDirect(transport)) {
      if (transport.handleWebhook) return transport.handleWebhook(request);
      throw new ConfigError(
        `wa.handleWebhook: transport "${transport.kind}" has no appSecret/verifyToken and no handleWebhook().`,
      );
    }

    if (request.method === "GET") {
      return verifyChallenge(new URL(request.url), transport.verifyToken);
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, POST" } });
    }

    const raw = await request.text();
    if (!verifySignature(raw, request.headers.get(SIGNATURE_HEADER), transport.appSecret)) {
      ctx.logger.warn("[wa-li] webhook rejected: invalid or missing X-Hub-Signature-256");
      return text(401, "Invalid signature");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return text(400, "Invalid JSON");
    }

    let eventId: string;
    try {
      eventId = (await ctx.adapter.events.insert({ payload })).id;
    } catch (error) {
      // Non-2xx makes Meta retry the delivery later.
      ctx.logger.error("[wa-li] could not store the webhook event", error);
      return text(500, "Could not store event");
    }

    schedule(ctx, eventId, opts);
    return text(200, "OK");
  };
}
