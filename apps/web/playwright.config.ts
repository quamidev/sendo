import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./e2e/support";

/**
 * The site's browser E2E suite (SNL-7.1): `pnpm --filter web test:e2e` (or `pnpm test:e2e` from the
 * root, where turbo builds `web` first). Specs live in `e2e/`; the artifact is
 * `test-results/e2e-report.json` plus the screenshots under `test-results/screenshots/`.
 *
 * The server is the production build (`next start` on 3001). When there is no build yet, the
 * command builds once through turbo (package → registry → web, so `/r/*` has its files) before
 * starting. Locally an already running server on 3001 is reused; on CI it never is.
 */
const PORT = new URL(BASE_URL).port;

// `npm_execpath` is the pnpm that runs `test:e2e`, so the build fallback works without pnpm on PATH.
const pnpm = process.env.npm_execpath
  ? `"${process.execPath}" "${process.env.npm_execpath}"`
  : "pnpm";
const build = `${pnpm} --dir ../.. exec turbo run build --filter=web`;

export default defineConfig({
  testDir: "./e2e",
  // Playwright empties `outputDir` on start; keep it apart from the report and screenshots.
  outputDir: "./test-results/e2e-artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "test-results/e2e-report.json" }]],
  use: {
    baseURL: BASE_URL,
    // A fixed, non-Spanish default so language detection is deterministic (tests override it).
    locale: "en-US",
    extraHTTPHeaders: { "accept-language": "en-US" },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `sh -c 'test -f .next/BUILD_ID || ${build}; exec next start --port ${PORT}'`,
    url: `${BASE_URL}/en`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      // No model: the demo answers with its scripted fallback (`fallback: "no_model"`), so no
      // model key, spend or KV store is needed. The specs assert that note.
      SENDO_DEMO_MODEL: "",
      SENDO_DEMO_BUDGET_USD: "",
      SENDO_DEMO_DAILY_CAP: "",
    },
  },
});
