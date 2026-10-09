/**
 * Product spec — Batch 2 — "Resolution by tenant and default number" and "`sendo.accounts` API".
 *
 * [AC-AC-1] `send.*` and `templates.sync/list` accept `{ tenant }` alongside `{ account }`.
 * [AC-AC-2] Resolution order: account (tenant must match) → tenant default → tenant's only
 *           number → ambiguous (that tenant's candidates only) / not found; neither → the only
 *           active number, else ambiguous with a message suggesting `{ tenant }`.
 * [AC-AC-3] One default per tenant; `setDefault` swaps it atomically.
 * [AC-AC-4] Two tenants with one number each: `send.text(..., { tenant })` goes out from each
 *           tenant's number; without `tenant`/`account` → AMBIGUOUS_ACCOUNT.
 * [AC-AC-5] `sendo.accounts`: list, get, add, setDefault, setLabel, pauseAgent, setAgentMode,
 *           disconnect, purge (refreshBilling and completeEmbeddedSignup are covered in
 *           billing.test.ts and embedded-signup.test.ts).
 * [AC-AC-6] `disconnect`: inactive, default cleared, the only remaining number promoted,
 *           `deleteToken`, best-effort app unsubscribe for Embedded Signup numbers, data kept,
 *           `account.disconnected` + `account.default`. Reconnecting reuses the row.
 * [AC-AC-7] `purge` refuses an active number; on a disconnected one it deletes the account,
 *           contacts, conversations, messages, media rows and storage objects.
 * [AC-AC-8] CLI `sendo accounts list | set-default | disconnect`.
 */
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { AccountInsertInput } from "../../src/adapters/types";
import { runCli, EXIT_FAILURE, EXIT_OK, type CliDeps } from "../../src/cli/main";
import type { AccountDefaultEvent, AccountDisconnectedEvent } from "../../src/core/accounts";
import {
  GRAPH,
  TOKENS,
  acceptSends,
  accountInput,
  makeClient,
  openConversation,
  useGraphServer,
  type ClientOptions,
} from "../../src/core/test-utils";
import type { Account } from "../../src/types/entities";
import { FIXTURE_IDS } from "../support/fixtures";
import { createHarness, freshFixture, mediaHandlers } from "./harness";

const graph = useGraphServer();
const PHONE = "+50255550001";

const sendUrl = (phoneNumberId: string | null) => `${GRAPH}/${phoneNumberId ?? ""}/messages`;
const sentFrom = () => graph.requests.filter((r) => r.method === "POST").map((r) => r.url);

async function rejection(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  const error = await promise.then(
    () => expect.fail("expected a rejection"),
    (e: unknown) => e,
  );
  return (error as { toJSON(): Record<string, unknown> }).toJSON();
}

/** A client plus a recorder for the account events. */
function client(options: ClientOptions = {}) {
  const c = makeClient(options);
  const defaults: AccountDefaultEvent[] = [];
  const disconnected: AccountDisconnectedEvent[] = [];
  c.sendo.on("account.default", (e) => {
    defaults.push(e);
  });
  c.sendo.on("account.disconnected", (e) => {
    disconnected.push(e);
  });
  const add = (overrides: Partial<AccountInsertInput>) =>
    c.adapter.accounts.insert(accountInput(overrides));
  return { ...c, defaults, disconnected, add };
}

describe("Tenant resolution", () => {
  it("[AC-AC-4] two tenants with one number each send from their own number; no scope is ambiguous", async () => {
    graph.server.use(acceptSends());
    const c = client();
    const a = await c.add({ tenantId: "tenant-a", phoneNumberId: "PN_A", wabaId: "WABA_A" });
    const b = await c.add({
      tenantId: "tenant-b",
      phoneNumberId: "PN_B",
      wabaId: "WABA_B",
      tokenRef: "SENDO_TOKEN_B",
    });
    await openConversation(c.ctx, a, PHONE);
    await openConversation(c.ctx, b, PHONE);

    const fromA = await c.sendo.send.text(PHONE, "hola A", { tenant: "tenant-a" });
    const fromB = await c.sendo.send.text(PHONE, "hola B", { tenant: "tenant-b" });
    expect(sentFrom()).toEqual([sendUrl("PN_A"), sendUrl("PN_B")]);
    expect(fromA).toMatchObject({ tenantId: "tenant-a", status: "sent" });
    expect(fromB).toMatchObject({ tenantId: "tenant-b", status: "sent" });

    graph.requests.length = 0;
    const error = await rejection(c.sendo.send.text(PHONE, "¿quién?"));
    expect(error).toMatchObject({ code: "AMBIGUOUS_ACCOUNT", candidates: [a.id, b.id] });
    expect(error).not.toHaveProperty("tenantId");
    expect(String(error.message)).toContain("{ tenant }");
    expect(graph.requests).toHaveLength(0);
  });

  it("[AC-AC-2] resolver matrix: account+tenant, tenant default, tenant ambiguity, empty tenant", async () => {
    graph.server.use(acceptSends());
    const c = client();
    const a = await c.add({ tenantId: "tenant-a", phoneNumberId: "PN_A", wabaId: "WABA_A" });
    const b1 = await c.add({ tenantId: "tenant-b", phoneNumberId: "PN_B1", wabaId: "WABA_B" });
    const b2 = await c.add({ tenantId: "tenant-b", phoneNumberId: "PN_B2", wabaId: "WABA_B" });
    const untenanted = await c.add({ tenantId: null, phoneNumberId: "PN_N", wabaId: "WABA_N" });
    for (const account of [a, b1, b2, untenanted]) await openConversation(c.ctx, account, PHONE);

    // account + mismatching tenant → not found; matching tenant → that account
    expect(
      await rejection(c.sendo.send.text(PHONE, "x", { account: a.id, tenant: "tenant-b" })),
    ).toMatchObject({ code: "ACCOUNT_NOT_FOUND", account: a.id, tenantId: "tenant-b" });
    expect(
      await rejection(c.sendo.send.text(PHONE, "x", { account: "PN_A", tenant: null })),
    ).toMatchObject({ code: "ACCOUNT_NOT_FOUND", tenantId: null });
    await c.sendo.send.text(PHONE, "ok", { account: "PN_B2", tenant: "tenant-b" });

    // tenant with two numbers and no default → ambiguous with only that tenant's candidates
    const ambiguous = await rejection(c.sendo.send.text(PHONE, "x", { tenant: "tenant-b" }));
    expect(ambiguous).toMatchObject({
      code: "AMBIGUOUS_ACCOUNT",
      candidates: [b1.id, b2.id],
      tenantId: "tenant-b",
    });
    expect(String(ambiguous.message)).toContain("setDefault");

    // with a default, the tenant resolves to it
    await c.sendo.accounts.setDefault(b2.id);
    await c.sendo.send.text(PHONE, "por defecto", { tenant: "tenant-b" });

    // null tenant = accounts without tenant; unknown tenant → not found
    await c.sendo.send.text(PHONE, "sin tenant", { tenant: null });
    expect(await rejection(c.sendo.send.text(PHONE, "x", { tenant: "tenant-z" }))).toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
      account: null,
      tenantId: "tenant-z",
    });

    // a tenant whose only number is disconnected has none
    await c.sendo.accounts.disconnect(a.id);
    expect(await rejection(c.sendo.send.text(PHONE, "x", { tenant: "tenant-a" }))).toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
      tenantId: "tenant-a",
    });

    expect(sentFrom()).toEqual([sendUrl("PN_B2"), sendUrl("PN_B2"), sendUrl("PN_N")]);
  });

  it("[AC-AC-1] the other send methods and templates.sync/list honour { tenant }", async () => {
    graph.server.use(
      acceptSends(),
      http.get(`${GRAPH}/:wabaId/message_templates`, ({ params }) =>
        HttpResponse.json({
          data: [
            {
              id: `tpl-${String(params.wabaId)}`,
              name: `cita_${String(params.wabaId).toLowerCase()}`,
              language: "es",
              status: "APPROVED",
              category: "UTILITY",
              components: [{ type: "BODY", text: "Hola {{1}}" }],
            },
          ],
        }),
      ),
    );
    const c = client();
    const a = await c.add({ tenantId: "tenant-a", phoneNumberId: "PN_A", wabaId: "WABA_A" });
    const b = await c.add({ tenantId: "tenant-b", phoneNumberId: "PN_B", wabaId: "WABA_B" });
    await openConversation(c.ctx, b, PHONE);

    const synced = await c.sendo.templates.sync({ tenant: "tenant-b" });
    expect(synced.map((t) => [t.accountId, t.name])).toEqual([[b.id, "cita_waba_b"]]);
    expect(graph.requests.map((r) => new URL(r.url).pathname)).toEqual([
      new URL(`${GRAPH}/WABA_B/message_templates`).pathname,
    ]);
    await c.sendo.templates.sync({ tenant: "tenant-a" });

    expect((await c.sendo.templates.list({ tenant: "tenant-a" })).map((t) => t.accountId)).toEqual([
      a.id,
    ]);
    expect(
      await rejection(c.sendo.templates.list({ account: a.id, tenant: "tenant-b" })),
    ).toMatchObject({ code: "ACCOUNT_NOT_FOUND" });

    graph.requests.length = 0;
    await c.sendo.send.template(PHONE, "cita_waba_b", {
      tenant: "tenant-b",
      language: "es",
      variables: ["Ana"],
    });
    await c.sendo.send.buttons(
      PHONE,
      { body: "¿Confirmas?", buttons: [{ id: "si", title: "Sí" }] },
      { tenant: "tenant-b" },
    );
    expect(sentFrom()).toEqual([sendUrl("PN_B"), sendUrl("PN_B")]);
  });
});

describe("sendo.accounts", () => {
  it("[AC-AC-5][AC-AC-3] add makes the tenant's first number the default; setDefault swaps it", async () => {
    graph.server.use(acceptSends());
    const c = client();
    const first = await c.sendo.accounts.add(
      accountInput({ phoneNumberId: "PN_1", label: "Recepción" }),
    );
    const second = await c.sendo.accounts.add(accountInput({ phoneNumberId: "PN_2" }));
    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);
    expect(c.defaults).toEqual([{ tenantId: "tenant-a", account: first, previous: null }]);

    const third = await c.sendo.accounts.add(
      accountInput({ phoneNumberId: "PN_3", isDefault: true }),
    );
    expect(third.isDefault).toBe(true);
    expect((await c.sendo.accounts.get(first.id)).isDefault).toBe(false);
    expect(c.defaults.at(-1)).toMatchObject({
      account: { id: third.id },
      previous: { id: first.id, isDefault: true },
    });

    const swapped = await c.sendo.accounts.setDefault("PN_2");
    expect(swapped).toMatchObject({ id: second.id, isDefault: true });
    expect(
      (await c.sendo.accounts.list({ tenant: "tenant-a" })).filter((a) => a.isDefault),
    ).toEqual([swapped]);
    const events = c.defaults.length;
    await c.sendo.accounts.setDefault(second.id);
    expect(c.defaults).toHaveLength(events);

    await openConversation(c.ctx, swapped, PHONE);
    await c.sendo.send.text(PHONE, "hola", { tenant: "tenant-a" });
    expect(sentFrom()).toEqual([sendUrl("PN_2")]);

    const other = await c.sendo.accounts.add(
      accountInput({ tenantId: "tenant-b", phoneNumberId: "PN_9", isDefault: false }),
    );
    expect(other.isDefault).toBe(false);
  });

  it("[AC-AC-5] label, agent pause and mode, get, list and the SND-2.3 stubs", async () => {
    const c = client();
    const account = await c.sendo.accounts.add(accountInput());

    expect((await c.sendo.accounts.setLabel(account.id, "  Caja  ")).label).toBe("Caja");
    expect((await c.sendo.accounts.setLabel(account.id, " ")).label).toBeNull();
    expect(
      (await c.sendo.accounts.pauseAgent(account.id, true, { by: "user-1" })).agentPaused,
    ).toBe(true);
    expect((await c.sendo.accounts.setAgentMode("PN_A", "draft")).agentMode).toBe("draft");
    expect((await c.sendo.accounts.setAgentMode(account.id, null)).agentMode).toBeNull();
    expect(await c.sendo.accounts.get("PN_A")).toMatchObject({ id: account.id, agentPaused: true });
    expect(await rejection(c.sendo.accounts.get("PN_NOPE"))).toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
      account: "PN_NOPE",
    });
    expect(await rejection(c.sendo.accounts.setLabel("PN_NOPE", "x"))).toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
    });

    await c.sendo.accounts.disconnect(account.id);
    expect(await c.sendo.accounts.list()).toEqual([]);
    expect((await c.sendo.accounts.list({ includeInactive: true })).map((a) => a.id)).toEqual([
      account.id,
    ]);
    expect(await rejection(c.sendo.accounts.setDefault(account.id))).toMatchObject({
      code: "ACCOUNT_STATE",
      state: "inactive",
    });

    expect(await rejection(c.sendo.accounts.refreshBilling(account.id))).toMatchObject({
      code: "ACCOUNT_STATE",
    });
    expect(
      await rejection(
        c.sendo.accounts.completeEmbeddedSignup({
          code: "c",
          tenantId: "tenant-a",
          wabaId: "WABA_A",
          phoneNumberId: "PN_A",
        }),
      ),
    ).toMatchObject({ code: "CONFIG_ERROR" }); // no storeToken / meta.appId configured
  });

  it("[AC-AC-6] disconnect keeps the data, promotes the only remaining number and calls deleteToken", async () => {
    graph.server.use(acceptSends());
    const deleteToken = vi.fn(() => Promise.resolve());
    const c = client({ deleteToken });
    const main = await c.sendo.accounts.add(accountInput({ phoneNumberId: "PN_MAIN" }));
    const backup = await c.sendo.accounts.add(
      accountInput({ phoneNumberId: "PN_BACKUP", tokenRef: "SENDO_TOKEN_B" }),
    );
    const { conversation } = await openConversation(c.ctx, main, PHONE);
    await c.sendo.send.text(PHONE, "antes", { tenant: "tenant-a" });

    const disconnected = await c.sendo.accounts.disconnect(main.id, { by: "admin-1" });
    expect(disconnected).toMatchObject({ id: main.id, active: false, isDefault: false });
    expect((await c.sendo.accounts.get(backup.id)).isDefault).toBe(true);
    expect(deleteToken).toHaveBeenCalledWith("SENDO_TOKEN_A");
    expect(c.disconnected).toEqual([{ account: disconnected, by: "admin-1" }]);
    expect(c.defaults.at(-1)).toEqual({
      tenantId: "tenant-a",
      account: { ...backup, isDefault: true },
      previous: disconnected,
    });
    expect(graph.requests.filter((r) => r.method === "DELETE")).toHaveLength(0);

    // data kept and readable
    expect(await c.sendo.conversations.get(conversation.id)).toMatchObject({ accountId: main.id });
    expect(c.adapter.__state.messages.size).toBe(1);

    // sends now go out from the promoted number
    await openConversation(c.ctx, { ...backup, isDefault: true }, PHONE);
    graph.requests.length = 0;
    await c.sendo.send.text(PHONE, "después", { tenant: "tenant-a" });
    expect(sentFrom()).toEqual([sendUrl("PN_BACKUP")]);

    // disconnecting again is a no-op
    await c.sendo.accounts.disconnect(main.id);
    expect(c.disconnected).toHaveLength(1);
    expect(deleteToken).toHaveBeenCalledTimes(1);
  });

  it("[AC-AC-6] the default of a tenant with several numbers left is cleared, not promoted", async () => {
    const c = client();
    const a = await c.sendo.accounts.add(accountInput({ phoneNumberId: "PN_1" }));
    await c.sendo.accounts.add(accountInput({ phoneNumberId: "PN_2" }));
    await c.sendo.accounts.add(accountInput({ phoneNumberId: "PN_3" }));
    await c.sendo.accounts.disconnect(a.id);
    expect((await c.sendo.accounts.list({ tenant: "tenant-a" })).some((x) => x.isDefault)).toBe(
      false,
    );
    expect(c.defaults.at(-1)).toMatchObject({ account: null, previous: { id: a.id } });
    expect(await rejection(c.sendo.send.text(PHONE, "x", { tenant: "tenant-a" }))).toMatchObject({
      code: "AMBIGUOUS_ACCOUNT",
      tenantId: "tenant-a",
    });

    // disconnecting a non-default number that leaves exactly one promotes it
    const b = await c.sendo.accounts.list({ tenant: "tenant-a" });
    await c.sendo.accounts.disconnect(b[0]?.id ?? "");
    expect(c.defaults.at(-1)).toMatchObject({ account: { id: b[1]?.id }, previous: null });
  });

  it("[AC-AC-6] Embedded Signup numbers are unsubscribed best effort; a failure is logged, never thrown", async () => {
    const unsubscribed: string[] = [];
    graph.server.use(
      http.delete(`${GRAPH}/:wabaId/subscribed_apps`, ({ params, request }) => {
        unsubscribed.push(String(params.wabaId));
        expect(request.headers.get("authorization")).toBe(`Bearer ${TOKENS.SENDO_TOKEN_A ?? ""}`);
        return params.wabaId === "WABA_OK"
          ? HttpResponse.json({ success: true })
          : HttpResponse.json(
              {
                error: {
                  code: 100,
                  message: "Unsupported delete request",
                  type: "GraphMethodException",
                },
              },
              { status: 400 },
            );
      }),
    );
    const deleteToken = vi.fn(() => Promise.reject(new Error("vault down")));
    const c = client({ deleteToken });
    const ok = await c.sendo.accounts.add(
      accountInput({ phoneNumberId: "PN_OK", wabaId: "WABA_OK", onboardedVia: "embedded_signup" }),
    );
    const bad = await c.sendo.accounts.add(
      accountInput({
        phoneNumberId: "PN_BAD",
        wabaId: "WABA_BAD",
        onboardedVia: "embedded_signup",
      }),
    );

    await expect(c.sendo.accounts.disconnect(ok.id)).resolves.toMatchObject({ active: false });
    await expect(c.sendo.accounts.disconnect(bad.id)).resolves.toMatchObject({ active: false });
    expect(unsubscribed).toEqual(["WABA_OK", "WABA_BAD"]);
    expect(deleteToken).toHaveBeenCalledTimes(2);
    const warnings = c.logs.of("warn").join("\n");
    expect(warnings).toContain("WABA_BAD");
    expect(warnings).toContain("deleteToken failed");
    expect(JSON.stringify(c.logs.entries)).not.toContain(TOKENS.SENDO_TOKEN_A);
    expect(c.disconnected).toHaveLength(2);
  });

  it("[AC-AC-6] reconnecting a disconnected number reuses its row; other tenants get ACCOUNT_EXISTS", async () => {
    const c = client();
    const original = await c.sendo.accounts.add(accountInput({ label: "Recepción" }));
    const { conversation } = await openConversation(c.ctx, original, PHONE);
    await c.sendo.accounts.disconnect(original.id);

    expect(
      await rejection(c.sendo.accounts.add(accountInput({ tenantId: "tenant-b" }))),
    ).toMatchObject({ code: "ACCOUNT_EXISTS", phoneNumberId: "PN_A" });

    const again = await c.sendo.accounts.add(accountInput({ tokenRef: "SENDO_TOKEN_B" }));
    expect(again).toMatchObject({
      id: original.id,
      active: true,
      isDefault: true,
      label: "Recepción",
      tokenRef: "SENDO_TOKEN_B",
    });
    expect((await c.sendo.conversations.get(conversation.id))?.accountId).toBe(original.id);

    expect(
      await rejection(c.sendo.accounts.add(accountInput({ tenantId: "tenant-b" }))),
    ).toMatchObject({ code: "ACCOUNT_EXISTS" });
  });

  it("[AC-AC-7] purge refuses an active number, then deletes everything of a disconnected one", async () => {
    graph.server.use(...mediaHandlers());
    const h = await createHarness();
    const other = await h.adapter.accounts.insert(
      accountInput({
        phoneNumberId: FIXTURE_IDS.secondPhoneNumberId,
        wabaId: FIXTURE_IDS.secondWabaId,
        tenantId: "tenant-b",
      }),
    );
    await h.deliver(freshFixture("image"));
    await h.deliver(freshFixture("document"));
    await h.adapter.storage.put("tenant-b/keep.jpg", new Uint8Array([1]), "image/jpeg");
    const paths = [...h.adapter.__state.media.values()].map((m) => m.storagePath ?? "");
    expect(paths).toHaveLength(2);

    expect(await rejection(h.sendo.accounts.purge(h.account.id))).toMatchObject({
      code: "ACCOUNT_STATE",
      state: "active",
      accountId: h.account.id,
    });
    expect(h.adapter.__state.messages.size).toBe(2);

    await h.sendo.accounts.disconnect(h.account.id);
    await h.sendo.accounts.purge(FIXTURE_IDS.phoneNumberId);

    const state = h.adapter.__state;
    expect([...state.accounts.keys()]).toEqual([other.id]);
    expect(state.contacts.size + state.conversations.size + state.messages.size).toBe(0);
    expect(state.media.size).toBe(0);
    for (const path of paths) expect(await h.adapter.storage.get(path)).toBeNull();
    expect(await h.adapter.storage.get("tenant-b/keep.jpg")).not.toBeNull();
    expect(await rejection(h.sendo.accounts.purge(h.account.id))).toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
    });
  });
});

describe("CLI accounts", () => {
  function cli(adapter: CliDeps["createAdapter"]) {
    const out: string[] = [];
    const err: string[] = [];
    const deps: CliDeps = {
      env: { SENDO_TOKEN_A: TOKENS.SENDO_TOKEN_A },
      cwd: "/app",
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      readFile: () => null,
      createAdapter: adapter,
      version: "0.0.0",
    };
    return {
      run: async (argv: string[]) => {
        out.length = 0;
        err.length = 0;
        return runCli(argv, deps);
      },
      stdout: () => out.join(""),
      stderr: () => err.join(""),
    };
  }

  it("[AC-AC-8] list (table and --json), set-default and disconnect", async () => {
    const c = client();
    const one = await c.sendo.accounts.add(accountInput({ phoneNumberId: "PN_1", label: "Caja" }));
    const two = await c.sendo.accounts.add(accountInput({ phoneNumberId: "PN_2" }));
    const elsewhere = await c.sendo.accounts.add(
      accountInput({ tenantId: "tenant-b", phoneNumberId: "PN_9" }),
    );
    const run = cli(() => Promise.resolve(c.adapter));

    expect(await run.run(["accounts", "list"])).toBe(EXIT_OK);
    const table = run.stdout();
    expect(table).toMatch(/ID\s+Número\s+Etiqueta\s+Tenant\s+Estado\s+Defecto\s+Alta/);
    expect(table).toMatch(new RegExp(`${one.id}.*Caja.*tenant-a.*conectado\\s+sí\\s+manual`));

    expect(await run.run(["accounts", "list", "--json", "--tenant-id", "tenant-a"])).toBe(EXIT_OK);
    const listed = JSON.parse(run.stdout()) as Account[];
    expect(listed.map((a) => a.id)).toEqual([one.id, two.id]);

    expect(await run.run(["accounts", "set-default", "PN_2"])).toBe(EXIT_OK);
    expect(run.stdout()).toContain(`Número por defecto del tenant tenant-a: ${two.displayPhone}`);
    expect(run.stdout()).toContain(`Antes: ${one.displayPhone} "Caja" (${one.id})`);
    expect((await c.sendo.accounts.get(two.id)).isDefault).toBe(true);

    expect(await run.run(["accounts", "disconnect", two.id])).toBe(EXIT_OK);
    expect(run.stdout()).toContain(`Número desconectado: ${two.displayPhone} (${two.id})`);
    expect(run.stdout()).toContain(`Nuevo número por defecto del tenant tenant-a`);
    expect((await c.sendo.accounts.get(one.id)).isDefault).toBe(true);
    expect((await c.sendo.accounts.get(elsewhere.id)).isDefault).toBe(true);

    expect(await run.run(["accounts", "set-default", two.id])).toBe(EXIT_FAILURE);
    expect(run.stderr()).toContain("está desconectada");
    expect(await run.run(["accounts", "disconnect", "PN_NOPE"])).toBe(EXIT_FAILURE);
    expect(run.stderr()).toContain("No existe una cuenta");
  });
});
