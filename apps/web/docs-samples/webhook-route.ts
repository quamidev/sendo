// app/api/whatsapp/route.ts (installed by @quami/wa-li-webhook)
import { toNextHandlers } from "@quami/wa-li/next";
import { wa } from "./whatsapp";

export const { GET, POST } = toNextHandlers(wa); // POST uses next/server `after()`
export const runtime = "nodejs";
export const maxDuration = 60;
