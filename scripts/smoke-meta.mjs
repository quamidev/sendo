#!/usr/bin/env node
// Manual smoke run against a real Meta app and a real number (`pnpm smoke:meta`, runbook in
// docs/smoke-meta.md). Never runs in CI.
//
// Two modes:
// - App mode (`--app <dir>` or SENDO_SMOKE_APP): runs against the @quami/sendo installed in that
//   app's node_modules (the published package) and reads the app's .env.local / .env. This is
//   the launch run (AC-RM-1/2): the app was built by following only the sendo.quami.dev quickstart.
// - Monorepo mode (default, for development): runs against packages/sendo/dist and the
//   playground's configuration.
//
// Path A (own Meta app) or Path B (Sendo Connect) is picked from the environment: with
// SENDO_CONNECT_API_KEY / SENDO_CONNECT_SIGNING_SECRET set it is Path B.
//
// The app must be running with a real model and reachable at a public HTTPS URL; this script
// shares its Supabase database, sends through the package and asks the tester to act on their
// phone. It writes test-results/smoke-meta.json (or --out): timestamp, mode, path, steps with
// pass/fail/blocked, Meta ids and error codes, and findings. The report and all console output
// go through the package's redaction utilities.
//
// Exit codes: 0 every step passed, 1 a step failed or was blocked, 2 missing env or usage
// error, 130 interrupted.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const monorepoPackageDir = join(root, "packages/sendo");
const defaultReportPath = join(root, "test-results/smoke-meta.json");
// `pnpm smoke:meta` runs from the repo root; relative paths are resolved from where it was typed.
const callerCwd = process.env.INIT_CWD ?? process.cwd();

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_INTERRUPTED = 130;

/** Run order. `checks` are the runbook's eight checks (docs/smoke-meta.md) each step covers. */
const STEPS = [
  { id: "doctor", checks: [], title: "pre-flight: sendo doctor" },
  { id: "template", checks: [3], title: "approved template outside the window" },
  { id: "template-rejected", checks: [3], title: "a template that isn't approved fails clearly" },
  { id: "inbound-text", checks: [1, 2], title: "receive a text and the agent replies" },
  { id: "status-read", checks: [2, 8], title: "statuses reach read, in order" },
  { id: "inbound-image", checks: [4], title: "media download to storage" },
  { id: "handoff", checks: [], title: "handoff and return to the agent" },
  { id: "embedded-signup", checks: [5], title: "connect a second number with the button" },
  { id: "billing", checks: [6], title: "number without a payment method" },
  { id: "coexistence", checks: [7], title: "the number keeps working in the phone app" },
];
const STEP_IDS = STEPS.map((s) => s.id);

const STEP_LINES = STEPS.map((s) => {
  const covers = s.checks.length > 0 ? `check ${s.checks.join(", ")}` : "";
  return `  ${s.id.padEnd(18)} ${covers.padEnd(13)} ${s.title}`;
}).join("\n");

const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3 };

const USAGE = `pnpm smoke:meta [--app <dir>] [--only <ids>] [--timeout <seconds>] [--out <file>]
node scripts/smoke-meta.mjs --app <dir> ...   (same thing, no install needed in this repo)

Manual smoke run against a real Meta app (runbook: docs/smoke-meta.md). Interactive; never in CI.

Options:
  --app <dir>          Run against the @quami/sendo installed in that app's node_modules (the
                       published package) and read the app's .env.local / .env. Also SENDO_SMOKE_APP.
                       Without it: monorepo development mode (packages/sendo/dist + playground env).
  --only <ids>         Comma-separated subset of the steps below
  --timeout <seconds>  How long to wait for each webhook-driven result (default 120)
  --out <file>         Report path (default test-results/smoke-meta.json in this repo)
  --help, -h           Show this help

Steps (run order; check numbers from the runbook):
${STEP_LINES}

Path A (own Meta app) needs SENDO_META_APP_SECRET. Path B (Sendo Connect) is used when
SENDO_CONNECT_API_KEY or SENDO_CONNECT_SIGNING_SECRET is set; then both are required.

Required env (shell, or the app's .env.local / .env):
  SENDO_SMOKE_TO              Tester's WhatsApp number (E.164, e.g. +50255551234)
  SENDO_SMOKE_WEBHOOK_URL     Public URL of the app's webhook route (https://<app>/api/sendo/webhook)
  SENDO_VERIFY_TOKEN          Webhook verify token (same value the app uses)
  SENDO_META_APP_SECRET       Path A: Meta app secret (same value the app uses)
  SENDO_CONNECT_API_KEY       Path B: from the Connect panel (app.sendo.quami.dev)
  SENDO_CONNECT_SIGNING_SECRET  Path B: from the Connect panel
  SUPABASE_URL                Or NEXT_PUBLIC_SUPABASE_URL; the app's Supabase
  SUPABASE_SERVICE_ROLE_KEY   Service role key of that Supabase
  SENDO_AGENT_MODEL           Real model id the app's agent uses (no mock model)
  <token_ref>                 The env var named in sendo_accounts.token_ref (e.g. SENDO_TOKEN_MAIN)

Optional env:
  SENDO_SMOKE_APP                    Same as --app
  SENDO_SMOKE_ACCOUNT                phone_number_id to test (default: the only active account)
  SENDO_SMOKE_TEMPLATE               Approved template name (default hello_world)
  SENDO_SMOKE_TEMPLATE_LANGUAGE      Template language (default en_US)
  SENDO_SMOKE_TEMPLATE_VARIABLES     Comma-separated body variables (default none)
  SENDO_SMOKE_BAD_TEMPLATE           Template name that is NOT approved (default sendo_smoke_not_approved)
  SENDO_SMOKE_BILLING_ACCOUNT        phone_number_id of a number without a payment method
                                     (default: the number connected in the embedded-signup step)
  SENDO_SMOKE_COEXISTENCE_ACCOUNT    phone_number_id of a number also used in the WhatsApp Business
                                     app (default: a coexistence number found in sendo_accounts)
  SENDO_CONNECT_BASE_URL             Path B: Connect base URL (default https://connect.sendo.quami.dev)
  SENDO_STORAGE_BUCKET               Media bucket (default sendo-media)
`;

const SECRET_NAME_RE = /(TOKEN|SECRET|KEY|PASSWORD)/i;
const MIN_SECRET_LENGTH = 8;

class StepBlocked extends Error {
  constructor(message) {
    super(message);
    this.name = "StepBlocked";
  }
}

// ---------- env ----------

function value(name) {
  const raw = process.env[name]?.trim();
  return raw === undefined || raw === "" ? undefined : raw;
}

/** Loads KEY=value files without overriding variables that are already set. */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || match[1] in process.env) continue;
    let raw = match[2];
    if (/^(["']).*\1$/.test(raw)) raw = raw.slice(1, -1);
    else raw = raw.replace(/\s+#.*$/, "");
    if (raw !== "") process.env[match[1]] = raw;
  }
}

function envSecrets(extra = []) {
  const fromEnv = Object.entries(process.env)
    .filter(([key, v]) => SECRET_NAME_RE.test(key) && (v?.length ?? 0) >= MIN_SECRET_LENGTH)
    .map(([, v]) => v);
  return [...fromEnv, ...extra.filter((v) => typeof v === "string" && v.length > 0)];
}

function smokePath() {
  return value("SENDO_CONNECT_API_KEY") !== undefined ||
    value("SENDO_CONNECT_SIGNING_SECRET") !== undefined
    ? "B"
    : "A";
}

function configErrors(mode) {
  if (value("SUPABASE_URL") === undefined && value("NEXT_PUBLIC_SUPABASE_URL") !== undefined) {
    process.env.SUPABASE_URL = value("NEXT_PUBLIC_SUPABASE_URL");
  }
  const where = mode === "app" ? "the app" : "the playground";
  const required = [
    ["SENDO_SMOKE_TO", "the tester's WhatsApp number in E.164 (e.g. +50255551234)"],
    [
      "SENDO_SMOKE_WEBHOOK_URL",
      `the public URL of ${where}'s webhook route (https://<app>/api/sendo/webhook)`,
    ],
    ["SENDO_VERIFY_TOKEN", `the webhook verify token ${where} uses`],
    ["SUPABASE_URL", `${where}'s Supabase URL (NEXT_PUBLIC_SUPABASE_URL also works)`],
    ["SUPABASE_SERVICE_ROLE_KEY", "the service role key of that Supabase"],
    [
      "SENDO_AGENT_MODEL",
      `the real model id ${where}'s agent uses (the mock model is not allowed)`,
    ],
  ];
  if (smokePath() === "B") {
    required.push(
      [
        "SENDO_CONNECT_API_KEY",
        "Path B: the project API key from the Connect panel (app.sendo.quami.dev)",
      ],
      ["SENDO_CONNECT_SIGNING_SECRET", "Path B: the signing secret from the Connect panel"],
    );
  } else {
    required.push(["SENDO_META_APP_SECRET", "Path A: the Meta app secret"]);
  }
  const errors = required
    .filter(([name]) => value(name) === undefined)
    .map(([name, what]) => `  - ${name}: ${what}`);
  const webhookUrl = value("SENDO_SMOKE_WEBHOOK_URL");
  if (webhookUrl !== undefined && !/^https:\/\//.test(webhookUrl)) {
    errors.push("  - SENDO_SMOKE_WEBHOOK_URL must be a public https URL (Meta rejects http)");
  }
  if (mode === "monorepo") {
    if (value("SENDO_PLAYGROUND_MODE") === "fixtures") {
      errors.push("  - SENDO_PLAYGROUND_MODE=fixtures: remove it so the playground uses Supabase");
    }
    if (value("SENDO_PLAYGROUND_FAKE_META") === "true") {
      errors.push("  - SENDO_PLAYGROUND_FAKE_META=true: remove it so the playground calls Meta");
    }
  }
  return errors;
}

// ---------- output ----------

let secrets = [];
let redactText = (text) => text;
let redactLogValue = (v) => JSON.stringify(v);

function say(text = "") {
  process.stdout.write(`${redactText(text, secrets)}\n`);
}

function fail(text, code) {
  process.stderr.write(`${redactText(text, secrets)}\n`);
  process.exit(code);
}

function maskPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 4 ? "****" : `+${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function errorText(error) {
  if (error instanceof Error) {
    const code =
      typeof error.code === "number" || typeof error.code === "string" ? error.code : null;
    const meta = metaErrorOf(error);
    const metaPart = meta === null ? "" : ` [${metaErrorSummary(meta)}]`;
    return code === null
      ? `${error.name}: ${error.message}${metaPart}`
      : `${error.name} (${code}): ${error.message}${metaPart}`;
  }
  return String(error);
}

function metaErrorSummary(meta) {
  const parts = [`Meta code ${meta.code ?? "?"}`];
  if (meta.subcode !== null) parts.push(`subcode ${meta.subcode}`);
  if (meta.fbtraceId !== null) parts.push(`fbtrace_id ${meta.fbtraceId}`);
  return parts.join(", ");
}

/** Meta's raw error fields from a MetaApiError / EmbeddedSignupError; `null` for other errors. */
function metaErrorOf(error) {
  if (!(error instanceof Error) || !("metaCode" in error)) return null;
  const pick = (v) => (v === undefined ? null : v);
  return {
    status: pick(error.status),
    code: pick(error.metaCode),
    subcode: pick(error.subcode),
    fbtraceId: pick(error.fbtraceId),
    type: pick(error.type),
    hint: pick(error.hint),
    details: pick(error.details),
  };
}

// ---------- package resolution ----------

/**
 * Locates @quami/sendo and its entry files through its own `exports` map, so the run uses
 * exactly what an app importing "@quami/sendo" gets.
 */
function describePackage(packageJsonPath) {
  const dir = dirname(packageJsonPath);
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const exportFile = (subpath) => {
    const entry = manifest.exports?.[subpath];
    const target =
      typeof entry === "string"
        ? entry
        : (entry?.import?.default ?? entry?.import ?? entry?.default ?? null);
    return typeof target === "string" ? join(dir, target) : null;
  };
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.sendo;
  return {
    dir,
    packageJsonPath,
    version: manifest.version ?? null,
    entry: exportFile("."),
    supabaseEntry: exportFile("./adapters/supabase"),
    cli: typeof bin === "string" ? join(dir, bin) : null,
  };
}

function resolvePackage(appDir) {
  if (appDir === null) {
    const pkg = describePackage(join(monorepoPackageDir, "package.json"));
    if (![pkg.entry, pkg.supabaseEntry, pkg.cli].every((file) => file && existsSync(file))) {
      fail("packages/sendo/dist is missing. Run `pnpm build` first.", EXIT_USAGE);
    }
    return pkg;
  }
  const appManifest = join(appDir, "package.json");
  if (!existsSync(appManifest)) {
    fail(
      `--app ${appDir}: there is no package.json there. Point --app (or SENDO_SMOKE_APP) at the root of the app you built with the quickstart.`,
      EXIT_USAGE,
    );
  }
  let packageJsonPath;
  try {
    packageJsonPath = createRequire(appManifest).resolve("@quami/sendo/package.json");
  } catch {
    fail(
      `@quami/sendo is not installed in ${appDir}. Run the quickstart's first step there: pnpm add @quami/sendo ai zod`,
      EXIT_USAGE,
    );
  }
  const pkg = describePackage(packageJsonPath);
  const missing = [
    ["main entry", pkg.entry],
    ["@quami/sendo/adapters/supabase", pkg.supabaseEntry],
    ["sendo bin", pkg.cli],
  ].filter(([, file]) => !file || !existsSync(file));
  if (missing.length > 0) {
    fail(
      `The @quami/sendo installed in ${appDir} (${pkg.dir}) is incomplete: ${missing.map(([what]) => what).join(", ")} not found. Reinstall it (pnpm install) and check the published tarball.`,
      EXIT_USAGE,
    );
  }
  return pkg;
}

function isInside(child, parent) {
  try {
    const c = realpathSync(child);
    const p = realpathSync(parent);
    return c === p || c.startsWith(p + sep);
  } catch {
    return false;
  }
}

function loadSupabaseJs(pkg, appDir) {
  const from = [pkg.packageJsonPath, ...(appDir === null ? [] : [join(appDir, "package.json")])];
  for (const manifest of from) {
    try {
      return createRequire(manifest)("@supabase/supabase-js");
    } catch {
      // try the next location
    }
  }
  return fail(
    "@supabase/supabase-js was not found. Install it in your app: pnpm add @supabase/supabase-js (the @sendo/webhook item adds it).",
    EXIT_USAGE,
  );
}

// ---------- report ----------

let reportPath = defaultReportPath;

const report = {
  tool: "smoke-meta",
  timestamp: new Date().toISOString(),
  finishedAt: null,
  passed: false,
  interrupted: false,
  mode: null,
  path: null,
  appDir: null,
  packageDir: null,
  packageVersion: null,
  graphApiVersion: null,
  account: null,
  tester: null,
  webhookUrl: null,
  agentModel: null,
  steps: [],
  fieldChecks: {},
  discrepancies: [],
};

function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.passed =
    !report.interrupted &&
    report.steps.length > 0 &&
    report.steps.every((step) => step.status === "pass");
  const safe = JSON.parse(redactLogValue(report, secrets));
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(safe, null, 2)}\n`);
  const shown = relative(callerCwd, reportPath);
  return shown.startsWith("..") || isAbsolute(shown) ? reportPath : shown;
}

function addDiscrepancy(step, summary, expected, observed) {
  report.discrepancies.push({ step, summary, expected, observed, link: null });
}

// ---------- helpers ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs, intervalMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

const digits = (phone) => (phone ?? "").replace(/\D/g, "");
const toTime = (date) => (date === null || date === undefined ? null : new Date(date).getTime());

// ---------- main ----------

async function main() {
  let args;
  try {
    args = parseArgs({
      options: {
        app: { type: "string" },
        only: { type: "string" },
        timeout: { type: "string" },
        out: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }).values;
  } catch (error) {
    fail(`${errorText(error)}\n\n${USAGE}`, EXIT_USAGE);
  }
  if (args.help) {
    say(USAGE);
    return EXIT_OK;
  }

  if (process.env.CI) {
    fail(
      "smoke:meta is a manual run against real Meta and never runs in CI (CI is set).",
      EXIT_USAGE,
    );
  }

  const only =
    args.only
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? STEP_IDS;
  const unknown = only.filter((id) => !STEP_IDS.includes(id));
  if (unknown.length > 0) fail(`Unknown step(s): ${unknown.join(", ")}\n\n${USAGE}`, EXIT_USAGE);
  const timeoutSeconds = Number(args.timeout ?? "120");
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    fail("--timeout must be a positive number of seconds.", EXIT_USAGE);
  }
  const timeoutMs = timeoutSeconds * 1000;
  if (args.out !== undefined) reportPath = resolve(callerCwd, args.out);

  const appArg = args.app ?? value("SENDO_SMOKE_APP");
  const appDir = appArg === undefined ? null : resolve(callerCwd, appArg);
  const mode = appDir === null ? "monorepo" : "app";

  const envFiles =
    appDir === null
      ? [".env.local", ".env", "apps/playground/.env.local", "apps/playground/.env"].map((f) =>
          join(root, f),
        )
      : [join(appDir, ".env.local"), join(appDir, ".env")];
  for (const file of envFiles) loadEnvFile(file);
  secrets = envSecrets();

  const errors = configErrors(mode);
  if (errors.length > 0) {
    fail(
      `smoke:meta cannot start; missing or invalid environment:\n${errors.join("\n")}\n\n` +
        (mode === "app"
          ? `Set them in your shell or in ${join(appDir, ".env.local")}. See docs/smoke-meta.md.`
          : "Set them in your shell, .env.local or apps/playground/.env.local. See docs/smoke-meta.md."),
      EXIT_USAGE,
    );
  }
  if (!process.stdin.isTTY) {
    fail("smoke:meta is interactive; run it in a terminal (stdin is not a TTY).", EXIT_USAGE);
  }

  const pkgInfo = resolvePackage(appDir);
  const pkg = await import(pathToFileURL(pkgInfo.entry).href);
  const { supabaseAdapter } = await import(pathToFileURL(pkgInfo.supabaseEntry).href);
  redactText = pkg.redactText;
  redactLogValue = pkg.redactLogValue;
  const supabaseJs = loadSupabaseJs(pkgInfo, appDir);

  const path = smokePath();
  report.mode = mode;
  report.path = path;
  report.appDir = appDir;
  report.packageDir = mode === "app" ? pkgInfo.dir : relative(root, pkgInfo.dir);
  report.packageVersion = pkgInfo.version;
  report.graphApiVersion = pkg.GRAPH_API_VERSION;
  report.tester = maskPhone(value("SENDO_SMOKE_TO"));
  report.webhookUrl = value("SENDO_SMOKE_WEBHOOK_URL");
  report.agentModel = value("SENDO_AGENT_MODEL");

  if (mode === "app" && isInside(pkgInfo.dir, root)) {
    say(
      `WARNING: the app resolves @quami/sendo from this repository (${pkgInfo.dir}), not from npm.`,
    );
    addDiscrepancy(
      "setup",
      "The app uses a local link of @quami/sendo, not the published package",
      "node_modules/@quami/sendo installed from npm",
      pkgInfo.dir,
    );
  }

  const supabase = supabaseJs.createClient(
    value("SUPABASE_URL"),
    value("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const adapter = supabaseAdapter(supabase, {
    storageBucket: value("SENDO_STORAGE_BUCKET") ?? "sendo-media",
  });

  const accountKey = value("SENDO_SMOKE_ACCOUNT");
  let account;
  try {
    if (accountKey !== undefined) {
      account = await adapter.accounts.getByPhoneNumberId(accountKey);
      if (account === null) {
        fail(
          `No sendo_accounts row with phone_number_id ${accountKey}. Run \`npx sendo accounts add\` in the app.`,
          EXIT_USAGE,
        );
      }
    } else {
      const active = (await adapter.accounts.list()).filter((a) => a.active);
      if (active.length !== 1) {
        fail(
          `Found ${active.length} active accounts; set SENDO_SMOKE_ACCOUNT to the phone_number_id to test.`,
          EXIT_USAGE,
        );
      }
      account = active[0];
    }
  } catch (error) {
    fail(`Could not read sendo_accounts from Supabase: ${errorText(error)}`, EXIT_USAGE);
  }
  const accessToken = value(account.tokenRef);
  if (accessToken === undefined) {
    fail(
      `smoke:meta cannot start; missing environment:\n  - ${account.tokenRef}: the Meta access token of account ${account.phoneNumberId} (sendo_accounts.token_ref)`,
      EXIT_USAGE,
    );
  }
  secrets = envSecrets([accessToken]);
  report.account = {
    phoneNumberId: account.phoneNumberId,
    wabaId: account.wabaId,
    displayPhone: account.displayPhone,
    onboardedVia: account.onboardedVia,
    coexistence: account.coexistence,
  };

  const connectBaseUrl = value("SENDO_CONNECT_BASE_URL");
  const sendo = pkg.createSendo({
    adapter,
    ...(path === "B"
      ? {
          connect: {
            apiKey: value("SENDO_CONNECT_API_KEY"),
            signingSecret: value("SENDO_CONNECT_SIGNING_SECRET"),
            ...(connectBaseUrl ? { baseUrl: connectBaseUrl } : {}),
          },
        }
      : { appSecret: value("SENDO_META_APP_SECRET") }),
    verifyToken: value("SENDO_VERIFY_TOKEN"),
    resolveToken: (acc) => {
      const token = value(acc.tokenRef);
      if (token === undefined) throw new Error(`Missing access token env ${acc.tokenRef}`);
      return token;
    },
    // The smoke run reads the inbox as an admin operator of the account's tenant.
    resolveRole: () => Promise.resolve({ role: "admin" }),
  });
  const actor = await sendo.actor("smoke-meta", account.tenantId);

  const to = value("SENDO_SMOKE_TO");
  const templateName = value("SENDO_SMOKE_TEMPLATE") ?? "hello_world";
  const templateLanguage = value("SENDO_SMOKE_TEMPLATE_LANGUAGE") ?? "en_US";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => {
    report.interrupted = true;
    rl.close();
    say(`\nInterrupted. Partial report: ${writeReport()}`);
    process.exit(EXIT_INTERRUPTED);
  });
  const ask = async (question) => (await rl.question(redactText(`${question} `, secrets))).trim();
  const pause = (instruction) => ask(`\n>> ${instruction}\n   Press Enter when done.`);
  const confirm = async (question) => /^y(es)?$/i.test(await ask(`${question} [y/N]`));

  /** Asks the tester for the result of a check they observed; fail/blocked end the step. */
  async function verdict(step, question) {
    for (;;) {
      const answer = (await ask(`${question} [p]ass / [f]ail / [b]locked:`)).toLowerCase();
      const result = answer.startsWith("p")
        ? "pass"
        : answer.startsWith("f")
          ? "fail"
          : answer.startsWith("b")
            ? "blocked"
            : null;
      if (result === null) continue;
      const notes = await ask(
        "   Notes (what you saw, Meta error code, screenshot file; empty for none):",
      );
      step.details.tester = { question, result, notes: notes || null };
      const suffix = notes ? `: ${notes}` : "";
      if (result === "fail") throw new Error(`Marked failed by the tester${suffix}`);
      if (result === "blocked") throw new StepBlocked(`Marked blocked by the tester${suffix}`);
      return;
    }
  }

  const conversationIds = new Map();
  async function findConversationId(acc = account) {
    if (conversationIds.has(acc.id)) return conversationIds.get(acc.id);
    const page = await sendo.inbox.list({
      actor,
      accountId: acc.id,
      limit: 100,
    });
    const match = page.items.find((item) => digits(item.contact.phone) === digits(to));
    if (match) conversationIds.set(acc.id, match.conversation.id);
    return match?.conversation.id ?? null;
  }
  async function thread(acc = account) {
    const id = await findConversationId(acc);
    if (id === null) return [];
    return (await sendo.inbox.thread(id, { actor, limit: 50 })).items.filter((m) => !m.internal);
  }
  const after = (since) => (message) => message.createdAt.getTime() >= since - 5000;
  async function waitInbound(since, predicate, acc = account) {
    return waitFor(
      async () =>
        (await thread(acc)).filter(after(since)).find((m) => m.direction === "in" && predicate(m)),
      timeoutMs,
    );
  }
  async function waitAgentReply(since) {
    return waitFor(
      async () =>
        (await thread())
          .filter(after(since))
          .find((m) => m.direction === "out" && m.sender === "agent"),
      timeoutMs,
    );
  }
  async function accountByPhoneNumberId(phoneNumberId, envName) {
    const found = await adapter.accounts.getByPhoneNumberId(phoneNumberId);
    if (found === null) {
      throw new StepBlocked(
        `No sendo_accounts row with phone_number_id ${phoneNumberId} (${envName})`,
      );
    }
    return found;
  }

  let lastOutbound = null;
  let connectedAccount = null;

  const steps = {
    async doctor(step) {
      const run = spawnSync(
        process.execPath,
        [
          pkgInfo.cli,
          "doctor",
          "--json",
          "--account",
          account.phoneNumberId,
          "--url",
          value("SENDO_SMOKE_WEBHOOK_URL"),
        ],
        { cwd: appDir ?? root, env: process.env, encoding: "utf8", timeout: 120_000 },
      );
      if (run.error) throw run.error;
      let results = [];
      try {
        results = JSON.parse(run.stdout);
      } catch {
        throw new Error(
          `doctor did not print JSON (exit ${run.status}): ${run.stderr || run.stdout}`,
        );
      }
      step.details.checks = results.map((r) => ({ id: r.id, ok: r.ok, detail: r.detail }));
      const failed = results.filter((r) => !r.ok);
      for (const r of failed) say(`   doctor ${r.id}: ${r.detail}`);
      if (run.status !== 0 || failed.length > 0) {
        throw new Error(
          `doctor exited ${run.status}; failing checks: ${failed.map((r) => r.id).join(", ")}`,
        );
      }
    },

    async template(step) {
      const variables = value("SENDO_SMOKE_TEMPLATE_VARIABLES")
        ?.split(",")
        .map((s) => s.trim());
      step.details.template = { name: templateName, language: templateLanguage };
      const existing = await findConversationId();
      const before = existing === null ? null : await sendo.conversations.get(existing);
      const expiresAt = toTime(before?.windowExpiresAt);
      step.details.windowOpenBeforeSend = expiresAt !== null && expiresAt > Date.now();
      if (step.details.windowOpenBeforeSend) {
        say(
          "   Note: the 24-hour window with the tester is open, so this run doesn't prove the template works outside it.",
        );
      }
      const synced = await sendo.templates.sync({ account: account.id });
      step.details.templatesSynced = synced.length;
      if (!synced.some((t) => t.name === templateName && t.language === templateLanguage)) {
        throw new Error(
          `Template ${templateName}/${templateLanguage} is not on the WABA after sync (set SENDO_SMOKE_TEMPLATE / _LANGUAGE)`,
        );
      }
      const message = await sendo.send.template(to, templateName, {
        account: account.id,
        language: templateLanguage,
        ...(variables ? { variables } : {}),
      });
      conversationIds.set(account.id, message.conversationId);
      lastOutbound = message;
      step.metaIds.push(message.metaMessageId);
      if (message.metaMessageId === null)
        throw new Error("Meta accepted the template without a message id");
      await pause("Check your phone: the template message should have arrived.");
      if (!(await confirm("Did the template arrive?"))) {
        throw new Error("The tester did not receive the template");
      }
    },

    async "template-rejected"(step) {
      const name = value("SENDO_SMOKE_BAD_TEMPLATE") ?? "sendo_smoke_not_approved";
      step.details.template = { name, language: templateLanguage };
      let accepted = null;
      let rejection = null;
      try {
        accepted = await sendo.send.template(to, name, {
          account: account.id,
          language: templateLanguage,
        });
      } catch (error) {
        rejection = error;
      }
      if (accepted !== null) {
        step.metaIds.push(accepted.metaMessageId);
        throw new Error(
          `Meta accepted template ${name}; set SENDO_SMOKE_BAD_TEMPLATE to a name that isn't approved on this WABA`,
        );
      }
      step.metaError = metaErrorOf(rejection);
      step.details.error = errorText(rejection);
      say(`   send.template answered: ${errorText(rejection)}`);
      if (step.metaError === null) {
        throw new Error(
          "The send failed without Meta's error code; expected a Meta template error",
        );
      }
      if (!(await confirm("Does that error tell a developer what's wrong and what to do?"))) {
        addDiscrepancy(
          "template-rejected",
          "The error for a template that isn't approved is unclear",
          "an error naming the template problem",
          errorText(rejection),
        );
        throw new Error("The error for a template that isn't approved is unclear");
      }
    },

    async "inbound-text"(step) {
      const since = Date.now();
      await pause('Send "hola" from your phone to the test number now.');
      const inbound = await waitInbound(since, (m) => m.type === "text");
      if (!inbound)
        throw new Error(
          `No inbound text stored within ${timeoutSeconds}s (check the webhook URL, its subscription and the signature)`,
        );
      step.metaIds.push(inbound.metaMessageId);
      step.details.inbound = { text: inbound.text, status: inbound.status };
      step.details.timings = { inboundStoredMs: inbound.createdAt.getTime() - since };
      const reply = await waitAgentReply(since);
      if (!reply) throw new Error(`The agent did not reply within ${timeoutSeconds}s`);
      lastOutbound = reply;
      step.metaIds.push(reply.metaMessageId);
      step.details.timings.agentReplyMs = reply.createdAt.getTime() - inbound.createdAt.getTime();
      step.details.agentReply = {
        text: reply.text,
        status: reply.status,
        senderRef: reply.senderRef,
      };
      say(`   agent replied: ${reply.text ?? `(${reply.type})`}`);
      try {
        await sendo.send.markRead(inbound.id);
        step.details.markRead = "ok";
      } catch (error) {
        step.details.markRead = errorText(error);
        addDiscrepancy(
          "inbound-text",
          "markRead on the inbound message failed",
          "Meta accepts the read receipt",
          errorText(error),
        );
      }
    },

    async "status-read"(step) {
      const target =
        lastOutbound ?? (await thread()).find((m) => m.direction === "out" && m.metaMessageId);
      if (!target)
        throw new Error(
          "No outbound message to watch; run the template or inbound-text step first",
        );
      step.metaIds.push(target.metaMessageId);
      await pause("Open the chat on your phone so the last message from the business is read.");
      const seen = [];
      const read = await waitFor(
        async () => {
          const current = (await thread()).find((m) => m.id === target.id);
          if (current && seen.at(-1) !== current.status) seen.push(current.status);
          return current?.status === "read" ? current : null;
        },
        timeoutMs,
        1000,
      );
      step.details.statusesSeen = seen;
      const regressed = seen.some(
        (status, i) =>
          i > 0 &&
          status in STATUS_RANK &&
          seen[i - 1] in STATUS_RANK &&
          STATUS_RANK[status] < STATUS_RANK[seen[i - 1]],
      );
      step.details.regressed = regressed;
      if (regressed) {
        addDiscrepancy(
          "status-read",
          "The stored status went backwards",
          "sent → delivered → read, never backwards",
          seen.join(" → "),
        );
        throw new Error(`The stored status went backwards: ${seen.join(" → ")}`);
      }
      if (!read)
        throw new Error(
          `Status did not reach "read" within ${timeoutSeconds}s (seen: ${seen.join(" → ") || "none"}); check that read receipts are on in the phone's WhatsApp privacy settings`,
        );
    },

    async "inbound-image"(step) {
      const since = Date.now();
      await pause("Send a photo (any image) from your phone to the test number now.");
      const image = await waitInbound(
        since,
        (m) => m.type === "image" && m.media?.downloadStatus !== "pending",
      );
      if (!image) throw new Error(`No downloaded inbound image within ${timeoutSeconds}s`);
      step.metaIds.push(image.metaMessageId);
      step.details.media = {
        downloadStatus: image.media?.downloadStatus,
        mimeType: image.media?.mimeType,
        sizeBytes: image.media?.sizeBytes,
      };
      if (image.media?.downloadStatus !== "done" || !image.media.url) {
        throw new Error(`Image download_status is ${image.media?.downloadStatus ?? "missing"}`);
      }
      const response = await fetch(image.media.url);
      const bytes = response.ok ? (await response.arrayBuffer()).byteLength : 0;
      step.details.storageFetch = { status: response.status, bytes };
      if (!response.ok || bytes === 0)
        throw new Error(`Stored image could not be read back (HTTP ${response.status})`);
      if (image.media.sizeBytes !== null && image.media.sizeBytes !== bytes) {
        addDiscrepancy(
          "inbound-image",
          "Stored size differs from size_bytes",
          String(image.media.sizeBytes),
          String(bytes),
        );
      }
    },

    async handoff(step) {
      await pause('Send "I want to talk to a person" from your phone now.');
      const id = await waitFor(() => findConversationId(), timeoutMs);
      if (!id) throw new Error("No conversation found for the tester's number");
      let handedOff = await waitFor(async () => {
        const c = await sendo.conversations.get(id);
        return c?.status === "human" ? c : null;
      }, timeoutMs);
      if (handedOff) {
        step.details.handoff = {
          by: "agent",
          reason: handedOff.handoffReason,
          assignedTo: handedOff.assignedTo,
        };
      } else {
        addDiscrepancy(
          "handoff",
          "The agent did not hand off on an explicit request",
          'status "human"',
          "status unchanged",
        );
        if (
          !(await confirm(
            "The agent did not hand off. Force a handoff through the API to test the return?",
          ))
        ) {
          throw new Error("No handoff");
        }
        handedOff = await sendo.conversations.handoff(id, {
          reason: "smoke-meta",
          by: "smoke-meta",
          message: null,
        });
        step.details.handoff = { by: "api", reason: handedOff.handoffReason };
      }
      const returned = await sendo.conversations.returnToAgent(id, { by: "smoke-meta" });
      step.details.returnedStatus = returned.status;
      const back = Date.now();
      await pause('Send "hello again" from your phone now.');
      const reply = await waitAgentReply(back);
      if (!reply)
        throw new Error(`The agent did not reply after the return within ${timeoutSeconds}s`);
      step.metaIds.push(reply.metaMessageId);
      if (step.details.handoff.by === "api")
        throw new Error("Return worked, but the handoff had to be forced");
    },

    async "embedded-signup"(step) {
      const before = new Set(
        (await adapter.accounts.list()).filter((a) => a.active).map((a) => a.id),
      );
      const since = Date.now();
      await pause(
        "In your app's numbers screen, click the connect button and finish Meta's Embedded Signup with a second number.",
      );
      const added = await waitFor(
        async () =>
          (await adapter.accounts.list()).find((a) => a.active && !before.has(a.id)) ?? null,
        timeoutMs,
      );
      if (!added) {
        throw new Error(
          `No newly connected number in sendo_accounts within ${timeoutSeconds}s (read the error the numbers screen shows)`,
        );
      }
      connectedAccount = added;
      const expectedVia = path === "B" ? "connect" : "embedded_signup";
      step.details.account = {
        phoneNumberId: added.phoneNumberId,
        wabaId: added.wabaId,
        displayPhone: added.displayPhone,
        onboardedVia: added.onboardedVia,
        coexistence: added.coexistence,
        billingReady: added.billingReady,
        reactivated: toTime(added.createdAt) !== null && toTime(added.createdAt) < since - 5000,
      };
      step.details.timings = { connectedMs: Date.now() - since };
      say(`   connected ${added.displayPhone} (${added.phoneNumberId}) via ${added.onboardedVia}`);
      if (added.onboardedVia !== expectedVia) {
        addDiscrepancy(
          "embedded-signup",
          "Unexpected onboarded_via on the connected number",
          expectedVia,
          added.onboardedVia,
        );
      }
      await verdict(
        step,
        "Did the numbers screen show the new number as connected, with no error along the way?",
      );
    },

    async billing(step) {
      const billingKey = value("SENDO_SMOKE_BILLING_ACCOUNT");
      const target =
        billingKey !== undefined
          ? await accountByPhoneNumberId(billingKey, "SENDO_SMOKE_BILLING_ACCOUNT")
          : connectedAccount;
      if (target === null) {
        throw new StepBlocked(
          "No number to test; run the embedded-signup step first or set SENDO_SMOKE_BILLING_ACCOUNT",
        );
      }
      const token = value(target.tokenRef);
      let billingReady = target.billingReady;
      if (token !== undefined) {
        secrets = envSecrets([accessToken, token]);
        billingReady = (await sendo.accounts.refreshBilling(target.id)).billingReady;
        step.details.refreshed = true;
      } else {
        const stored = await adapter.accounts.getByPhoneNumberId(target.phoneNumberId);
        billingReady = stored?.billingReady ?? billingReady;
        step.details.refreshed = false;
      }
      step.details.account = {
        phoneNumberId: target.phoneNumberId,
        wabaId: target.wabaId,
        displayPhone: target.displayPhone,
      };
      step.details.billingReady = billingReady;
      say(`   billingReady for ${target.displayPhone}: ${String(billingReady)}`);
      if (billingReady !== false) {
        throw new Error(
          `billingReady is ${String(billingReady)}; expected false for a number without a payment method (check Business Settings → Payment methods)`,
        );
      }
      if (token === undefined) {
        say(
          `   The token of this number (${target.tokenRef}) isn't in the env, so the send is done from the app.`,
        );
        await pause(
          `In your app's inbox, send any message from ${target.displayPhone} (reply to a conversation on that number).`,
        );
        await verdict(
          step,
          "Did the send fail with an error that says the number has no payment method?",
        );
        return;
      }
      let accepted = null;
      let rejection = null;
      try {
        accepted = await sendo.send.template(to, templateName, {
          account: target.id,
          language: templateLanguage,
        });
      } catch (error) {
        rejection = error;
      }
      if (accepted !== null) {
        step.metaIds.push(accepted.metaMessageId);
        throw new Error("Meta accepted a send from a number whose WABA has no payment method");
      }
      step.metaError = metaErrorOf(rejection);
      step.details.error = errorText(rejection);
      say(`   send.template answered: ${errorText(rejection)}`);
      if (step.metaError?.code !== 131042) {
        throw new Error(
          `Expected Meta error 131042 (no payment method), got: ${errorText(rejection)}`,
        );
      }
    },

    async coexistence(step) {
      const coexKey = value("SENDO_SMOKE_COEXISTENCE_ACCOUNT");
      let target = null;
      if (coexKey !== undefined) {
        target = await accountByPhoneNumberId(coexKey, "SENDO_SMOKE_COEXISTENCE_ACCOUNT");
      } else {
        target =
          [account, connectedAccount].find((a) => a?.coexistence) ??
          (await adapter.accounts.list()).find((a) => a.active && a.coexistence) ??
          null;
      }
      if (target === null) {
        throw new StepBlocked(
          "No coexistence number in sendo_accounts; connect one with the WhatsApp Business app option or set SENDO_SMOKE_COEXISTENCE_ACCOUNT",
        );
      }
      step.details.account = {
        phoneNumberId: target.phoneNumberId,
        displayPhone: target.displayPhone,
        coexistence: target.coexistence,
      };
      const convBefore = await findConversationId(target).then((id) =>
        id === null ? null : sendo.conversations.get(id),
      );
      const echoSince = Date.now();
      await pause(
        `On the phone with the WhatsApp Business app for ${target.displayPhone}, send a message to your phone.`,
      );
      const echo = await waitFor(
        async () =>
          (await thread(target))
            .filter(after(echoSince))
            .find((m) => m.direction === "out" && m.senderRef === "business_app"),
        timeoutMs,
      );
      step.details.echo = echo
        ? { stored: true, status: echo.status, sender: echo.sender }
        : { stored: false };
      if (echo) step.metaIds.push(echo.metaMessageId);
      const echoConvId = await findConversationId(target);
      const convAfter = echoConvId === null ? null : await sendo.conversations.get(echoConvId);
      if (
        convBefore !== null &&
        convAfter !== null &&
        toTime(convBefore.lastInboundAt) !== toTime(convAfter.lastInboundAt)
      ) {
        addDiscrepancy(
          "coexistence",
          "An echo changed last_inbound_at (the window must not move)",
          String(convBefore.lastInboundAt),
          String(convAfter.lastInboundAt),
        );
      }
      const inboundSince = Date.now();
      await pause(`From your phone, reply to ${target.displayPhone} now.`);
      const inbound = await waitInbound(inboundSince, () => true, target);
      step.details.inboundStored = Boolean(inbound);
      if (inbound) step.metaIds.push(inbound.metaMessageId);
      if (!echo) {
        throw new Error(
          `The phone-app message wasn't stored as an echo within ${timeoutSeconds}s (is smb_message_echoes subscribed?)`,
        );
      }
      if (!inbound) throw new Error(`The reply wasn't stored within ${timeoutSeconds}s`);
      await verdict(
        step,
        "Did both messages also show in the WhatsApp Business app on the phone, with no logout or warning?",
      );
    },
  };

  say(`Sendo smoke run against Meta (Graph ${report.graphApiVersion})`);
  say(path === "B" ? "Path B: via Sendo Connect" : "Path A: own Meta app");
  say(
    mode === "app"
      ? `Package @quami/sendo@${report.packageVersion} from ${pkgInfo.dir} (app ${appDir})`
      : `Package packages/sendo/dist @ ${report.packageVersion} (monorepo development mode)`,
  );
  say(`Account ${account.phoneNumberId} (WABA ${account.wabaId}), tester ${report.tester}`);
  say(`Webhook ${report.webhookUrl}, model ${report.agentModel}`);
  say(`Steps: ${only.join(", ")}`);

  for (const { id, checks } of STEPS) {
    if (!only.includes(id)) continue;
    const step = {
      id,
      checks,
      status: "pass",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      metaIds: [],
      metaError: null,
      details: {},
      error: null,
    };
    report.steps.push(step);
    const covers = checks.length > 0 ? ` (check ${checks.join(", ")})` : "";
    say(`\n[${report.steps.length}/${only.length}] ${id}${covers}`);
    const started = Date.now();
    try {
      await steps[id](step);
      say("   PASS");
    } catch (error) {
      step.status = error instanceof StepBlocked ? "blocked" : "fail";
      step.error = errorText(error);
      step.metaError ??= metaErrorOf(error);
      say(`   ${step.status === "blocked" ? "BLOCKED" : "FAIL"}: ${step.error}`);
    }
    step.metaIds = step.metaIds.filter(Boolean);
    step.durationMs = Date.now() - started;
  }

  report.fieldChecks.billing = await checkBillingField(
    account,
    accessToken,
    report.graphApiVersion,
  );
  say(`\nBilling field (primary_funding_id): ${report.fieldChecks.billing.result}`);

  say(
    "\nRecord every quickstart deviation and anything Meta did differently from docs/smoke-meta.md.",
  );
  for (;;) {
    const summary = await ask("Finding (empty to finish):");
    if (summary === "") break;
    const link = await ask("  Issue link, or empty if fixed in this branch:");
    report.discrepancies.push({
      step: "manual",
      summary,
      expected: null,
      observed: null,
      link: link || null,
    });
  }
  rl.close();

  const reportShown = writeReport();
  const notPassed = report.steps.filter((s) => s.status !== "pass");
  say(
    notPassed.length === 0
      ? "\nAll steps passed"
      : `\n${notPassed.length} step(s) did not pass: ${notPassed.map((s) => `${s.id} (${s.status})`).join(", ")}`,
  );
  say(`${report.discrepancies.length} finding(s). Report: ${reportShown}`);
  return notPassed.length === 0 ? EXIT_OK : EXIT_FAILED;
}

/** Reads the WABA funding field the billing state relies on (verify it against Meta's docs). */
async function checkBillingField(account, accessToken, version) {
  const url = `https://graph.facebook.com/${version}/${account.wabaId}?fields=primary_funding_id`;
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        request: `GET /${account.wabaId}?fields=primary_funding_id`,
        status: response.status,
        result: "error",
        error: body?.error?.message ?? null,
        metaError: body?.error
          ? {
              code: body.error.code ?? null,
              subcode: body.error.error_subcode ?? null,
              fbtraceId: body.error.fbtrace_id ?? null,
            }
          : null,
      };
    }
    const present = typeof body?.primary_funding_id === "string" && body.primary_funding_id !== "";
    return {
      request: `GET /${account.wabaId}?fields=primary_funding_id`,
      status: response.status,
      result: present ? "present" : "absent",
    };
  } catch (error) {
    return {
      request: `GET /${account.wabaId}?fields=primary_funding_id`,
      status: null,
      result: "error",
      error: errorText(error),
    };
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    report.steps.push({ id: "runner", status: "fail", error: errorText(error) });
    let partial = "";
    try {
      partial = ` Partial report: ${writeReport()}`;
    } catch {
      // keep the original error
    }
    fail(`smoke:meta crashed: ${errorText(error)}.${partial}`, EXIT_FAILED);
  },
);
