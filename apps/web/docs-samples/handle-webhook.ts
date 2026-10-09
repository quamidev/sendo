import { sendo } from "./sendo";

// #region generic
// Any runtime with Web Request/Response (Hono, Supabase Edge Functions, Workers...).
const worker = {
  fetch(request: Request, _env: unknown, ctx: { waitUntil(p: Promise<unknown>): void }) {
    // GET: verify challenge. POST: signature check, store event, 200, then process in
    // the background through waitUntil (without it the work runs as a detached promise).
    return sendo.handleWebhook(request, { waitUntil: (p) => ctx.waitUntil(p) });
  },
};

export default worker;
// #endregion generic
