// app/api/cron/wa-prune/route.ts
import { wa } from "./whatsapp";

export const runtime = "nodejs";

export async function GET(request: Request) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const deleted = await wa.maintenance.prune(); // events older than eventRetentionDays
  return Response.json({ deleted });
}
