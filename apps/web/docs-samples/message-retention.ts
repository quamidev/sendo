// app/api/cron/wa-message-retention/route.ts — YOUR policy for wa_messages / wa_media.
import { createClient } from "@supabase/supabase-js";

const RETENTION_DAYS = 365;
const BUCKET = process.env.WA_STORAGE_BUCKET ?? "whatsapp-media";

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET ?? ""}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();

  // 1. Delete the stored files first (Storage API, not SQL on storage.objects).
  const { data: media, error } = await supabase
    .from("wa_media")
    .select("storage_path")
    .lt("created_at", cutoff)
    .not("storage_path", "is", null)
    .limit(1000);
  if (error) throw error;
  const paths = (media as { storage_path: string }[]).map((row) => row.storage_path);
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);

  // 2. Delete old messages; wa_media rows cascade.
  const { count } = await supabase
    .from("wa_messages")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);
  return Response.json({ files: paths.length, messages: count ?? 0 });
}
