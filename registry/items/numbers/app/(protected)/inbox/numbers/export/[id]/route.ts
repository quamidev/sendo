import { exportFileName } from "@quami/sendo";
import { sendo } from "@/lib/sendo";
import { requireUser } from "../../numbers-config";

export const dynamic = "force-dynamic";

/**
 * The error's `code` (`FORBIDDEN`, `ACCOUNT_NOT_FOUND`, …). Read by shape, not `instanceof`: a
 * route handler can be bundled with its own copy of the package's error classes.
 */
function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

function empty(status: 403 | 404 | 500): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * "Export conversations": streams one number's history as a JSON download
 * (`sendo.accounts.export`, a `SendoExportDocumentV1`). Admins only (`numbers.manage`): anyone
 * else gets 403 with no body; an unknown id, or a number of another tenant, gets 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { id } = await params;
  if (id === "" || id.length > 200) return empty(404);

  let chunks: AsyncIterator<string>;
  let first: IteratorResult<string>;
  try {
    const actor = await sendo.actor(user.userId, user.tenantId);
    // Throws FORBIDDEN (no numbers.manage) on the call, before any chunk.
    chunks = sendo.accounts.export(id, { actor })[Symbol.asyncIterator]();
    // Unknown id or another tenant's number: ACCOUNT_NOT_FOUND on the first chunk.
    first = await chunks.next();
  } catch (error) {
    const code = errorCode(error);
    if (code === "FORBIDDEN") return empty(403);
    if (code === "ACCOUNT_NOT_FOUND") return empty(404);
    console.error("[sendo numbers] export failed", error);
    return empty(500);
  }

  const account = await sendo.accounts.get(id);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.done === true) controller.close();
      else controller.enqueue(encoder.encode(first.value));
    },
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done === true) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        console.error("[sendo numbers] export stream failed", error);
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return?.();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${exportFileName(account.displayPhone, new Date())}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
