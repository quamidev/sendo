import { handleDemoRequest } from "@/lib/demo/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The live demo (see `lib/demo/handler.ts`): `{ transcript, text, from? }` → new turns + inbox view. */
export function POST(request: Request): Promise<Response> {
  return handleDemoRequest(request, process.env);
}
