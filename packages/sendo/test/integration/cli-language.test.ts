/**
 * [CC-LANG-CLI] No Spanish in developer-facing CLI output (AC-PL-1, AC-PL-2).
 *
 * Runs the BUILT `sendo` binary (`dist/cli.js`) the way a developer does: `--help`, every usage
 * error, `doctor` against fixtures that fail every check (so every `fix.detail` path prints), and
 * the `accounts list` / `rules sync` error paths. A `node --import` preload
 * (`test/fixtures/cli-language/graph-preload.mjs`) fakes Meta, Sendo Connect, the webhook URL and
 * Supabase's REST API inside the child process; `doctor --config` gets a memory adapter from the
 * built package. Paths that need a writable adapter (`accounts add` / `set-default` /
 * `disconnect`, `rules sync` writes, interactive prompts) run through `runCli` in-process with the
 * memory adapter, because the binary only builds the Supabase adapter from env.
 *
 * Ways it could fail (one test each):
 * a. `sendo --help` (and its `-h`, `help`, no-argument and `--version` forms) drifts back to
 *    Spanish or changes without review (snapshot).
 * b. A usage error (unknown command or option, missing value, value on a flag, missing <id>,
 *    missing --config, `rules sync --dry-run`, non-UUID --tenant, missing required flags) prints a
 *    Spanish message.
 * c. A doctor check label, detail, `fix.detail` or the table chrome (status words, headers,
 *    summary) is Spanish in table or `--json` output; or a fix path is no longer reached by these
 *    fixtures, so Spanish could hide in it (the list of expected fix openings below).
 * d. `accounts list` prints Spanish table headers or cells, or its error paths (no Supabase env,
 *    Supabase answering 500, unknown id) are Spanish.
 * e. `rules sync` error paths (missing file, folder, module that throws, no `rules` export, not an
 *    array, every zod validation message, unknown account) are Spanish.
 * f. `accounts add` / `set-default` / `disconnect` / `export` / `rules sync` results, warnings,
 *    prompts, progress and errors (duplicate, reconnect, invalid or unknown ids, WABA lookup, Meta
 *    errors) are Spanish.
 *
 * Spanish = any of [áéíóúñ¿¡] or a whole-word Spanish stop word (SPANISH_WORDS). Data the output
 * echoes on purpose (fixture names such as "Ana López", Meta's verified name "Clínica Demo",
 * rule keys) is removed first through ALLOWED_DATA.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { memoryAdapter } from "../../src/adapters/memory";
import type { CheckResult } from "../../src/cli/doctor";
import { runCli, type CliDeps } from "../../src/cli/main";
import { GRAPH, useGraphServer } from "../../src/core/test-utils";

const PACKAGE_DIR = resolve(import.meta.dirname, "../..");
const CLI = join(PACKAGE_DIR, "dist/cli.js");
const FIXTURES = join(PACKAGE_DIR, "test/fixtures/cli-language");
const PRELOAD = pathToFileURL(join(FIXTURES, "graph-preload.mjs")).href;
const DOCTOR_CONFIG = join(FIXTURES, "doctor-config.mjs");
const RULES_CONFIG = join(FIXTURES, "rules.mjs");
const NO_EXPORTS = join(FIXTURES, "no-exports.mjs");

const WEBHOOK_URL = "https://app.example.com/api/sendo/webhook";
const SUPABASE_URL = "http://supabase.sendo.test";
const VERIFY_TOKEN = "verify-token-xyz-987654";
const TOKEN = "EAAG-language-guard-token-1234567890";
const TENANT = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

/** Spanish words that never appear in this CLI's English output, matched as whole words. */
const SPANISH_WORDS = [
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "para",
  "por",
  "con",
  "una",
  "que",
  "sin",
  "ya",
  "número",
  "numero",
  "configura",
  "ejecuta",
  "revisa",
  "verifica",
  "agrega",
  "falta",
  "faltan",
  "no se",
  "está",
  "cuenta",
  "aviso",
  "falla",
  "solución",
  "debe",
  "desconocido",
  "desconocida",
];

/** Data the CLI echoes back verbatim (fixture names, Meta's verified name, rule keys). */
const ALLOWED_DATA = [
  "Ana López",
  "Clínica Demo",
  "Recepción",
  "Estamos cerrados.",
  "teletransporte",
  "horario",
  "escalar",
  "asignar",
  "doble",
  "lista",
  "ruta",
  "ventas",
];

const SPANISH_RE = new RegExp(
  `[áéíóúñ¿¡]|(?<![\\p{L}\\p{N}_-])(?:${SPANISH_WORDS.join("|")})(?![\\p{L}\\p{N}_-])`,
  "giu",
);

/** Every Spanish hit in `text` as "<source>: …context…". */
function spanishIn(source: string, text: string): string[] {
  let scrubbed = text;
  for (const data of ALLOWED_DATA) scrubbed = scrubbed.split(data).join("<data>");
  const hits: string[] = [];
  for (const match of scrubbed.matchAll(SPANISH_RE)) {
    const at = match.index;
    hits.push(`${source}: "${match[0]}" in …${scrubbed.slice(Math.max(0, at - 40), at + 40)}…`);
  }
  return hits;
}

interface Run {
  label: string;
  code: number | null;
  stdout: string;
  stderr: string;
}

interface BinRun {
  label: string;
  args: string[];
  scenario?: string;
  env?: Record<string, string | undefined>;
}

let cwd = "";

const BASE_ENV = {
  SENDO_META_APP_SECRET: "app-secret-abcdef123456",
  SENDO_VERIFY_TOKEN: VERIFY_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-0987654321",
  SENDO_TOKEN_MAIN: TOKEN,
};

const CONNECT_ENV = {
  SENDO_META_APP_SECRET: undefined,
  SENDO_CONNECT_API_KEY: "sk_live_language_guard_key_123",
  SENDO_CONNECT_SIGNING_SECRET: "whsec_language_guard_secret_456",
};

/** Spawns the built CLI with the request-faking preload; never touches the network. */
function runBin(run: BinRun): Promise<Run> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    SENDO_LANG_SCENARIO: run.scenario ?? "healthy",
  };
  for (const [key, value] of Object.entries(run.env ?? {})) {
    if (value !== undefined) env[key] = value;
  }
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ["--import", PRELOAD, CLI, ...run.args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.once("error", fail);
    child.once("close", (code) => {
      done({ label: run.label, code, stdout, stderr });
    });
  });
}

async function runAll(runs: BinRun[], concurrency = 8): Promise<Run[]> {
  const results: Run[] = new Array<Run>(runs.length);
  let next = 0;
  const worker = async () => {
    while (next < runs.length) {
      const index = next++;
      results[index] = await runBin(runs[index] as BinRun);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

function spanishInRuns(runs: Run[]): string[] {
  return runs.flatMap((run) => [
    ...spanishIn(`${run.label} (stdout)`, run.stdout),
    ...spanishIn(`${run.label} (stderr)`, run.stderr),
  ]);
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), "sendo-lang-"));
  mkdirSync(join(cwd, "a-folder"));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("[CC-LANG-CLI] built sendo binary", () => {
  it("[CC-LANG-CLI] a. --help, -h, help, no arguments and --version are English", async () => {
    const runs = await runAll([
      { label: "--help", args: ["--help"] },
      { label: "-h", args: ["-h"] },
      { label: "help", args: ["help"] },
      { label: "(no args)", args: [] },
      { label: "--version", args: ["--version"] },
    ]);
    for (const run of runs) expect(run.code, run.label).toBe(0);
    const [help] = runs;
    expect(help?.stdout).toContain("Usage:");
    expect(runs.slice(1, 4).map((run) => run.stdout)).toEqual([
      help?.stdout,
      help?.stdout,
      help?.stdout,
    ]);
    expect(help?.stdout).toMatchSnapshot();
    expect(spanishInRuns(runs)).toEqual([]);
  }, 30_000);

  it("[CC-LANG-CLI] b. usage errors (including rules sync --dry-run) are English", async () => {
    const runs = await runAll([
      { label: "unknown command", args: ["deploy"] },
      { label: "accounts without subcommand", args: ["accounts"] },
      { label: "unknown option", args: ["doctor", "--nope"] },
      { label: "missing value", args: ["doctor", "--url"] },
      { label: "value on a boolean flag", args: ["doctor", "--json=yes"] },
      { label: "set-default without id", args: ["accounts", "set-default"] },
      { label: "disconnect without id", args: ["accounts", "disconnect"] },
      { label: "export without id", args: ["accounts", "export"] },
      { label: "export --out without value", args: ["accounts", "export", "123", "--out"] },
      { label: "accounts add --yes without flags", args: ["accounts", "add", "--yes"] },
      { label: "rules sync without --config", args: ["rules", "sync"] },
      { label: "rules sync --dry-run", args: ["rules", "sync", "--dry-run"] },
      {
        label: "rules sync --tenant not a uuid",
        args: ["rules", "sync", "--config", RULES_CONFIG, "--tenant", "tenant-a"],
        env: BASE_ENV,
      },
    ]);
    for (const run of runs) {
      expect(run.code, run.label).not.toBe(0);
      expect(run.stderr.length, run.label).toBeGreaterThan(0);
    }
    expect(runs.find((r) => r.label === "rules sync --dry-run")?.stderr).toContain(
      "Unknown option: --dry-run",
    );
    expect(spanishInRuns(runs)).toEqual([]);
  }, 30_000);

  it("[CC-LANG-CLI] c. doctor: every check label, detail and fix.detail is English", async () => {
    const doctorRuns: BinRun[] = [];
    const doctor = (
      scenario: string,
      env: Record<string, string | undefined> = {},
      args: string[] = [],
    ) => {
      for (const json of [false, true]) {
        doctorRuns.push({
          label: `doctor ${scenario}${json ? " --json" : ""}`,
          scenario,
          env: { ...BASE_ENV, ...env },
          args: [
            "doctor",
            "--config",
            DOCTOR_CONFIG,
            "--url",
            WEBHOOK_URL,
            ...args,
            ...(json ? ["--json"] : []),
          ],
        });
      }
    };
    doctor("healthy");
    doctor("healthy", {}, ["--account", "999"]);
    doctor("drift");
    doctor("token", { SENDO_META_APP_ID: "777" });
    doctor("permissions", { SENDO_VERIFY_TOKEN: "other-verify-token" });
    doctor("empty-token", { SENDO_TOKEN_EMPTY: "" });
    doctor("broken");
    doctor("newer-schema");
    doctor("meta-other");
    doctor("no-media");
    doctor("custom-media-missing");
    doctor("custom-media-no-exists");
    doctor("connect-ok", CONNECT_ENV);
    doctor("connect-401", CONNECT_ENV);
    doctor("connect-network", CONNECT_ENV);
    doctor("connect-suspended", CONNECT_ENV);
    doctor("connect-500", CONNECT_ENV);
    doctor("connect-bad-url", { ...CONNECT_ENV, SENDO_CONNECT_BASE_URL: "http://connect.example" });
    doctor("connect-no-url", CONNECT_ENV);
    doctor("connect-other-url", CONNECT_ENV);
    doctor("connect-delivery-500", CONNECT_ENV);
    doctor("connect-no-answer", CONNECT_ENV);
    for (const json of [false, true]) {
      doctorRuns.push({
        label: `doctor without an adapter${json ? " --json" : ""}`,
        env: { SENDO_TOKEN_MAIN: TOKEN },
        args: ["doctor", "--url", WEBHOOK_URL, ...(json ? ["--json"] : [])],
      });
    }
    doctorRuns.push(
      {
        label: "doctor --config without an adapter export",
        env: BASE_ENV,
        args: ["doctor", "--config", NO_EXPORTS],
      },
      {
        label: "doctor --config with an invalid media export",
        scenario: "bad-media",
        env: BASE_ENV,
        args: ["doctor", "--config", DOCTOR_CONFIG],
      },
    );

    const runs = await runAll(doctorRuns);
    const results: CheckResult[] = [];
    for (const run of runs) {
      expect(run.code, `${run.label}: ${run.stderr}`).not.toBeNull();
      if (run.label.endsWith("--json")) {
        results.push(...(JSON.parse(run.stdout) as CheckResult[]));
      }
    }
    expect(runs.find((r) => r.label === "doctor healthy")?.stdout).toMatch(
      /^Status\s+Check\s+Detail/,
    );

    const fixes = new Set(results.flatMap((r) => (r.fix === undefined ? [] : [r.fix.detail])));
    const unreached = EXPECTED_FIX_OPENINGS.filter(
      (opening) => ![...fixes].some((detail) => detail.startsWith(opening)),
    );
    expect(unreached, "fix paths these fixtures no longer reach").toEqual([]);
    expect(spanishInRuns(runs)).toEqual([]);
  }, 60_000);

  it("[CC-LANG-CLI] d. accounts list: table headers, cells and error paths are English", async () => {
    const supabase = { ...BASE_ENV, SUPABASE_URL };
    const runs = await runAll([
      { label: "list", scenario: "supabase-accounts", env: supabase, args: ["accounts", "list"] },
      {
        label: "list --tenant-id",
        scenario: "supabase-accounts",
        env: supabase,
        args: ["accounts", "list", "--tenant-id", TENANT],
      },
      {
        label: "list (empty)",
        scenario: "supabase-empty",
        env: supabase,
        args: ["accounts", "list"],
      },
      {
        label: "list (Supabase 500)",
        scenario: "supabase-down",
        env: supabase,
        args: ["accounts", "list"],
      },
      { label: "list (no Supabase env)", env: {}, args: ["accounts", "list"] },
      {
        label: "disconnect (unknown id)",
        scenario: "supabase-empty",
        env: supabase,
        args: ["accounts", "disconnect", "100000000000099"],
      },
      {
        label: "set-default (unknown id)",
        scenario: "supabase-empty",
        env: supabase,
        args: ["accounts", "set-default", "100000000000099"],
      },
    ]);
    const [list] = runs;
    expect(list?.code).toBe(0);
    expect(list?.stdout).toMatch(/ID\s+Number\s+Label\s+Tenant\s+Status\s+Default\s+Onboarded/);
    expect(list?.stdout).toMatch(/connected\s+yes\s+manual/);
    expect(list?.stdout).toMatch(/disconnected\s+embedded signup/);
    for (const run of runs.slice(3)) expect(run.code, run.label).toBe(1);
    expect(spanishInRuns(runs)).toEqual([]);
  }, 30_000);

  it("[CC-LANG-CLI] e. rules sync: config and validation errors are English", async () => {
    const env = { ...BASE_ENV, SUPABASE_URL };
    const sync = (label: string, config: string, rules?: string): BinRun => ({
      label,
      scenario: "supabase-empty",
      env: { ...env, SENDO_LANG_RULES: rules },
      args: ["rules", "sync", "--config", config],
    });
    const runs = await runAll([
      sync("missing file", join(cwd, "missing-rules.ts")),
      sync("folder", join(cwd, "a-folder")),
      sync("module throws", RULES_CONFIG, "throws"),
      sync("no rules export", NO_EXPORTS),
      sync("not an array", RULES_CONFIG, "not-array"),
      sync("invalid rules", RULES_CONFIG, "invalid"),
      sync("unknown account", RULES_CONFIG, "unknown-account"),
    ]);
    for (const run of runs) expect(run.code, `${run.label}: ${run.stdout}`).toBe(1);
    const invalid = runs.find((r) => r.label === "invalid rules")?.stderr ?? "";
    expect(invalid).toContain("Invalid rules; none were saved");
    expect(invalid.split("\n").length).toBeGreaterThan(8);
    expect(spanishInRuns(runs)).toEqual([]);
  }, 30_000);
});

/**
 * The opening words of every `fix.detail` doctor can produce (doctor.ts). Each must show up in the
 * fixtures above, so a Spanish fix can't hide in a path the guard never runs.
 */
const EXPECTED_FIX_OPENINGS = [
  "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)",
  "Add the migration with npx shadcn add @sendo/schema",
  "Copy the migrations with npx shadcn add @sendo/schema",
  "Upgrade @quami/sendo",
  "Check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
  "Check the Supabase connection",
  "Check the Supabase Storage connection",
  "Could not read sendo_accounts",
  "Add SENDO_META_APP_SECRET",
  "Pass `media` to createSendo",
  "Create the private bucket you passed",
  "Create a private bucket named sendo-media",
  "Register the number with npx @quami/sendo accounts add",
  "Set SENDO_TOKEN_EMPTY to the permanent",
  "The token expired or was revoked",
  "Could not connect to graph.facebook.com",
  "Meta could not find the resource",
  "The token is missing permissions",
  "The number's quality rating is RED",
  "Check that SENDO_TOKEN_MAIN is valid",
  "Set sendo_accounts.waba_id",
  "Subscribe your app: POST",
  "Subscribe app 777",
  "Check that waba_id",
  "Check that the token has the whatsapp_business_management permission",
  "Add a payment method to the WABA",
  "Set SENDO_VERIFY_TOKEN to the same value",
  "SENDO_VERIFY_TOKEN does not match",
  "Check that the webhook route exists",
  "The GET route must answer",
  "Could not connect to the URL",
  "Set SENDO_CONNECT_API_KEY and SENDO_CONNECT_SIGNING_SECRET",
  "Sendo Connect rejected SENDO_CONNECT_API_KEY",
  "Update the payment method on the Billing page at https://app.sendo.dev",
  "Could not connect to https://connect.sendo.dev",
  "Sendo Connect (https://connect.sendo.dev) answered with an error",
  `Register ${WEBHOOK_URL} as the webhook URL`,
  "Change the webhook URL in the Sendo Connect panel",
  "Send a WhatsApp message to one of your numbers",
  "SENDO_CONNECT_SIGNING_SECRET does not match",
  "Check that the webhook route is deployed",
];

describe("[CC-LANG-CLI] in-process runCli (writable memory adapter)", () => {
  const { server } = useGraphServer();
  const PHONE_A = "100000000000011";
  const PHONE_B = "100000000000012";
  const WABA = "200000000000011";

  function phoneOk() {
    return http.get(`${GRAPH}/:id`, ({ params }) =>
      HttpResponse.json({
        id: params.id,
        display_phone_number: "+502 5555 0303",
        verified_name: "Clínica Demo",
        quality_rating: "GREEN",
      }),
    );
  }

  function metaError(code: number, status: number) {
    return http.get(`${GRAPH}/:id`, () =>
      HttpResponse.json(
        { error: { code, message: "Meta said no", type: "OAuthException", fbtrace_id: "T" } },
        { status },
      ),
    );
  }

  function debugToken(wabaIds: string[]) {
    return http.get(`${GRAPH}/debug_token`, () =>
      HttpResponse.json({
        data: { granular_scopes: [{ scope: "whatsapp_business_management", target_ids: wabaIds }] },
      }),
    );
  }

  it("[CC-LANG-CLI] f. accounts add, set-default, disconnect, prompts and rules sync are English", async () => {
    const adapter = memoryAdapter();
    await adapter.accounts.insert({
      tenantId: null,
      label: "Ana López",
      phoneNumberId: "100000000000010",
      wabaId: WABA,
      displayPhone: "+502 5555 0100",
      tokenRef: "SENDO_TOKEN_GONE",
      onboardedVia: "embedded_signup",
      isDefault: true,
    });
    const runs: Run[] = [];
    const questions: string[] = [];
    let answers: string[] = [];
    const deps = (env: Record<string, string | undefined> = {}): CliDeps => ({
      env: { ...BASE_ENV, SENDO_TOKEN_B: TOKEN, ...env },
      cwd,
      stdout: (text) => {
        (runs.at(-1) as Run).stdout += text;
      },
      stderr: (text) => {
        (runs.at(-1) as Run).stderr += text;
      },
      readFile: () => null,
      createAdapter: () => Promise.resolve(adapter),
      createPrompt: () => ({
        prompt: (question) => {
          questions.push(question);
          return Promise.resolve(answers.shift() ?? "");
        },
        close: () => undefined,
      }),
      version: "9.9.9",
    });
    const cli = async (label: string, args: string[], env?: Record<string, string | undefined>) => {
      runs.push({ label, code: null, stdout: "", stderr: "" });
      const run = runs.at(-1) as Run;
      run.code = await runCli(args, deps(env));
      return run;
    };
    const add = (phone: string, extra: string[] = []) => [
      "accounts",
      "add",
      "--phone-number-id",
      phone,
      "--waba-id",
      WABA,
      "--token-env",
      "SENDO_TOKEN_MAIN",
      "--yes",
      ...extra,
    ];

    server.use(phoneOk());
    expect((await cli("add", add(PHONE_A))).code).toBe(0);
    expect((await cli("add again (connected)", add(PHONE_A))).code).toBe(1);
    expect((await cli("list", ["accounts", "list"])).stdout).toContain("Ana López");
    expect((await cli("set-default", ["accounts", "set-default", PHONE_A])).code).toBe(0);
    expect((await cli("set-default unchanged", ["accounts", "set-default", PHONE_A])).code).toBe(0);
    expect((await cli("disconnect", ["accounts", "disconnect", PHONE_A])).code).toBe(0);
    expect((await cli("disconnect again", ["accounts", "disconnect", PHONE_A])).code).toBe(0);
    expect((await cli("set-default disconnected", ["accounts", "set-default", PHONE_A])).code).toBe(
      1,
    );
    expect(
      (await cli("disconnect embedded", ["accounts", "disconnect", "100000000000010"])).code,
    ).toBe(0);
    expect((await cli("add in another tenant", add(PHONE_A, ["--tenant-id", TENANT]))).code).toBe(
      1,
    );
    expect((await cli("reconnect", add(PHONE_A))).code).toBe(0);
    expect(
      (await cli("export", ["accounts", "export", PHONE_A, "--out", join(cwd, "export.json")]))
        .code,
    ).toBe(0);
    expect((await cli("export unknown id", ["accounts", "export", "999"])).code).toBe(1);
    expect((await cli("add second", add(PHONE_B, ["--tenant-id", TENANT]))).code).toBe(0);
    await cli("disconnect last in tenant", ["accounts", "disconnect", PHONE_B]);

    expect((await cli("bad phone id", add("abc"))).code).toBe(1);
    expect(
      (
        await cli("bad env name", [
          "accounts",
          "add",
          "--phone-number-id",
          "123",
          "--token-env",
          "1BAD",
          "--yes",
        ])
      ).code,
    ).toBe(1);
    expect((await cli("empty token", add("123"), { SENDO_TOKEN_MAIN: "" })).code).toBe(1);
    expect((await cli("bad tenant", add("123", ["--tenant-id", "tenant-a"]))).code).toBe(1);
    const noWaba = [
      "accounts",
      "add",
      "--phone-number-id",
      "124",
      "--token-env",
      "SENDO_TOKEN_MAIN",
      "--yes",
    ];
    server.use(debugToken([]));
    expect((await cli("no WABA found", noWaba)).code).toBe(1);
    server.use(debugToken(["300000000000001", "300000000000002"]));
    expect((await cli("several WABAs", noWaba)).code).toBe(1);
    server.use(metaError(190, 401));
    expect((await cli("Meta 190", add("125"))).code).toBe(1);
    server.use(metaError(2, 500));
    expect((await cli("Meta other error", add("126"))).code).toBe(1);

    // Interactive: every prompt (phone id, token env, display number, WABA, tenant) is shown.
    server.use(metaError(2, 500), debugToken(["300000000000001", "300000000000002"]));
    answers = ["127", "SENDO_TOKEN_MAIN", "+502 5555 0127", "300000000000001", ""];
    expect((await cli("interactive add", ["accounts", "add"])).code).toBe(0);
    expect(questions).toHaveLength(5);
    runs.push({ label: "prompts", code: 0, stdout: questions.join("\n"), stderr: "" });

    const rulesFile = join(cwd, "sendo-rules.mjs");
    const writeRules = (afterDays: number, extra = "") => {
      writeFileSync(
        rulesFile,
        `export const rules = [{ key: "auto-cierre", type: "auto_close", params: { afterDays: ${String(afterDays)} } }${extra}];`,
      );
    };
    writeRules(
      7,
      `, { key: "otro", tenant: "${TENANT}", type: "auto_close", params: { afterDays: 2 } }`,
    );
    const sync = ["rules", "sync", "--config", rulesFile];
    expect(
      (await cli("rules sync", [...sync, "--tenant", "0aa5680f-9eb0-4303-9665-28a53a1fd90f"])).code,
    ).toBe(0);
    writeRules(7);
    expect(
      (
        await cli("rules sync (kept)", [
          ...sync,
          "--tenant",
          "0aa5680f-9eb0-4303-9665-28a53a1fd90f",
        ])
      ).code,
    ).toBe(0);
    writeRules(14);
    expect(
      (
        await cli("rules sync --force", [
          ...sync,
          "--tenant",
          "0aa5680f-9eb0-4303-9665-28a53a1fd90f",
          "--force",
        ])
      ).code,
    ).toBe(0);
    writeFileSync(rulesFile, "export const rules = [];");
    expect((await cli("rules sync (nothing)", sync)).code).toBe(0);

    expect(runs.find((r) => r.label === "rules sync --force")?.stdout).toContain("overwritten");
    expect(runs.find((r) => r.label === "rules sync")?.stdout).toContain("skipped (other tenant)");
    expect(spanishInRuns(runs)).toEqual([]);
  });
});
