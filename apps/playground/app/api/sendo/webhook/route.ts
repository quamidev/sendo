import { sendo } from "@/lib/sendo";
import { toNextHandlers } from "@quami/sendo/next";
export const { GET, POST } = toNextHandlers(sendo); // POST uses next/server `after()` for background work
export const runtime = "nodejs";
export const maxDuration = 60;
