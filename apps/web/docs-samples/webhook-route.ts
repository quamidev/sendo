// app/api/sendo/webhook/route.ts (installed by @sendo/sendo-webhook)
import { toNextHandlers } from "@quami/sendo/next";
import { sendo } from "./sendo";

export const { GET, POST } = toNextHandlers(sendo); // POST uses next/server `after()`
export const runtime = "nodejs";
export const maxDuration = 60;
