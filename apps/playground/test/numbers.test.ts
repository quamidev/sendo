/**
 * The installed numbers screen end to end in fixtures mode: the real server actions
 * (`app/(protected)/inbox/numbers/actions.ts`), `sendo.actor` with the playground's
 * `resolveRole`, the memory adapter seeded from `fixtures/numbers/`, and the fake Graph API
 * (billing reads, a revoked token, Embedded Signup code exchange / subscribe / register).
 * The fixture is picked like in the browser, through the `sendo-playground-numbers` cookie.
 *
 * [NS-1] AC-NS-2: every row state comes out of `list` (token invalid from `account.error`).
 * [NS-2] AC-NS-1: an agent gets a read-only list and every change is FORBIDDEN.
 * [NS-3] AC-ES-1/AC-ES-2: connect through Embedded Signup; the first number becomes default;
 *        PIN conflict creates nothing and the retry with the PIN connects.
 * [NS-4] Token inválido · reconectar: Meta must return the same number; reconnecting keeps
 *        the account id and the token mark clears.
 * [NS-5] Disconnect needs the last 4 digits; the only remaining number becomes the default.
 * [NS-6] Numbers of another tenant look unknown.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as ActionsModule from "@/app/(protected)/inbox/numbers/actions";
import type { NumbersMutation, NumberView } from "@/components/sendo/numbers/types";
import type * as NumbersFixtures from "@/fixtures/numbers";

let fixture: string | undefined;

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "sendo-playground-numbers" && fixture !== undefined
          ? { name, value: fixture }
          : undefined,
    }),
}));

let actions: typeof ActionsModule;
let fixtures: typeof NumbersFixtures;
let statusOf: (view: NumberView) => string;

async function listAs(name: string) {
  fixture = name;
  const result = await actions.list();
  if (!result.ok) throw new Error(`list failed: ${result.code}`);
  return result.data;
}

function mutationOf(result: { ok: true; data: NumbersMutation } | { ok: false; code: string }) {
  if (!result.ok) throw new Error(`action failed: ${result.code}`);
  return result.data;
}

beforeAll(async () => {
  vi.stubEnv("SENDO_PLAYGROUND_MODE", "fixtures");
  vi.stubEnv("SENDO_AGENT_MODEL", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
  actions = await import("@/app/(protected)/inbox/numbers/actions");
  fixtures = await import("@/fixtures/numbers");
  statusOf = (await import("@/components/sendo/numbers/types")).numberStatus;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("numbers screen actions (fixtures mode)", () => {
  it("[NS-1] lists every status of the worst-case tenant for an admin", async () => {
    const page = await listAs("worst");
    expect(page.access).toBe("manage");
    // Active numbers first (oldest first), then disconnected ones.
    expect(page.numbers.map((number) => [number.label, statusOf(number)])).toEqual([
      ["Recepción", "connected"],
      [fixtures.LONG_NUMBER_LABEL, "billing_missing"],
      [null, "billing_unknown"],
      ["Ventas", "token_invalid"],
      ["Jo", "connected"],
      ["Mantenimiento", "disconnected"],
    ]);
    const byLabel = new Map(page.numbers.map((number) => [number.label, number]));
    expect(byLabel.get("Recepción")?.isDefault).toBe(true);
    expect(byLabel.get(fixtures.LONG_NUMBER_LABEL)?.coexistence).toBe(true);
    expect(byLabel.get(null)?.onboardedVia).toBe("manual");
    expect(JSON.stringify(page)).not.toMatch(/vault:|tokenRef|SENDO_TOKEN/);
  });

  it("[NS-2] gives an agent a read-only list and refuses every change", async () => {
    const page = await listAs("agent");
    expect(page.access).toBe("read");
    expect(page.numbers).toHaveLength(6);
    const target = page.numbers[1];
    if (target === undefined) throw new Error("fixture changed");
    const attempts = await Promise.all([
      actions.setDefault(target.id),
      actions.setLabel(target.id, "Hackeado"),
      actions.pauseAgent(target.id, false),
      actions.setAgentMode(target.id, "auto"),
      actions.refreshBilling(target.id),
      actions.disconnect(target.id, "5678"),
      actions.connect({ code: "c", wabaId: "w", phoneNumberId: "p", coexistence: false }),
    ]);
    expect(attempts.map((result) => (result.ok ? "ok" : result.code))).toEqual(
      Array.from({ length: 7 }, () => "FORBIDDEN"),
    );
    const after = await listAs("worst");
    expect(after.numbers.find((number) => number.id === target.id)).toMatchObject({
      label: target.label,
      agentPaused: true,
      active: true,
    });
  });

  it("[NS-3] connects numbers through Embedded Signup, with the PIN retry", async () => {
    expect((await listAs("empty")).numbers).toEqual([]);

    const first = mutationOf(
      await actions.connect({
        code: "playground-code-1",
        wabaId: "500000000000777",
        phoneNumberId: "700000000000777",
        coexistence: true,
      }),
    );
    const connected = first.numbers.find((number) => number.id === first.id);
    expect(connected).toMatchObject({
      phoneNumberId: "700000000000777",
      displayPhone: "+1 555-000-0777",
      isDefault: true,
      coexistence: true,
      onboardedVia: "embedded_signup",
      billingReady: true,
      active: true,
    });

    const conflict = await actions.connect({
      code: "playground-code-2",
      wabaId: "500000000010000",
      phoneNumberId: "700000000010000",
      coexistence: false,
    });
    expect(conflict.ok ? "ok" : conflict.code).toBe("PIN_CONFLICT");
    expect((await listAs("empty")).numbers).toHaveLength(1);

    const retried = mutationOf(
      await actions.connect({
        code: "playground-code-3",
        wabaId: "500000000010000",
        phoneNumberId: "700000000010000",
        coexistence: false,
        pin: "123456",
      }),
    );
    expect(retried.numbers).toHaveLength(2);
    expect(retried.numbers.find((number) => number.id === retried.id)?.isDefault).toBe(false);

    const duplicate = await actions.connect({
      code: "playground-code-4",
      wabaId: "500000000000777",
      phoneNumberId: "700000000000777",
      coexistence: true,
    });
    expect(duplicate.ok ? "ok" : duplicate.code).toBe("ALREADY_CONNECTED");
  });

  it("[NS-4] reconnects a number whose token Meta rejected", async () => {
    const ventas = (await listAs("worst")).numbers.find((number) => number.label === "Ventas");
    if (ventas?.phoneNumberId == null) throw new Error("fixture changed");
    expect(ventas.tokenInvalid).toBe(true);

    const wrong = await actions.connect({
      code: "playground-code-5",
      wabaId: "500000000000999",
      phoneNumberId: "700000000000999",
      coexistence: true,
      reconnectId: ventas.id,
    });
    expect(wrong.ok ? "ok" : wrong.code).toBe("WRONG_NUMBER");

    const done = mutationOf(
      await actions.connect({
        code: "playground-code-6",
        wabaId: "500000000000004",
        phoneNumberId: ventas.phoneNumberId,
        coexistence: true,
        reconnectId: ventas.id,
      }),
    );
    expect(done.id).toBe(ventas.id);
    const page = await listAs("worst");
    expect(page.numbers.find((number) => number.id === ventas.id)).toMatchObject({
      active: true,
      tokenInvalid: false,
      label: "Ventas",
      onboardedVia: "embedded_signup",
    });
  });

  it("[NS-5] disconnects only with the last 4 digits and promotes the remaining number", async () => {
    const page = await listAs("empty");
    const defaultNumber = page.numbers.find((number) => number.isDefault);
    const other = page.numbers.find((number) => !number.isDefault);
    if (defaultNumber === undefined || other === undefined) throw new Error("NS-3 changed");

    const mismatch = await actions.disconnect(defaultNumber.id, "0000");
    expect(mismatch.ok ? "ok" : mismatch.code).toBe("CONFIRMATION_MISMATCH");

    const done = mutationOf(await actions.disconnect(defaultNumber.id, "0777"));
    expect(done.numbers.find((number) => number.id === defaultNumber.id)).toMatchObject({
      active: false,
      isDefault: false,
    });
    expect(done.numbers.find((number) => number.id === other.id)?.isDefault).toBe(true);
  });

  it("[NS-6] treats numbers of another tenant as unknown", async () => {
    const worst = await listAs("worst");
    const foreign = worst.numbers[0];
    if (foreign === undefined) throw new Error("fixture changed");
    fixture = "demo";
    const results = await Promise.all([
      actions.setLabel(foreign.id, "x"),
      actions.pauseAgent(foreign.id, true),
      actions.disconnect(foreign.id, "1001"),
    ]);
    expect(results.map((result) => (result.ok ? "ok" : result.code))).toEqual([
      "NOT_FOUND",
      "NOT_FOUND",
      "NOT_FOUND",
    ]);
  });
});
