/**
 * The home page and the live demo at 1280×800 (SNL-7.1). The server runs with no model
 * (`SENDO_DEMO_MODEL=""`), so the demo answers with its scripted fallback (`fallback: "no_model"`).
 *
 * - [AC-ST-5] the install commands are exactly `pnpm add @quami/sendo ai zod` and
 *   `npx shadcn add @sendo/webhook @sendo/schema`, and there are exactly two of them.
 * - [AC-ST-6] `/en` and `/es` show headline, install commands and the whole demo with no vertical
 *   scroll (`scrollHeight <= innerHeight`), the inbox iframe's bottom inside the viewport.
 * - [AC-ST-8] desktop: the composer's pulsing invite shows at idle; sending a message moves the
 *   step strip `idle → sent → replied` and the invite goes away.
 * - [AC-ST-8b] the inbox sits in the host-app frame (browser bar + sidebar); after the first
 *   message the visitor's conversation is first in the list inside that frame and opened.
 * - [AC-ST-9] the demo inbox (`/demo/inbox?lang=`) renders in the page's language, on the home
 *   stage and on `/{lang}/demo`.
 */
import { expect, test, type Page } from "@playwright/test";
import { DEMO_CONVERSATION_ID, LANGS, screenshot, settle, type Lang } from "./support";

test.use({ viewport: { width: 1280, height: 800 } });

const INSTALL_COMMANDS = [
  "pnpm add @quami/sendo ai zod",
  "npx shadcn add @sendo/webhook @sendo/schema",
];

/** The inbox's search field label, per locale (registry `inboxStrings`). */
const INBOX_SEARCH_LABEL: Record<Lang, string> = {
  es: "Buscar conversaciones",
  en: "Search conversations",
};

function inboxFrame(page: Page) {
  return page.frameLocator('[data-testid="demo-inbox-frame"]');
}

test("[AC-ST-5] the home install commands are exact", async ({ page }) => {
  for (const lang of LANGS) {
    await page.goto(`/${lang}`);
    const commands = page.getByTestId("install-command").locator("code");
    await expect(commands).toHaveCount(2);
    // The `$ ` prompt is decoration (`aria-hidden`, not selectable); the command is the rest.
    const texts = await commands.evaluateAll((codes) =>
      codes.map((code) =>
        [...code.childNodes]
          .filter((node) => !(node instanceof HTMLElement && node.getAttribute("aria-hidden")))
          .map((node) => node.textContent)
          .join("")
          .trim(),
      ),
    );
    expect(texts).toEqual(INSTALL_COMMANDS);
  }
});

test.describe("[AC-ST-6] one screen at 1280×800", () => {
  for (const lang of LANGS) {
    test(`[AC-ST-6] /${lang} has no vertical scroll and the whole demo is in view`, async ({
      page,
    }, testInfo) => {
      await page.goto(`/${lang}`);
      await settle(page);

      await expect(page.getByRole("heading", { level: 1 })).toBeInViewport({ ratio: 1 });
      for (const command of await page.getByTestId("install-command").all()) {
        await expect(command).toBeInViewport({ ratio: 1 });
      }
      await expect(page.getByTestId("demo-chat")).toBeInViewport({ ratio: 1 });

      const { scrollHeight, innerHeight } = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      }));
      expect(scrollHeight).toBeLessThanOrEqual(innerHeight);

      const frame = await page.getByTestId("demo-inbox-frame").boundingBox();
      expect(frame).not.toBeNull();
      expect((frame?.y ?? 0) + (frame?.height ?? 0)).toBeLessThanOrEqual(innerHeight);
      expect(frame?.height ?? 0).toBeGreaterThan(200);

      await screenshot(page, testInfo, `home-${lang}-1280x800`);
    });
  }
});

test("[AC-ST-8] [AC-ST-8b] invite, step strip and the visitor's conversation in the host frame", async ({
  page,
}, testInfo) => {
  // Hold the demo's answer briefly so the `sent` step is observable before `replied`.
  await page.route("**/api/demo", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await page.goto("/en");
  await settle(page);

  const steps = page.getByTestId("stage-steps");
  const host = page.getByTestId("host-app-frame");
  await expect(steps).toHaveAttribute("data-stage", "idle");
  await expect(page.getByTestId("demo-chat-invite")).toBeVisible();

  // AC-ST-8b: the inbox iframe is inside the host frame, with its browser bar and sidebar.
  await expect(host.getByTestId("demo-inbox-frame")).toBeVisible();
  await expect(host).toContainText("admin.torrevista.gt/inbox");
  for (const entry of ["Residents", "Payments", "Bookings", "Settings"]) {
    await expect(host.getByText(entry, { exact: true })).toBeVisible();
  }
  await expect(host.locator('li[aria-current="page"]')).toHaveText(/^Inbox/);
  await screenshot(page, testInfo, "home-en-1280x800-idle");

  const chat = page.getByTestId("demo-chat");
  const message = "Hi, what time does the pool open?";
  await chat.getByRole("textbox").fill(message);
  await chat.getByRole("textbox").press("Enter");

  await expect(steps).toHaveAttribute("data-stage", "sent");
  await expect(page.getByTestId("demo-chat-invite")).toHaveCount(0);
  await expect(steps).toHaveAttribute("data-stage", "replied");
  await expect(chat.getByTestId("demo-chat-note")).toHaveAttribute("data-fallback", "no_model");

  const rows = inboxFrame(page).locator("[data-conversation-id]");
  await expect(rows.first()).toHaveAttribute("data-conversation-id", DEMO_CONVERSATION_ID);
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await expect(inboxFrame(page).getByText(message).first()).toBeVisible();
  await screenshot(page, testInfo, "home-en-1280x800-replied");
});

test.describe("[AC-ST-9] the demo inbox speaks the page's language", () => {
  for (const lang of LANGS) {
    for (const path of ["", "/demo"]) {
      test(`[AC-ST-9] /${lang}${path}`, async ({ page }) => {
        await page.goto(`/${lang}${path}`);
        const frame = page.getByTestId("demo-inbox-frame");
        await expect(frame).toHaveAttribute("src", `/demo/inbox?lang=${lang}`);
        await expect(inboxFrame(page).locator("html")).toHaveAttribute("lang", lang);
        await expect(inboxFrame(page).getByLabel(INBOX_SEARCH_LABEL[lang])).toBeVisible();
        const other = lang === "es" ? "en" : "es";
        await expect(inboxFrame(page).getByLabel(INBOX_SEARCH_LABEL[other])).toHaveCount(0);
      });
    }
  }
});
