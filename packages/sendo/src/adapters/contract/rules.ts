import { describe, expect, it } from "vitest";
import type { RuleType } from "../../rules/schemas";
import type { RuleUpsertInput } from "../types";
import { type Fresh, NOT_FOUND, makeTenantId, seedAccount, tick, violates } from "./helpers";

const ESCALATE = { afterMinutes: 15, action: "notify" };
const ROUTE = { match: { keywords: ["pago"] }, action: { queue: "cobranza", to: "human" } };

/** Contract for `rules`. */
export function rulesContract(fresh: Fresh): void {
  describe("rules", () => {
    const base = (overrides: Partial<RuleUpsertInput> = {}): RuleUpsertInput => ({
      tenantId: makeTenantId(),
      key: "escalar-15",
      type: "escalate",
      params: ESCALATE,
      ...overrides,
    });

    it("inserts with defaults, appending positions per tenant", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const first = await adapter.rules.upsert(base({ tenantId, updatedBy: "admin-1" }));
      expect(first.created).toBe(true);
      expect(first.rule).toMatchObject({
        tenantId,
        accountId: null,
        key: "escalar-15",
        type: "escalate",
        params: ESCALATE,
        position: 0,
        active: true,
        origin: "screen",
        state: {},
        updatedBy: "admin-1",
      });
      expect(first.rule.updatedAt).toBeInstanceOf(Date);
      expect(await adapter.rules.get(first.rule.id)).toEqual(first.rule);
      expect(await adapter.rules.get(crypto.randomUUID())).toBeNull();

      const second = await adapter.rules.upsert(
        base({ tenantId, key: "ruta-pagos", type: "route", params: ROUTE, origin: "code" }),
      );
      expect(second.rule).toMatchObject({ position: 1, origin: "code" });
      const placed = await adapter.rules.upsert(base({ tenantId, key: "cierre", position: 7 }));
      expect(placed.rule.position).toBe(7);
      expect((await adapter.rules.upsert(base({ tenantId, key: "otra" }))).rule.position).toBe(8);
      expect((await adapter.rules.upsert(base({ key: "escalar-15" }))).rule.position).toBe(0);
    });

    it("upserts by (tenant, key): updates in place, or returns the stored rule with ifMissing", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const { rule } = await adapter.rules.upsert(base({ tenantId, origin: "code" }));
      await adapter.rules.patchState(rule.id, { cursor: 2 });
      await tick();

      const skipped = await adapter.rules.upsert(
        base({ tenantId, params: { afterMinutes: 99, action: "notify" } }),
        { ifMissing: true },
      );
      expect(skipped).toEqual({ rule: { ...rule, state: { cursor: 2 } }, created: false });

      const updated = await adapter.rules.upsert(
        base({ tenantId, params: { afterMinutes: 30, action: "reassign" }, updatedBy: "admin-2" }),
      );
      expect(updated.created).toBe(false);
      expect(updated.rule).toMatchObject({
        id: rule.id,
        params: { afterMinutes: 30, action: "reassign" },
        position: 0,
        active: true,
        origin: "code",
        state: { cursor: 2 },
        updatedBy: "admin-2",
      });
      expect(updated.rule.updatedAt.getTime()).toBeGreaterThan(rule.updatedAt.getTime());

      const retyped = await adapter.rules.upsert(
        base({ tenantId, type: "auto_close", params: { afterDays: 7 }, active: false }),
      );
      expect(retyped.rule).toMatchObject({
        id: rule.id,
        type: "auto_close",
        active: false,
        state: {},
      });

      const fresh2 = await adapter.rules.upsert(base({ tenantId, key: "nueva" }), {
        ifMissing: true,
      });
      expect(fresh2.created).toBe(true);
      expect(await adapter.rules.list({ tenantId })).toHaveLength(2);
    });

    it("rejects unknown types and origins", async () => {
      const adapter = await fresh();
      await expect(adapter.rules.upsert(base({ type: "magic" as RuleType }))).rejects.toMatchObject(
        violates("sendo_rules_type_check"),
      );
      await expect(
        adapter.rules.upsert(base({ origin: "api" as RuleUpsertInput["origin"] })),
      ).rejects.toMatchObject(violates("sendo_rules_origin_check"));
    });

    it("lists by tenant, effective account and active flag, ordered by position", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const accountA = await seedAccount(adapter, { tenantId });
      const accountB = await seedAccount(adapter, { tenantId });
      const put = async (key: string, overrides: Partial<RuleUpsertInput> = {}) =>
        (await adapter.rules.upsert(base({ tenantId, key, ...overrides }))).rule;

      const general = await put("general", { position: 2 });
      const forA = await put("solo-a", { accountId: accountA.id, position: 1 });
      const forB = await put("solo-b", { accountId: accountB.id, position: 1 });
      const off = await put("apagada", { active: false, position: 0 });
      const other = (await adapter.rules.upsert(base({ key: "ajena" }))).rule;

      const keys = async (query: Parameters<typeof adapter.rules.list>[0]) =>
        (await adapter.rules.list(query)).map((r) => r.key);

      expect(await keys({ tenantId })).toEqual(["apagada", "solo-a", "solo-b", "general"]);
      expect(await keys({ tenantId, accountId: accountA.id })).toEqual([
        "apagada",
        "solo-a",
        "general",
      ]);
      expect(await keys({ tenantId, accountId: accountB.id, active: true })).toEqual([
        "solo-b",
        "general",
      ]);
      const everyTenant = (await adapter.rules.list()).map((r) => r.id);
      for (const r of [general, forA, forB, off, other]) expect(everyTenant).toContain(r.id);
    });

    it("update changes the given fields; delete removes", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const account = await seedAccount(adapter, { tenantId });
      const { rule } = await adapter.rules.upsert(base({ tenantId }));
      await tick();

      const toggled = await adapter.rules.update(rule.id, {
        active: false,
        accountId: account.id,
        updatedBy: "admin-3",
      });
      expect(toggled).toMatchObject({
        id: rule.id,
        active: false,
        accountId: account.id,
        params: ESCALATE,
        updatedBy: "admin-3",
      });
      expect(toggled.updatedAt.getTime()).toBeGreaterThan(rule.updatedAt.getTime());
      expect(await adapter.rules.get(rule.id)).toEqual(toggled);

      const id = crypto.randomUUID();
      await expect(adapter.rules.update(id, { active: true })).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "rule",
        id,
      });
      await adapter.rules.delete(rule.id);
      expect(await adapter.rules.get(rule.id)).toBeNull();
      await expect(adapter.rules.delete(rule.id)).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "rule",
      });
    });

    it("reorder sets positions within the tenant, all or nothing", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const a = (await adapter.rules.upsert(base({ tenantId, key: "a" }))).rule;
      const b = (await adapter.rules.upsert(base({ tenantId, key: "b" }))).rule;
      const c = (await adapter.rules.upsert(base({ tenantId, key: "c" }))).rule;
      const foreign = (await adapter.rules.upsert(base({ key: "x" }))).rule;

      await adapter.rules.reorder(tenantId, [c.id, a.id, b.id]);
      expect((await adapter.rules.list({ tenantId })).map((r) => [r.key, r.position])).toEqual([
        ["c", 0],
        ["a", 1],
        ["b", 2],
      ]);

      await expect(adapter.rules.reorder(tenantId, [b.id, foreign.id])).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "rule",
        id: foreign.id,
      });
      const unknown = crypto.randomUUID();
      await expect(adapter.rules.reorder(tenantId, [unknown])).rejects.toMatchObject({
        ...NOT_FOUND,
        id: unknown,
      });
      expect((await adapter.rules.list({ tenantId })).map((r) => r.key)).toEqual(["c", "a", "b"]);
      expect((await adapter.rules.get(foreign.id))?.position).toBe(0);
      await adapter.rules.reorder(tenantId, []);
    });

    it("patchState shallow-merges state without touching updatedAt", async () => {
      const adapter = await fresh();
      const { rule } = await adapter.rules.upsert(
        base({ type: "auto_assign", params: { strategy: "round_robin" } }),
      );
      await adapter.rules.patchState(rule.id, { cursor: 1, seen: { a: 1 } });
      const patched = await adapter.rules.patchState(rule.id, { cursor: 2, seen: { b: 2 } });
      expect(patched.state).toEqual({ cursor: 2, seen: { b: 2 } });
      expect(patched.updatedAt).toEqual(rule.updatedAt);
      expect(await adapter.rules.get(rule.id)).toEqual(patched);

      const id = crypto.randomUUID();
      await expect(adapter.rules.patchState(id, { cursor: 0 })).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "rule",
        id,
      });
    });
  });
}
