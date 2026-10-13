/**
 * Header and content links a visitor follows (SNL-7.1), at 1280×800.
 *
 * - [AC-ST-10] the header nav has Compare (`/{lang}/compare`); the compare page shows its table
 *   and links to `/docs/migrating-from-respond-io-kapso`, which opens.
 * - [AC-ST-11] pricing's `#coexistence` section links to `/docs/coexistence` (and so does compare,
 *   which also promotes it); following the link shows the doc's seven limits under `#limits`.
 * - [AC-ST-12] pricing links to Meta's rate card (`https://developers.facebook.com/docs/whatsapp/pricing`).
 * - [AC-ST-13] the header's version badge reads `v<semver>` and links to
 *   `https://www.npmjs.com/package/@quami/sendo`, on `/es`, `/en` and `/docs`.
 */
import { expect, test } from "@playwright/test";
import { LANGS, type Lang } from "./support";

test.use({ viewport: { width: 1280, height: 800 } });

const COMPARE_LABEL: Record<Lang, string> = { es: "Comparar", en: "Compare" };
const MIGRATION_DOC = "/docs/migrating-from-respond-io-kapso";
const COEXISTENCE_DOC = "/docs/coexistence";
const META_RATE_CARD = "https://developers.facebook.com/docs/whatsapp/pricing";
const NPM_URL = "https://www.npmjs.com/package/@quami/sendo";

test.describe("[AC-ST-10] Compare in the header, linking to the migration doc", () => {
  for (const lang of LANGS) {
    test(`[AC-ST-10] /${lang}`, async ({ page }) => {
      await page.goto(`/${lang}`);
      const compare = page
        .getByRole("banner")
        .getByRole("link", { name: COMPARE_LABEL[lang], exact: true });
      await expect(compare).toHaveAttribute("href", `/${lang}/compare`);
      await compare.click();
      await expect(page).toHaveURL(new RegExp(`/${lang}/compare$`));
      await expect(page.getByTestId("compare-table")).toBeVisible();

      const migration = page.locator(`main a[href="${MIGRATION_DOC}"]`).first();
      await expect(migration).toBeVisible();
      await migration.click();
      await expect(page).toHaveURL(new RegExp(`${MIGRATION_DOC}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }
});

test.describe("[AC-ST-11] coexistence links to the doc with its seven limits", () => {
  for (const lang of LANGS) {
    test(`[AC-ST-11] /${lang}/pricing and /${lang}/compare`, async ({ page }) => {
      await page.goto(`/${lang}/compare`);
      await expect(page.locator(`main a[href="${COEXISTENCE_DOC}"]`).first()).toBeAttached();

      await page.goto(`/${lang}/pricing`);
      // The paragraph right under the `#coexistence` heading.
      const body = page.locator("#coexistence").locator("xpath=following::p[1]");
      const link = body.locator(`a[href="${COEXISTENCE_DOC}"]`);
      await expect(link).toHaveCount(1);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${COEXISTENCE_DOC}$`));

      const limits = page.locator("#limits").locator("xpath=following::ol[1]/li");
      await expect(limits).toHaveCount(7);
    });
  }
});

test.describe("[AC-ST-12] pricing links to Meta's rate card", () => {
  for (const lang of LANGS) {
    test(`[AC-ST-12] /${lang}/pricing`, async ({ page }) => {
      await page.goto(`/${lang}/pricing`);
      await expect(page.locator(`main a[href="${META_RATE_CARD}"]`).first()).toBeVisible();
    });
  }
});

test.describe("[AC-ST-13] the version badge links to npm", () => {
  for (const path of ["/es", "/en", "/docs"]) {
    test(`[AC-ST-13] ${path}`, async ({ page }) => {
      await page.goto(path);
      const badge = page.getByRole("banner").locator(`a[href="${NPM_URL}"]`);
      await expect(badge).toHaveCount(1);
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(/^v\d+\.\d+\.\d+/);
    });
  }
});
