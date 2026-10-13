import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

/** `next start --port 3001` (see `playwright.config.ts`). */
export const BASE_URL = "http://localhost:3001";

export const LANGS = ["es", "en"] as const;
export type Lang = (typeof LANGS)[number];

/** The five marketing pages that exist under both prefixes (AC-ST-2), without the prefix. */
export const PAGES = ["", "/pricing", "/demo", "/compare", "/changelog"] as const;

export const LANG_COOKIE = "sendo-lang";
export const DEMO_CONVERSATION_ID = "demo-conversation";

const SCREENSHOT_DIR = path.join(import.meta.dirname, "..", "test-results", "screenshots");

/**
 * A full-viewport screenshot under `test-results/screenshots/<name>.png` (kept between runs, unlike
 * Playwright's output dir) and attached to the test, so the JSON report lists it.
 */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

/** Every iframe (the demo inbox) has loaded and the page is idle on the network. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
}
