#!/usr/bin/env node
// Manual smoke run against a real Meta app and test number (`pnpm smoke:meta`, runbook in
// docs/smoke-meta.md). Never runs in CI. The playground must be running in Supabase mode with a
// real model and reachable through a public tunnel; this script shares its Supabase database,
// sends through the built @quami/sendo package and asks the tester to act on their phone.
//
// Writes test-results/smoke-meta.json (timestamp, steps, pass/fail, Meta ids, discrepancies).
// The report and all console output go through the package's redaction utilities.
//
// Exit codes: 0 every step passed, 1 a step failed, 2 missing env or usage error, 130 interrupted.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(root, "packages/sendo");
const distDir = join(packageDir, "dist");
const reportPath = join(root, "test-results/smoke-meta.json");

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_INTERRUPTED = 130;

const STEP_IDS = ["doctor", "template", "inbound-text", "status-read", "inbound-image", "handoff"];

const USAGE = `pnpm smoke:meta [--only <ids>] [--timeout <seconds>]

Manual smoke run against a real Meta app (see docs/smoke-meta.md). Interactive; never in CI.

Options:
  --only <ids>         Comma-separated subset of: ${STEP_IDS.join(", ")}
  --timeout <seconds>  How long to wait for each webhook-driven result (default 120)
  --help, -h           Show this help

Required env (shell, .env.local or apps/playground/.env.local):
  SENDO_SMOKE_TO              Tester's WhatsApp number (E.164, e.g. +50255551234)
  SENDO_SMOKE_WEBHOOK_URL     Public tunnel URL of the playground webhook route
                              (https://<tunnel>/api/sendo/webhook)
  SENDO_META_APP_SECRET       Meta app secret (same value the playground uses)
  SENDO_VERIFY_TOKEN          Webhook verify token (same value as in the Meta dashboard)
  SUPABASE_URL                Or NEXT_PUBLIC_SUPABASE_URL; the playground's Supabase
  SUPABASE_SERVICE_ROLE_KEY   Service role key of that Supabase
  SENDO_AGENT_MODEL           Real model id the playground agent uses (no mock model)
  <token_ref>                 The env var named in sendo_accounts.token_ref (e.g. SENDO_TOKEN_MAIN)

Optional env:
  SENDO_SMOKE_ACCOUNT             phone_number_id to test (default: the only active account)
  SENDO_SMOKE_TEMPLATE            Approved template name (default hello_world)
  SENDO_SMOKE_TEMPLATE_LANGUAGE   Template language (default en_US)
  SENDO_SMOKE_TEMPLATE_VARIABLES  Comma-separated body variables (default none)
  SENDO_STORAGE_BUCKET            Media bucket (default sendo-media)
`;

const REQUIRED_ENV = [
  ["SENDO_SMOKE_TO", "the tester's WhatsApp number in E.164 (e.g. +50255551234)"],
  [
    "SENDO_SMOKE_WEBHOOK_URL",
    "the public tunnel URL of the playground webhook (https://<tunnel>/api/sendo/webhook)",
  ],
  ["SENDO_META_APP_SECRET", "the Meta app secret"],
  ["SENDO_VERIFY_TOKEN", "the webhook verify token configured in the Meta dashboard"],
  ["SUPABASE_URL", "the playground's Supabase URL (NEXT_PUBLIC_SUPABASE_URL also works)"],
  ["SUPABASE_SERVICE_ROLE_KEY", "the service role key of that Supabase"],
  [
    "SENDO_AGENT_MODEL",
    "the real model id the playground agent uses (the mock model is not allowed)",
  ],
];

const SECRET_NAME_RE = /(TOKEN|SECRET|KEY|PASSWORD)/i;
const MIN_SECRET_LENGTH = 8;

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

function configErrors() {
  if (value("SUPABASE_URL") === undefined && value("NEXT_PUBLIC_SUPABASE_URL") !== undefined) {
    process.env.SUPABASE_URL = value("NEXT_PUBLIC_SUPABASE_URL");
  }
  const errors = REQUIRED_ENV.filter(([name]) => value(name) === undefined).map(
    ([name, what]) => `  - ${name}: ${what}`,
  );
  const webhookUrl = value("SENDO_SMOKE_WEBHOOK_URL");
  if (webhookUrl !== undefined && !/^https:\/\//.test(webhookUrl)) {
    errors.push("  - SENDO_SMOKE_WEBHOOK_URL must be a public https URL (Meta rejects http)");
  }
  if (value("SENDO_PLAYGROUND_MODE") === "fixtures") {
    errors.push("  - SENDO_PLAYGROUND_MODE=fixtures: remove it so the playground uses Supabase");
  }
  if (value("SENDO_PLAYGROUND_FAKE_META") === "true") {
    errors.push("  - SENDO_PLAYGROUND_FAKE_META=true: remove it so the playground calls Meta");
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
    return code === null
      ? `${error.name}: ${error.message}`
      : `${error.name} (${code}): ${error.message}`;
  }
  return String(error);
}

// ---------- report ----------

const report = {
  tool: "smoke-meta",
  timestamp: new Date().toISOString(),
  finishedAt: null,
  passed: false,
  interrupted: false,
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
  return relative(root, reportPath);
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

const digits = (phone) => phone.replace(/\D/g, "");

// ---------- main ----------

async function main() {
  let args;
  try {
    args = parseArgs({
      options: {
        only: { type: "string" },
        timeout: { type: "string" },
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

  for (const file of [".env.local", ".env", "apps/playground/.env.local", "apps/playground/.env"]) {
    loadEnvFile(join(root, file));
  }
  secrets = envSecrets();

  const errors = configErrors();
  if (errors.length > 0) {
    fail(
      `smoke:meta cannot start; missing or invalid environment:\n${errors.join("\n")}\n\n` +
        "Set them in your shell, .env.local or apps/playground/.env.local. See docs/smoke-meta.md.",
      EXIT_USAGE,
    );
  }
  if (!process.stdin.isTTY) {
    fail("smoke:meta is interactive; run it in a terminal (stdin is not a TTY).", EXIT_USAGE);
  }
  if (!existsSync(join(distDir, "index.js")) || !existsSync(join(distDir, "cli.js"))) {
    fail("packages/sendo/dist is missing. Run `pnpm build` first.", EXIT_USAGE);
  }

  const pkg = await import(pathToFileURL(join(distDir, "index.js")).href);
  const { supabaseAdapter } = await import(
    pathToFileURL(join(distDir, "adapters/supabase/index.js")).href
  );
  redactText = pkg.redactText;
  redactLogValue = pkg.redactLogValue;
  const supabaseJs = createRequire(join(packageDir, "package.json"))("@supabase/supabase-js");

  report.packageVersion = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8"),
  ).version;
  report.graphApiVersion = pkg.GRAPH_API_VERSION;
  report.tester = maskPhone(value("SENDO_SMOKE_TO"));
  report.webhookUrl = value("SENDO_SMOKE_WEBHOOK_URL");
  report.agentModel = value("SENDO_AGENT_MODEL");

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
          `No sendo_accounts row with phone_number_id ${accountKey}. Run \`sendo accounts add\`.`,
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
  };

  const sendo = pkg.createSendo({
    adapter,
    appSecret: value("SENDO_META_APP_SECRET"),
    verifyToken: value("SENDO_VERIFY_TOKEN"),
    resolveToken: (acc) => {
      const token = value(acc.tokenRef);
      if (token === undefined) throw new Error(`Missing access token env ${acc.tokenRef}`);
      return token;
    },
  });

  const to = value("SENDO_SMOKE_TO");
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

  let conversationId = null;
  async function findConversationId() {
    if (conversationId !== null) return conversationId;
    const page = await sendo.inbox.list({
      tenantId: account.tenantId,
      accountId: account.id,
      limit: 100,
    });
    const match = page.items.find((item) => digits(item.contact.phone) === digits(to));
    conversationId = match?.conversation.id ?? null;
    return conversationId;
  }
  async function thread() {
    const id = await findConversationId();
    if (id === null) return [];
    return (await sendo.inbox.thread(id, { limit: 50 })).items;
  }
  const after = (since) => (message) => message.createdAt.getTime() >= since - 5000;
  async function waitInbound(since, predicate) {
    return waitFor(
      async () =>
        (await thread()).filter(after(since)).find((m) => m.direction === "in" && predicate(m)),
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

  let lastOutbound = null;

  const steps = {
    async doctor(step) {
      const run = spawnSync(
        process.execPath,
        [
          join(distDir, "cli.js"),
          "doctor",
          "--json",
          "--account",
          account.phoneNumberId,
          "--url",
          value("SENDO_SMOKE_WEBHOOK_URL"),
        ],
        { cwd: root, env: process.env, encoding: "utf8", timeout: 120_000 },
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
      const name = value("SENDO_SMOKE_TEMPLATE") ?? "hello_world";
      const language = value("SENDO_SMOKE_TEMPLATE_LANGUAGE") ?? "en_US";
      const variables = value("SENDO_SMOKE_TEMPLATE_VARIABLES")
        ?.split(",")
        .map((s) => s.trim());
      step.details.template = { name, language };
      const synced = await sendo.templates.sync({ account: account.id });
      step.details.templatesSynced = synced.length;
      if (!synced.some((t) => t.name === name && t.language === language)) {
        throw new Error(
          `Template ${name}/${language} is not on the WABA after sync (set SENDO_SMOKE_TEMPLATE / _LANGUAGE)`,
        );
      }
      const message = await sendo.send.template(to, name, {
        account: account.id,
        language,
        ...(variables ? { variables } : {}),
      });
      conversationId = message.conversationId;
      lastOutbound = message;
      step.metaIds.push(message.metaMessageId);
      if (message.metaMessageId === null)
        throw new Error("Meta accepted the template without a message id");
      await pause("Check your phone: the template message should have arrived.");
      if (!(await confirm("Did the template arrive?"))) {
        throw new Error("The tester did not receive the template");
      }
    },

    async "inbound-text"(step) {
      const since = Date.now();
      await pause('Send "hola" from your phone to the test number now.');
      const inbound = await waitInbound(since, (m) => m.type === "text");
      if (!inbound)
        throw new Error(
          `No inbound text stored within ${timeoutSeconds}s (check the tunnel and the webhook subscription)`,
        );
      step.metaIds.push(inbound.metaMessageId);
      step.details.inbound = { text: inbound.text, status: inbound.status };
      const reply = await waitAgentReply(since);
      if (!reply) throw new Error(`The agent did not reply within ${timeoutSeconds}s`);
      lastOutbound = reply;
      step.metaIds.push(reply.metaMessageId);
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
      const read = await waitFor(async () => {
        const current = (await thread()).find((m) => m.id === target.id);
        if (current && seen.at(-1) !== current.status) seen.push(current.status);
        return current?.status === "read" ? current : null;
      }, timeoutMs);
      step.details.statusesSeen = seen;
      if (!read)
        throw new Error(
          `Status did not reach "read" within ${timeoutSeconds}s (seen: ${seen.join(" → ") || "none"})`,
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
      await pause('Send "quiero hablar con una persona" from your phone now.');
      const id = await waitFor(findConversationId, timeoutMs);
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
      await pause('Send "hola de nuevo" from your phone now.');
      const reply = await waitAgentReply(back);
      if (!reply)
        throw new Error(`The agent did not reply after the return within ${timeoutSeconds}s`);
      step.metaIds.push(reply.metaMessageId);
      if (step.details.handoff.by === "api")
        throw new Error("Return worked, but the handoff had to be forced");
    },
  };

  say(`Sendo smoke run against Meta (Graph ${report.graphApiVersion})`);
  say(`Account ${account.phoneNumberId} (WABA ${account.wabaId}), tester ${report.tester}`);
  say(`Webhook ${report.webhookUrl}, model ${report.agentModel}`);
  say(`Steps: ${only.join(", ")}`);

  for (const id of STEP_IDS) {
    if (!only.includes(id)) continue;
    const step = {
      id,
      status: "pass",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      metaIds: [],
      details: {},
      error: null,
    };
    report.steps.push(step);
    say(`\n[${report.steps.length}/${only.length}] ${id}`);
    const started = Date.now();
    try {
      await steps[id](step);
      say("   PASS");
    } catch (error) {
      step.status = "fail";
      step.error = errorText(error);
      say(`   FAIL: ${step.error}`);
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
    "\nRecord the coexistence and billing observations from docs/smoke-meta.md as discrepancies.",
  );
  for (;;) {
    const summary = await ask("Discrepancy (empty to finish):");
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

  const path = writeReport();
  const failed = report.steps.filter((s) => s.status === "fail");
  say(
    `\n${failed.length === 0 ? "All steps passed" : `${failed.length} step(s) failed: ${failed.map((s) => s.id).join(", ")}`}`,
  );
  say(`${report.discrepancies.length} discrepancy(ies). Report: ${path}`);
  return failed.length === 0 ? EXIT_OK : EXIT_FAILED;
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
    let path = "";
    try {
      path = ` Partial report: ${writeReport()}`;
    } catch {
      // keep the original error
    }
    fail(`smoke:meta crashed: ${errorText(error)}.${path}`, EXIT_FAILED);
  },
);
