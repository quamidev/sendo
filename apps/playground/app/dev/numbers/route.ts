import { NextResponse, type NextRequest } from "next/server";
import { isNumbersFixture, NUMBERS_FIXTURE_COOKIE } from "@/fixtures/numbers";
import { playgroundMode } from "@/lib/playground-env";

/**
 * `break-ui` switch for the numbers screen (fixtures mode only): `/dev/numbers?data=demo|worst|empty|agent`
 * stores the dataset in a cookie and opens `/inbox/numbers`, which then runs as that fixture's
 * user and tenant (see app/(protected)/inbox/numbers/numbers-config.ts).
 */
export function GET(request: NextRequest): NextResponse {
  if (playgroundMode() !== "fixtures") return new NextResponse("Not found", { status: 404 });
  const data = request.nextUrl.searchParams.get("data") ?? "demo";
  const response = NextResponse.redirect(new URL("/inbox/numbers", request.url));
  if (isNumbersFixture(data)) {
    response.cookies.set(NUMBERS_FIXTURE_COOKIE, data, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
    });
  }
  return response;
}
