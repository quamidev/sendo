/**
 * The legal pages Meta's app review points at (privacy policy, terms, data deletion
 * instructions), in a real browser against `next start`. `<html lang>`, `hreflang` and language
 * leaks are covered for them by AC-ST-2 and AC-ST-4 (`language.spec.ts`, via `PAGES`).
 *
 * - [LEGAL-1] `/{es,en}/{privacy,terms,data-deletion}` answer 200 and show the provider's full
 *   legal name, NIT and contact email (`lib/legal/entity.ts`).
 * - [LEGAL-2] unprefixed `/privacy`, `/terms` and `/data-deletion` redirect like `/pricing`: a 307 to
 *   the detected language (`Accept-Language: es-GT` → `/es/…`, `fr` → `/en/…`).
 * - [LEGAL-3] the footer of the content pages and the home (desktop and mobile) link to the three
 *   pages in the page's language.
 */
import { expect, test, type Locator } from "@playwright/test";
import { BASE_URL, LANGS, LEGAL_PAGES } from "./support";

const LEGAL_NAME = "Multi Inversiones de Desarrollo e Innovación, Sociedad Anónima";
const TAX_ID = "120177366";
const EMAIL = "legal@quami.dev";

test.use({ viewport: { width: 1280, height: 800 } });

test("[LEGAL-1] the six legal URLs answer 200 with the legal name", async ({ page }) => {
  for (const lang of LANGS) {
    for (const path of LEGAL_PAGES) {
      const url = `/${lang}${path}`;
      const response = await page.goto(url);
      expect(response?.status(), url).toBe(200);
      const entity = page.getByTestId("legal-entity");
      await expect(entity, url).toContainText(LEGAL_NAME);
      await expect(entity, url).toContainText(TAX_ID);
      await expect(entity.locator(`a[href="mailto:${EMAIL}"]`), url).toBeVisible();
      await expect(page.locator("main").getByText(LEGAL_NAME).first(), url).toBeVisible();
    }
  }
});

test("[LEGAL-2] unprefixed legal paths redirect like /pricing", async ({ request }) => {
  for (const [header, lang] of [
    ["es-GT,es;q=0.9", "es"],
    ["fr", "en"],
  ] as const) {
    for (const path of ["/pricing", ...LEGAL_PAGES]) {
      const response = await request.get(path, {
        headers: { "accept-language": header },
        maxRedirects: 0,
      });
      expect(response.status(), `${header} ${path}`).toBe(307);
      expect(new URL(response.headers().location ?? "", BASE_URL).pathname).toBe(`/${lang}${path}`);
    }
  }
});

test.describe("[LEGAL-3] footer links to the legal pages", () => {
  for (const lang of LANGS) {
    test(`[LEGAL-3] /${lang}`, async ({ browser }) => {
      const expected = LEGAL_PAGES.map((path) => `/${lang}${path}`);
      const hrefs = (scope: Locator) =>
        scope.evaluateAll((links) => links.map((link) => link.getAttribute("href")));

      const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      for (const path of ["/pricing", "/compare", "/changelog", "/privacy"]) {
        await desktop.goto(`/${lang}${path}`);
        const footer = desktop.getByRole("contentinfo");
        for (const href of expected) {
          await expect(footer.locator(`a[href="${href}"]`), `${path} ${href}`).toBeVisible();
        }
      }
      await desktop.goto(`/${lang}`);
      const homeLinks = await hrefs(desktop.locator("main a").filter({ visible: true }));
      expect(homeLinks).toEqual(expect.arrayContaining(expected));
      await desktop
        .locator(`main a[href="${expected[0] ?? ""}"]`)
        .filter({ visible: true })
        .click();
      await expect(desktop).toHaveURL(`${BASE_URL}${expected[0] ?? ""}`);
      await desktop.close();

      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await mobile.goto(`/${lang}`);
      const mobileLinks = await hrefs(mobile.locator("main a").filter({ visible: true }));
      expect(mobileLinks).toEqual(expect.arrayContaining(expected));
      await mobile.close();
    });
  }
});
