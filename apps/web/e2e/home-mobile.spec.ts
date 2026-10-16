/**
 * The home page and the demo at 390×844 with touch (SNL-7.1), scripted demo (no model).
 *
 * - [AC-ST-7] `/en`, `/es`, `/en/demo` and `/es/demo` have no horizontal scroll
 *   (`scrollWidth <= innerWidth`), before and after a message is sent on the home page.
 * - [AC-ST-7] [AC-ST-8] mobile: the suggestion chips show until the first message; tapping one
 *   sends it, the Team inbox badge appears while the phone view is active, switching to the inbox
 *   pane clears it, and the visitor's conversation is the first row inside the inbox iframe.
 */
import { expect, test, type Page } from "@playwright/test";
import { DEMO_CONVERSATION_ID, LANGS, screenshot, settle } from "./support";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

function horizontalOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

test.describe("[AC-ST-7] no horizontal scroll at 390×844", () => {
  for (const lang of LANGS) {
    for (const path of ["", "/demo"]) {
      test(`[AC-ST-7] /${lang}${path}`, async ({ page }, testInfo) => {
        await page.goto(`/${lang}${path}`);
        await settle(page);
        const { scrollWidth, innerWidth } = await horizontalOverflow(page);
        expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
        if (path === "") await screenshot(page, testInfo, `home-${lang}-390x844`);
      });
    }
  }
});

test("[AC-ST-7] [AC-ST-8] a chip sends from the phone view, the badge appears, the inbox shows it", async ({
  page,
}, testInfo) => {
  await page.goto("/en");
  await settle(page);

  const demo = page.getByTestId("mobile-demo");
  const toggle = page.getByTestId("mobile-demo-toggle");
  const chips = page.getByTestId("mobile-demo-chips");
  await expect(demo).toHaveAttribute("data-pane", "phone");
  await expect(chips).toBeVisible();
  await expect(page.getByTestId("mobile-demo-badge")).toHaveCount(0);

  const chip = chips.getByRole("button").first();
  const message = (await chip.textContent())?.trim() ?? "";
  await chip.tap();

  await expect(page.getByTestId("mobile-demo-badge")).toBeVisible();
  await expect(chips).toHaveCount(0);
  await expect(page.getByTestId("demo-chat").getByText(message)).toBeVisible();
  const after = await horizontalOverflow(page);
  expect(after.scrollWidth).toBeLessThanOrEqual(after.innerWidth);
  await screenshot(page, testInfo, "home-en-390x844-badge");

  await toggle.locator('button[data-pane="inbox"]').tap();
  await expect(demo).toHaveAttribute("data-pane", "inbox");
  await expect(page.getByTestId("mobile-demo-badge")).toHaveCount(0);

  const frame = page.frameLocator('[data-testid="demo-inbox-frame"]');
  const first = frame.locator("[data-conversation-id]").first();
  await expect(first).toHaveAttribute("data-conversation-id", DEMO_CONVERSATION_ID);
  await expect(first).toBeVisible();
  await expect(first).toContainText("You (visitor)");
  await screenshot(page, testInfo, "home-en-390x844-inbox");
});
