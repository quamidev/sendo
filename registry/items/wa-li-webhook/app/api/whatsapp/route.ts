import { wa } from "@/lib/whatsapp";
import { toNextHandlers } from "@quami/wa-li/next";
export const { GET, POST } = toNextHandlers(wa); // POST uses next/server `after()` for background work
export const runtime = "nodejs";
export const maxDuration = 60;
