// Runs Sendo's periodic work: after-hours bookkeeping, escalations, auto-close, broadcast batches,
// billing re-checks and the daily event prune (`sendo.maintenance.tick`). Call it every minute
// from Vercel Cron (vercel.json) or pg_cron (`net.http_post`); see the workflows docs.
import { createHash, timingSafeEqual } from "node:crypto";
import { sendo } from "@/lib/sendo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** `SENDO_CRON_SECRET`, plus Vercel's `CRON_SECRET` (Vercel Cron sends it as the bearer token). */
function cronSecrets(): string[] {
  return ["SENDO_CRON_SECRET", "CRON_SECRET"]
    .map((name) => process.env[name]?.trim() ?? "")
    .filter((value) => value !== "");
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** `Authorization: Bearer <secret>`, compared in constant time against every configured secret. */
function authorized(header: string | null, secrets: string[]): boolean {
  const token = /^Bearer (.+)$/i.exec(header?.trim() ?? "")?.[1];
  if (token === undefined) return false;
  const given = digest(token);
  return secrets.map((secret) => timingSafeEqual(given, digest(secret))).includes(true);
}

async function tick(request: Request): Promise<Response> {
  const secrets = cronSecrets();
  if (!authorized(request.headers.get("authorization"), secrets)) {
    if (secrets.length === 0)
      console.warn("[sendo] tick: set SENDO_CRON_SECRET to enable /api/sendo/tick");
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const report = await sendo.maintenance.tick();
    return Response.json(report);
  } catch (error) {
    console.error("[sendo] tick failed", error);
    return Response.json({ error: "tick_failed" }, { status: 500 });
  }
}

export const GET = tick;
export const POST = tick;
