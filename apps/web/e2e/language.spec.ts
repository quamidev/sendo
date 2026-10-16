/**
 * Language routing and copy, in a real browser against `next start` (SNL-7.1).
 *
 * - [AC-ST-1] `/` goes to `/es` for `Accept-Language: es-GT`, to `/en` for `fr`, and a stored
 *   `sendo-lang` cookie wins over the header (both directions).
 * - [AC-ST-2] home, pricing, demo, compare and changelog exist under `/es` and `/en`, each with the
 *   right `<html lang>` and `hreflang` alternates for `es`, `en` and `x-default` (→ English).
 * - [AC-ST-3] the header language selector on `/en/pricing` opens `/es/pricing`, stores
 *   `sendo-lang=es`, and the next visit to `/` lands on `/es`.
 * - [AC-ST-4] the rendered text of every `/en` page has no Spanish stop-words or characters and
 *   every `/es` page no English stop-words; code, elements in another `lang` (the changelog
 *   entries' `lang="en"` wrapper, the other language's name in the selector) and the demo inbox
 *   iframe (checked by AC-ST-9) are left out, as are product names.
 */
import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, LANG_COOKIE, LANGS, PAGES, type Lang } from "./support";

test.describe("[AC-ST-1] / follows the stored choice, else Accept-Language", () => {
  const cases: { name: string; header: string; cookie?: Lang; expected: Lang }[] = [
    { name: "es-GT goes to /es", header: "es-GT,es;q=0.9", expected: "es" },
    { name: "fr goes to /en", header: "fr", expected: "en" },
    { name: "the cookie es beats Accept-Language fr", header: "fr", cookie: "es", expected: "es" },
    {
      name: "the cookie en beats Accept-Language es-GT",
      header: "es-GT",
      cookie: "en",
      expected: "en",
    },
  ];
  for (const { name, header, cookie, expected } of cases) {
    test(`[AC-ST-1] ${name}`, async ({ browser }) => {
      // Chromium derives `Accept-Language` from the locale, so both are set to the case's header.
      const context = await browser.newContext({
        locale: header.split(",")[0],
        extraHTTPHeaders: { "accept-language": header },
      });
      if (cookie) await context.addCookies([{ name: LANG_COOKIE, value: cookie, url: BASE_URL }]);
      const page = await context.newPage();
      await page.goto("/");
      await expect(page).toHaveURL(`${BASE_URL}/${expected}`);
      await expect(page.locator("html")).toHaveAttribute("lang", expected);
      await context.close();
    });
  }
});

test("[AC-ST-2] five pages per language with <html lang> and hreflang alternates", async ({
  page,
}) => {
  for (const lang of LANGS) {
    for (const path of PAGES) {
      const response = await page.goto(`/${lang}${path}`, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `/${lang}${path}`).toBe(200);
      await expect(page.locator("html"), `/${lang}${path}`).toHaveAttribute("lang", lang);
      const alternates = await page
        .locator('head link[rel="alternate"][hreflang]')
        .evaluateAll((links) =>
          Object.fromEntries(
            links.map((link) => [
              link.getAttribute("hreflang"),
              new URL(link.getAttribute("href") ?? "", "https://sendo.quami.dev").pathname,
            ]),
          ),
        );
      expect(alternates, `/${lang}${path}`).toEqual({
        es: `/es${path}`,
        en: `/en${path}`,
        "x-default": `/en${path}`,
      });
    }
  }
});

test("[AC-ST-3] the selector switches /en/pricing to /es/pricing and / remembers it", async ({
  page,
  context,
}) => {
  await page.goto("/en/pricing");
  await page
    .getByRole("banner")
    .getByRole("button", { name: /Language/ })
    .click();
  await page.getByRole("menuitem", { name: "Español" }).click();

  await expect(page).toHaveURL(`${BASE_URL}/es/pricing`);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  const cookie = (await context.cookies()).find((each) => each.name === LANG_COOKIE);
  expect(cookie?.value).toBe("es");
  expect(cookie?.path).toBe("/");

  // The context still sends `Accept-Language: en-US`: only the cookie can pick Spanish.
  await page.goto("/");
  await expect(page).toHaveURL(`${BASE_URL}/es`);
});

const SPANISH_WORDS = new Set(
  (
    "el los las del al que y para por con una unos unas es son está están su sus tu tus sin pero " +
    "más también cuando donde como muy hay este esta estos precio precios mensajes cuenta"
  ).split(" "),
);
const SPANISH_CHARS = /[ñáéíóú¿¡]/gi;
const ENGLISH_WORDS = new Set(
  (
    "the and of to with your you is are for this that from our will be by not can more read see " +
    "how what who why which when free price pricing soon coming page language theme main plans"
  ).split(" "),
);
/** Identical in both languages by design. */
const PRODUCT_NAMES = [
  "Sendo Connect",
  "WhatsApp Business",
  "WhatsApp Cloud API",
  "Respond.io",
  "Next.js",
  "GitHub",
  "Tech Provider",
  "Embedded Signup",
];

/** The page's own copy: visible text outside code, `<script>`, iframes and `lang`-marked parts. */
function ownText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = node.textContent?.trim() ?? "";
      if (parent === null || text === "") continue;
      if (parent.closest("code, pre, kbd, script, style, noscript, template") !== null) continue;
      // Parts marked with their own `lang` are quoted, not page copy: the changelog entries
      // (`<div lang="en">` on both prefixes) and the language names in the selector.
      if (parent.closest("body [lang]") !== null) continue;
      if (!parent.checkVisibility({ visibilityProperty: true })) continue;
      out.push(text);
    }
    return out;
  });
}

function leaks(lang: Lang, texts: string[]): string[] {
  const found: string[] = [];
  for (const text of texts) {
    let clean = text;
    for (const name of PRODUCT_NAMES) clean = clean.split(name).join(" ");
    const words = (clean.match(/\p{L}+/gu) ?? []).map((word) => word.toLowerCase());
    const hits =
      lang === "en"
        ? [
            ...words.filter((word) => SPANISH_WORDS.has(word)),
            ...(clean.match(SPANISH_CHARS) ?? []),
          ]
        : words.filter((word) => ENGLISH_WORDS.has(word));
    if (hits.length > 0) found.push(`${hits.join(", ")} in "${text}"`);
  }
  return found;
}

test.describe("[AC-ST-4] no text from the other language", () => {
  for (const lang of LANGS) {
    for (const path of PAGES) {
      test(`[AC-ST-4] /${lang}${path}`, async ({ page }) => {
        await page.goto(`/${lang}${path}`);
        await page.waitForLoadState("networkidle");
        const texts = await ownText(page);
        // Guards against a vacuous pass (e.g. a wrapper with `lang` around the whole page).
        expect(texts.length).toBeGreaterThan(10);
        expect(leaks(lang, texts)).toEqual([]);
      });
    }
  }
});
