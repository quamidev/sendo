import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../adapters/memory";
import type { SendoAdapter } from "../adapters/types";
import { GRAPH, useGraphServer } from "../core/test-utils";
import { ConfigError } from "../errors/errors";
import type { CheckResult } from "./doctor";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, runCli, type CliDeps } from "./main";
import {
  APP_SECRET,
  PHONE_NUMBER_ID,
  SENTINEL_TOKEN,
  SERVICE_ROLE_KEY,
  VERIFY_TOKEN,
  WABA_ID,
  WEBHOOK_URL,
  doctorEnv,
  graphHandlers,
  healthyGraph,
  seededAdapter,
} from "./test-helpers";

const { server } = useGraphServer();

interface Harness {
  deps: CliDeps;
  stdout: () => string;
  stderr: () => string;
}

function harness(overrides: Partial<CliDeps> = {}, adapter?: SendoAdapter): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    env: doctorEnv(),
    cwd: "/app",
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    readFile: () => null,
    createAdapter: () => Promise.resolve(adapter ?? memoryAdapter()),
    version: "9.9.9",
    ...overrides,
  };
  return { deps, stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("runCli: usage errors", () => {
  it("rejects unknown commands and options with exit 2", async () => {
    for (const argv of [["deploy"], ["accounts"], ["accounts", "remove"], ["doctor", "--nope"]]) {
      const h = harness();
      expect(await runCli(argv, h.deps)).toBe(EXIT_USAGE);
      expect(h.stderr()).toContain("Uso:");
    }
  });
});

describe("runCli doctor", () => {
  it("prints a passing table and exits 0", async () => {
    server.use(...healthyGraph());
    const h = harness({}, await seededAdapter());
    expect(await runCli(["doctor", "--url", WEBHOOK_URL], h.deps)).toBe(EXIT_OK);
    expect(h.stdout()).toContain("Estado");
    expect(h.stdout()).toContain("OK");
    expect(h.stdout()).toContain("Todo en orden");
    expect(h.stdout()).not.toContain("FALLA");
  });

  it("exits 1 and prints fix hints on failure", async () => {
    server.use(
      graphHandlers.phoneError(190),
      graphHandlers.subscribed(),
      graphHandlers.templatesOk(),
    );
    const h = harness({}, await seededAdapter({ bucketExists: false }));
    expect(await runCli(["doctor"], h.deps)).toBe(EXIT_FAILURE);
    expect(h.stdout()).toContain("FALLA");
    expect(h.stdout()).toContain("Solución:");
    expect(h.stdout()).toContain("expiró o fue revocado");
  });

  it("still runs the checks when the adapter cannot be built", async () => {
    const h = harness({
      createAdapter: () => Promise.reject(new ConfigError("Faltan variables de Supabase")),
    });
    expect(await runCli(["doctor"], h.deps)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain("Faltan variables de Supabase");
    expect(h.stdout()).toContain("Tablas de la base de datos");
  });

  it("loads .env files without overriding the process env", async () => {
    server.use(...healthyGraph());
    const env = doctorEnv({
      SENDO_META_APP_SECRET: undefined,
      SENDO_VERIFY_TOKEN: "from-process-env",
    });
    const h = harness(
      {
        env,
        readFile: (path) =>
          path === "/app/.env.local"
            ? `SENDO_META_APP_SECRET="${APP_SECRET}"\nSENDO_VERIFY_TOKEN=nope`
            : null,
      },
      await seededAdapter(),
    );
    await runCli(["doctor", "--json"], h.deps);
    expect(env.SENDO_META_APP_SECRET).toBe(APP_SECRET);
    expect(env.SENDO_VERIFY_TOKEN).toBe("from-process-env");
    const results = JSON.parse(h.stdout()) as CheckResult[];
    expect(results.find((r) => r.id === "env")).toMatchObject({ ok: true });
  });

  it("never prints a secret, in table or JSON mode", async () => {
    const leaky = `leak ${SENTINEL_TOKEN} ${APP_SECRET} ${VERIFY_TOKEN} ${SERVICE_ROLE_KEY}`;
    for (const json of [false, true]) {
      server.use(
        http.get(`${GRAPH}/:id`, () =>
          HttpResponse.json({ error: { code: 100, message: leaky } }, { status: 400 }),
        ),
        http.get(`${GRAPH}/:waba/subscribed_apps`, () =>
          HttpResponse.json({ data: [{ id: "1", name: leaky }] }),
        ),
        graphHandlers.templatesOk(),
        http.get(WEBHOOK_URL, () => HttpResponse.error()),
      );
      const h = harness({ createAdapter: () => Promise.reject(new Error(leaky)) }, undefined);
      await runCli(["doctor", "--url", WEBHOOK_URL, ...(json ? ["--json"] : [])], h.deps);
      const h2 = harness({}, await seededAdapter());
      await runCli(["doctor", "--url", WEBHOOK_URL, ...(json ? ["--json"] : [])], h2.deps);
      const printed = h.stdout() + h.stderr() + h2.stdout() + h2.stderr();
      expect(h2.stdout()).toContain("[REDACTED]");
      for (const secret of [SENTINEL_TOKEN, APP_SECRET, VERIFY_TOKEN, SERVICE_ROLE_KEY]) {
        expect(printed).not.toContain(secret);
      }
    }
  });
});

describe("runCli accounts add", () => {
  it("inserts non-interactively and never prints or stores the token", async () => {
    server.use(graphHandlers.phoneOk());
    const adapter = memoryAdapter();
    const h = harness({}, adapter);
    const code = await runCli(
      [
        "accounts",
        "add",
        "--phone-number-id",
        PHONE_NUMBER_ID,
        "--waba-id",
        WABA_ID,
        "--token-env",
        "SENDO_TOKEN_MAIN",
        "--timezone",
        "America/Guatemala",
        "--yes",
      ],
      h.deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(h.stdout()).toContain("Cuenta registrada");
    expect(h.stdout()).toContain("SENDO_TOKEN_MAIN");
    expect(h.stdout()).not.toContain(SENTINEL_TOKEN);
    const [account] = await adapter.accounts.list();
    expect(account).toMatchObject({
      tokenRef: "SENDO_TOKEN_MAIN",
      displayPhone: "+1 555-000-1111",
    });
    expect(JSON.stringify(adapter.__state)).not.toContain(SENTINEL_TOKEN);
  });

  it("refuses an empty token env with exit 1", async () => {
    const adapter = memoryAdapter();
    const h = harness({ env: doctorEnv({ SENDO_TOKEN_MAIN: "" }) }, adapter);
    const code = await runCli(
      [
        "accounts",
        "add",
        "--phone-number-id",
        PHONE_NUMBER_ID,
        "--waba-id",
        WABA_ID,
        "--token-env",
        "SENDO_TOKEN_MAIN",
      ],
      h.deps,
    );
    expect(code).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain("SENDO_TOKEN_MAIN");
    expect(await adapter.accounts.list()).toEqual([]);
  });

  it("does not prompt with --yes and fails on missing flags", async () => {
    let prompted = false;
    const h = harness({
      createPrompt: () => {
        prompted = true;
        return { prompt: () => Promise.resolve(""), close: () => undefined };
      },
    });
    expect(await runCli(["accounts", "add", "--yes"], h.deps)).toBe(EXIT_USAGE);
    expect(prompted).toBe(false);
    expect(h.stderr()).toContain("--phone-number-id");
  });
});
