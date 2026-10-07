import type { HandleWebhookOptions } from "../core/slots";

type WaitUntil = NonNullable<HandleWebhookOptions["waitUntil"]>;

/** The part of a wa-li client the route handlers need. */
export interface WebhookHandlerClient {
  handleWebhook(request: Request, opts?: HandleWebhookOptions): Promise<Response>;
}

export interface NextHandlersOptions {
  /**
   * Keeps the background pipeline alive after the Response. Default: `after()` from
   * `next/server`; if it cannot be loaded the work runs as a detached promise.
   */
  waitUntil?: WaitUntil;
}

export interface NextHandlers {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
}

let nextAfter: Promise<WaitUntil | undefined> | undefined;

/** Loads `after` lazily so this module never needs `next` at import time. */
function loadAfter(): Promise<WaitUntil | undefined> {
  nextAfter ??= import("next/server").then(
    (mod) => {
      const after = mod.after as ((task: Promise<unknown>) => void) | undefined;
      if (typeof after !== "function") return undefined;
      return (promise: Promise<unknown>) => {
        after(promise);
      };
    },
    () => undefined,
  );
  return nextAfter;
}

/**
 * Next.js App Router handlers for the webhook route:
 * `export const { GET, POST } = toNextHandlers(wa);`
 */
export function toNextHandlers(
  wa: WebhookHandlerClient,
  opts: NextHandlersOptions = {},
): NextHandlers {
  return {
    GET: (request) => wa.handleWebhook(request),
    async POST(request) {
      const waitUntil = opts.waitUntil ?? (await loadAfter());
      return wa.handleWebhook(request, waitUntil === undefined ? {} : { waitUntil });
    },
  };
}
