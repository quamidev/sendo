import { NextResponse, type NextRequest } from "next/server";
import { LANG_COOKIE } from "@/lib/i18n/langs";
import { negotiateLang } from "@/lib/i18n/negotiate";

/** The registry host serves only `/r/*` and a JSON index at `/` (AC-ST-14). */
const REGISTRY_HOST = "registry.sendo.quami.dev";
const SITE_ORIGIN = "https://sendo.quami.dev";
/** Route handler behind the registry host's `/`. */
const REGISTRY_INDEX_PATH = "/r";

/** Unprefixed marketing pages (and their deep paths) that get a language prefix. */
const MARKETING = /^\/(?:pricing|demo|compare|changelog|privacy|terms|data-deletion)(?:\/.*)?$/;
/** The demo's iframe page lives at `/demo/inbox`, outside `[lang]`. */
const FRAME = /^\/demo\/inbox(?:\/.*)?$/;

function hostOf(request: NextRequest): string {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  return host.toLowerCase().replace(/:\d+$/, "");
}

/**
 * - On `registry.sendo.quami.dev`: `/r/*` passes, `/` serves the registry index, anything else is a 308
 *   to the same path on `https://sendo.quami.dev`.
 * - `/` and unprefixed `/pricing|/demo|/compare|/changelog|/privacy|/terms|/data-deletion` (deep
 *   paths too): 307 to `/{lang}/…`,
 *   `lang` from the `sendo-lang` cookie, else `Accept-Language`, else `en` (AC-ST-1). Never sets a
 *   cookie: only the header's language selector does.
 * - Everything else (`/docs`, `/r`, `/api`, `/_next`, `/llms*.txt`, static files, `/es/*`, `/en/*`)
 *   passes untouched.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (hostOf(request) === REGISTRY_HOST) {
    if (pathname === "/r" || pathname.startsWith("/r/")) return NextResponse.next();
    if (pathname === "/") {
      return NextResponse.rewrite(new URL(REGISTRY_INDEX_PATH, request.url));
    }
    return NextResponse.redirect(new URL(`${pathname}${search}`, SITE_ORIGIN), 308);
  }

  if (pathname !== "/" && (!MARKETING.test(pathname) || FRAME.test(pathname))) {
    return NextResponse.next();
  }

  const lang = negotiateLang(
    request.cookies.get(LANG_COOKIE)?.value,
    request.headers.get("accept-language"),
  );
  const url = request.nextUrl.clone();
  url.pathname = pathname === "/" ? `/${lang}` : `/${lang}${pathname}`;
  return NextResponse.redirect(url, 307);
}

export const config = {
  // Everything but Next's build assets: the registry host rule has to see every other path.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
