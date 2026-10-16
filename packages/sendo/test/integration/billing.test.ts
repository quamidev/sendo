/**
 * Product spec — Batch 2 — "Embedded Signup and billing state".
 *
 * [AC-ES-4] `billingReady` is true / false / null. `sendo.accounts.refreshBilling` reads the WABA
 *           funding field: present → true, absent → false, Meta error → unchanged; it always
 *           sets `billingCheckedAt` and emits `account.billing` on change.
 * [AC-ES-5] Sends on `billingReady = false` still call Meta; Meta error 131042 sets
 *           `billingReady = false`, emits `account.billing` and rethrows `MetaApiError` with
 *           `hint: "billing_not_ready"`.
 * [AC-ES-6] `sendo doctor` warns `account:<id>:billing` (fix kind `billing`, Meta Business
 *           Settings link) when the value is false or null; warnings do not fail the run.
 */
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../../src/adapters/memory";
import type { CheckResult } from "../../src/cli/doctor";
import { EXIT_FAILURE, EXIT_OK, runCli, type CliDeps } from "../../src/cli/main";
import {
  PHONE_NUMBER_ID,
  WABA_ID,
  cliAccountInput,
  doctorEnv,
  healthyGraph,
} from "../../src/cli/test-helpers";
import type { AccountBillingEvent } from "../../src/core/accounts";
import {
  GRAPH,
  TOKENS,
  acceptSends,
  accountInput,
  makeClient,
  metaError,
  openConversation,
  useGraphServer,
} from "../../src/core/test-utils";
import type { Account } from "../../src/types/entities";

const graph = useGraphServer();
const PHONE = "+50255550001";

function client() {
  const c = makeClient();
  const billing: AccountBillingEvent[] = [];
  c.sendo.on("account.billing", (e) => {
    billing.push(e);
  });
  return { ...c, billing };
}

function funding(body: Record<string, unknown> | (() => Response)) {
  return http.get(`${GRAPH}/:waba`, ({ request, params }) => {
    if (new URL(request.url).searchParams.get("fields") !== "primary_funding_id") {
      return HttpResponse.json({ error: { code: 100, message: "unexpected" } }, { status: 400 });
    }
    return typeof body === "function" ? body() : HttpResponse.json({ id: params.waba, ...body });
  });
}

async function rejection(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  const error = await promise.then(
    () => expect.fail("expected a rejection"),
    (e: unknown) => e,
  );
  return (error as { toJSON(): Record<string, unknown> }).toJSON();
}

describe("billing state", () => {
  it("[AC-ES-5] 131042 on a send marks the number not ready, emits once and rethrows the hint", async () => {
    graph.server.use(metaError(131042, 400, "Business eligibility payment issue"));
    const c = client();
    const account = await c.adapter.accounts.insert(accountInput({ billingReady: true }));
    await openConversation(c.ctx, account, PHONE);

    const error = await rejection(c.sendo.send.text(PHONE, "hola"));
    expect(error).toMatchObject({
      code: "META_API_ERROR",
      metaCode: 131042,
      hint: "billing_not_ready",
    });
    const after = await c.sendo.accounts.get(account.id);
    expect(after.billingReady).toBe(false);
    expect(after.billingCheckedAt).toBeInstanceOf(Date);
    expect(c.billing).toEqual([
      {
        account: expect.objectContaining({ id: account.id }) as Account,
        billingReady: false,
        previous: true,
      },
    ]);

    // Still not ready: the next send is attempted on Meta, fails the same way, no new event.
    graph.requests.length = 0;
    await rejection(c.sendo.send.text(PHONE, "otra vez"));
    expect(graph.requests.map((r) => r.method)).toEqual(["POST"]);
    expect(c.billing).toHaveLength(1);
    expect(JSON.stringify([error, c.billing, c.logs.entries])).not.toContain(TOKENS.SENDO_TOKEN_A);
  });

  it("[AC-ES-5] a number marked not ready still sends when Meta accepts", async () => {
    graph.server.use(acceptSends());
    const c = client();
    const account = await c.adapter.accounts.insert(accountInput({ billingReady: false }));
    await openConversation(c.ctx, account, PHONE);
    await expect(c.sendo.send.text(PHONE, "hola")).resolves.toMatchObject({ status: "sent" });
  });

  it("[AC-ES-4] refreshBilling: funding present → true, absent → false, Meta error → unchanged", async () => {
    const c = client();
    const account = await c.adapter.accounts.insert(accountInput());

    graph.server.use(funding({ primary_funding_id: "556677" }));
    const ready = await c.sendo.accounts.refreshBilling(account.id);
    expect(ready.billingReady).toBe(true);
    const firstCheck = ready.billingCheckedAt?.getTime() ?? 0;
    expect(firstCheck).toBeGreaterThan(0);
    expect(new URL(graph.requests[0]?.url ?? "").pathname).toBe(
      `${new URL(GRAPH).pathname}/${account.wabaId ?? ""}`,
    );

    graph.server.use(funding({}));
    const missing = await c.sendo.accounts.refreshBilling("PN_A");
    expect(missing.billingReady).toBe(false);

    graph.server.use(
      funding(() =>
        HttpResponse.json({ error: { code: 2, message: "Service down" } }, { status: 503 }),
      ),
    );
    await new Promise((r) => setTimeout(r, 2));
    const unknown = await c.sendo.accounts.refreshBilling(account.id);
    expect(unknown.billingReady).toBe(false);
    expect(unknown.billingCheckedAt?.getTime()).toBeGreaterThan(firstCheck);

    expect(c.billing.map((e) => [e.previous, e.billingReady])).toEqual([
      [null, true],
      [true, false],
    ]);
    expect(c.logs.of("warn").join("\n")).toContain("billingReady unchanged");
    expect(JSON.stringify(c.logs.entries)).not.toContain(TOKENS.SENDO_TOKEN_A);
  });

  it("[AC-ES-4] refreshBilling refuses a disconnected number", async () => {
    const c = client();
    const account = await c.adapter.accounts.insert(accountInput({ active: false }));
    expect(await rejection(c.sendo.accounts.refreshBilling(account.id))).toMatchObject({
      code: "ACCOUNT_STATE",
      state: "inactive",
    });
    expect(graph.requests).toHaveLength(0);
  });
});

describe("doctor billing check", () => {
  async function doctor(billingReady: boolean | null) {
    const adapter = memoryAdapter();
    const account = await adapter.accounts.insert(cliAccountInput({ billingReady }));
    graph.server.use(...healthyGraph());
    const out: string[] = [];
    const deps: CliDeps = {
      env: doctorEnv(),
      cwd: "/app",
      stdout: (text) => out.push(text),
      stderr: () => undefined,
      readFile: () => null,
      createAdapter: () => Promise.resolve(adapter),
    };
    const exit = await runCli(["doctor"], deps);
    const table = out.join("");
    const jsonOut: string[] = [];
    await runCli(["doctor", "--json"], { ...deps, stdout: (text) => jsonOut.push(text) });
    const results = JSON.parse(jsonOut.join("")) as CheckResult[];
    const check = results.find((r) => r.id === `account:${PHONE_NUMBER_ID}:billing`);
    return { account, exit, table, check };
  }

  it("[AC-ES-6] false and unknown warn with a billing fix; the run still passes", async () => {
    for (const value of [false, null]) {
      const { account, exit, table, check } = await doctor(value);
      expect(exit).toBe(EXIT_OK);
      expect(check).toMatchObject({
        ok: false,
        warning: true,
        fix: {
          kind: "billing",
          docsUrl: "https://sendo.dev/docs/embedded-signup",
        },
      });
      expect(check?.fix?.detail).toContain(
        `https://business.facebook.com/settings/whatsapp-business-accounts/${WABA_ID}`,
      );
      expect(check?.fix?.detail).toContain(`refreshBilling("${account.id}")`);
      expect(table).toContain("WARN");
      expect(table).toContain("1 with a warning");
      expect(table).not.toContain("FAIL");
    }
  });

  it("[AC-ES-6] a ready number passes; a real failure still exits 1", async () => {
    const { exit, check } = await doctor(true);
    expect(exit).toBe(EXIT_OK);
    expect(check).toMatchObject({ ok: true });
    expect(check).not.toHaveProperty("warning");

    const adapter = memoryAdapter({ bucketExists: false });
    await adapter.accounts.insert(cliAccountInput({ billingReady: null }));
    graph.server.use(...healthyGraph());
    const deps: CliDeps = {
      env: doctorEnv(),
      cwd: "/app",
      stdout: () => undefined,
      stderr: () => undefined,
      readFile: () => null,
      createAdapter: () => Promise.resolve(adapter),
    };
    expect(await runCli(["doctor"], deps)).toBe(EXIT_FAILURE);
  });
});
