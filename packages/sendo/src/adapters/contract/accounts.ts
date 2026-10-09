import { describe, expect, it } from "vitest";
import {
  type Fresh,
  DUPLICATE_ACCOUNT,
  digits,
  tick,
  makeTenantId,
  makeAccountInput,
  seedAccount,
  violates,
} from "./helpers";

/** Contract for `accounts`. */
export function accountsContract(fresh: Fresh): void {
  describe("accounts", () => {
    it("inserts with defaults and reads by id and phone number id", async () => {
      const adapter = await fresh();
      const input = makeAccountInput({ tenantId: makeTenantId() });
      const account = await adapter.accounts.insert(input);

      expect(account).toMatchObject({
        tenantId: input.tenantId,
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId,
        displayPhone: input.displayPhone,
        tokenRef: input.tokenRef,
        timezone: "America/Guatemala",
        active: true,
        channel: "whatsapp",
        label: null,
        isDefault: false,
        coexistence: false,
        onboardedVia: "manual",
        agentPaused: false,
        agentMode: null,
        billingReady: null,
        billingCheckedAt: null,
      });
      expect(typeof account.id).toBe("string");
      expect(account.createdAt).toBeInstanceOf(Date);
      expect(await adapter.accounts.getById(account.id)).toEqual(account);
      expect(await adapter.accounts.getByPhoneNumberId(input.phoneNumberId)).toEqual(account);
    });

    it("stores the channel, onboarding, agent and billing columns", async () => {
      const adapter = await fresh();
      const billingCheckedAt = new Date("2026-03-01T12:00:00.000Z");
      const account = await seedAccount(adapter, {
        tenantId: makeTenantId(),
        channel: "whatsapp",
        label: "Recepción",
        coexistence: true,
        onboardedVia: "embedded_signup",
        agentPaused: true,
        agentMode: "draft",
        billingReady: false,
        billingCheckedAt,
      });
      const expected = {
        channel: "whatsapp",
        label: "Recepción",
        coexistence: true,
        onboardedVia: "embedded_signup",
        agentPaused: true,
        agentMode: "draft",
        billingReady: false,
        billingCheckedAt,
      };
      expect(account).toMatchObject(expected);
      expect(await adapter.accounts.getById(account.id)).toMatchObject(expected);
    });

    it("allows one default account per tenant", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const first = await seedAccount(adapter, { tenantId, isDefault: true });
      expect(first.isDefault).toBe(true);

      await expect(seedAccount(adapter, { tenantId, isDefault: true })).rejects.toMatchObject(
        violates("sendo_accounts_default_per_tenant"),
      );
      const other = await seedAccount(adapter, { tenantId });
      expect(other.isDefault).toBe(false);
      const elsewhere = await seedAccount(adapter, { tenantId: makeTenantId(), isDefault: true });
      expect(elsewhere.isDefault).toBe(true);
      expect(
        (await adapter.accounts.list({ tenantId })).filter((a) => a.isDefault).map((a) => a.id),
      ).toEqual([first.id]);
    });

    it("treats accounts without a tenant as one tenant for the default", async () => {
      const adapter = await fresh();
      const first = await seedAccount(adapter, { tenantId: null, isDefault: true });
      await expect(seedAccount(adapter, { tenantId: null, isDefault: true })).rejects.toMatchObject(
        violates("sendo_accounts_default_per_tenant"),
      );
      expect((await adapter.accounts.getById(first.id))?.isDefault).toBe(true);
    });

    it("requires phoneNumberId and wabaId on whatsapp accounts", async () => {
      const adapter = await fresh();
      await expect(seedAccount(adapter, { phoneNumberId: null })).rejects.toMatchObject(
        violates("sendo_accounts_whatsapp_ids"),
      );
      await expect(seedAccount(adapter, { wabaId: undefined })).rejects.toMatchObject(
        violates("sendo_accounts_whatsapp_ids"),
      );
    });

    it("returns null for unknown accounts", async () => {
      const adapter = await fresh();
      expect(await adapter.accounts.getById(crypto.randomUUID())).toBeNull();
      expect(await adapter.accounts.getByPhoneNumberId(`pn${digits(12)}`)).toBeNull();
    });

    it("throws DuplicateAccountError for a repeated phone number id", async () => {
      const adapter = await fresh();
      const input = makeAccountInput();
      await adapter.accounts.insert(input);
      await expect(adapter.accounts.insert({ ...input, wabaId: "other" })).rejects.toMatchObject({
        ...DUPLICATE_ACCOUNT,
        phoneNumberId: input.phoneNumberId,
      });
    });

    it("lists by tenant and active flag, oldest first", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const first = await seedAccount(adapter, { tenantId });
      await tick();
      const second = await seedAccount(adapter, { tenantId, active: false, timezone: "UTC" });
      await seedAccount(adapter, { tenantId: makeTenantId() });

      expect((await adapter.accounts.list({ tenantId })).map((a) => a.id)).toEqual([
        first.id,
        second.id,
      ]);
      expect((await adapter.accounts.list({ tenantId, active: false })).map((a) => a.id)).toEqual([
        second.id,
      ]);
      expect(second.timezone).toBe("UTC");
      const all = (await adapter.accounts.list()).map((a) => a.id);
      expect(all).toEqual(expect.arrayContaining([first.id, second.id]));
    });

    it("lists accounts without a tenant when tenantId is null", async () => {
      const adapter = await fresh();
      const untenanted = await seedAccount(adapter, { tenantId: null });
      const tenanted = await seedAccount(adapter, { tenantId: makeTenantId() });
      const ids = (await adapter.accounts.list({ tenantId: null })).map((a) => a.id);
      expect(ids).toContain(untenanted.id);
      expect(ids).not.toContain(tenanted.id);
    });
  });
}
