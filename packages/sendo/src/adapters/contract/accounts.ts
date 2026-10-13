import { describe, expect, it } from "vitest";
import {
  type Fresh,
  ACCOUNT_ACTIVE,
  DUPLICATE_ACCOUNT,
  NOT_FOUND,
  digits,
  tick,
  makeInbound,
  makeTemplateInput,
  makeTenantId,
  makeAccountInput,
  seedAccount,
  seedConversation,
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

    it("setDefault swaps the tenant's default atomically and leaves other tenants alone", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const first = await seedAccount(adapter, { tenantId, isDefault: true });
      const second = await seedAccount(adapter, { tenantId });
      const elsewhere = await seedAccount(adapter, { tenantId: makeTenantId(), isDefault: true });

      const swapped = await adapter.accounts.setDefault(second.id);
      expect(swapped).toMatchObject({ id: second.id, isDefault: true });
      expect((await adapter.accounts.getById(first.id))?.isDefault).toBe(false);
      expect((await adapter.accounts.getById(elsewhere.id))?.isDefault).toBe(true);

      expect((await adapter.accounts.setDefault(second.id)).isDefault).toBe(true);
      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          adapter.accounts.setDefault(i % 2 === 0 ? first.id : second.id),
        ),
      );
      const defaults = (await adapter.accounts.list({ tenantId })).filter((a) => a.isDefault);
      expect(defaults).toHaveLength(1);

      const id = crypto.randomUUID();
      await expect(adapter.accounts.setDefault(id)).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "account",
        id,
      });
    });

    it("update applies only the given fields and can clear the default", async () => {
      const adapter = await fresh();
      const account = await seedAccount(adapter, {
        tenantId: makeTenantId(),
        label: "Recepción",
        isDefault: true,
      });
      const billingCheckedAt = new Date("2026-05-01T10:00:00.000Z");

      const updated = await adapter.accounts.update(account.id, {
        agentPaused: true,
        agentMode: "draft",
        billingReady: true,
        billingCheckedAt,
        coexistence: true,
        tokenRef: "SENDO_TOKEN_NEW",
      });
      expect(updated).toEqual({
        ...account,
        agentPaused: true,
        agentMode: "draft",
        billingReady: true,
        billingCheckedAt,
        coexistence: true,
        tokenRef: "SENDO_TOKEN_NEW",
      });
      expect(await adapter.accounts.getById(account.id)).toEqual(updated);

      const cleared = await adapter.accounts.update(account.id, {
        label: null,
        agentMode: null,
        active: false,
        isDefault: false,
      });
      expect(cleared).toMatchObject({
        label: null,
        agentMode: null,
        active: false,
        isDefault: false,
      });
      expect(await adapter.accounts.update(account.id, {})).toEqual(cleared);

      const id = crypto.randomUUID();
      await expect(adapter.accounts.update(id, { label: "x" })).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "account",
        id,
      });
    });

    it("reactivate reconnects an inactive account keeping its id and data", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const { account, conversation } = await seedConversation(adapter, { tenantId });
      await adapter.accounts.update(account.id, { label: "Recepción" });
      await adapter.accounts.update(account.id, { active: false });
      const phoneNumberId = account.phoneNumberId ?? "";

      const reactivated = await adapter.accounts.reactivate(phoneNumberId, {
        tenantId,
        phoneNumberId,
        wabaId: account.wabaId,
        displayPhone: "+502 5555 9999",
        tokenRef: "vault:new-secret",
        onboardedVia: "embedded_signup",
        coexistence: true,
      });
      expect(reactivated).toMatchObject({
        id: account.id,
        tenantId,
        active: true,
        label: "Recepción",
        displayPhone: "+502 5555 9999",
        tokenRef: "vault:new-secret",
        onboardedVia: "embedded_signup",
        coexistence: true,
        isDefault: false,
      });
      expect(reactivated.createdAt).toEqual(account.createdAt);
      expect(await adapter.accounts.getById(account.id)).toEqual(reactivated);
      expect((await adapter.conversations.get(conversation.id))?.accountId).toBe(account.id);
    });

    it("reactivate refuses active accounts, other tenants and unknown numbers", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const input = makeAccountInput({ tenantId });
      const account = await adapter.accounts.insert(input);

      await expect(adapter.accounts.reactivate(input.phoneNumberId, input)).rejects.toMatchObject({
        ...DUPLICATE_ACCOUNT,
        phoneNumberId: input.phoneNumberId,
      });
      await adapter.accounts.update(account.id, { active: false });
      await expect(
        adapter.accounts.reactivate(input.phoneNumberId, { ...input, tenantId: makeTenantId() }),
      ).rejects.toMatchObject(DUPLICATE_ACCOUNT);
      expect((await adapter.accounts.getById(account.id))?.active).toBe(false);

      const unknown = `pn${digits(12)}`;
      await expect(
        adapter.accounts.reactivate(unknown, makeAccountInput({ phoneNumberId: unknown })),
      ).rejects.toMatchObject(NOT_FOUND);
    });

    it("purge refuses an active account and deletes nothing", async () => {
      const adapter = await fresh();
      const { account, conversation } = await seedConversation(adapter, {
        tenantId: makeTenantId(),
      });
      await expect(adapter.accounts.purge(account.id)).rejects.toMatchObject({
        ...ACCOUNT_ACTIVE,
        accountId: account.id,
      });
      expect(await adapter.accounts.getById(account.id)).not.toBeNull();
      expect(await adapter.conversations.get(conversation.id)).not.toBeNull();

      const id = crypto.randomUUID();
      await expect(adapter.accounts.purge(id)).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "account",
        id,
      });
    });

    it("purge deletes an inactive account with everything under it and returns the media paths", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const { account, contact, conversation } = await seedConversation(adapter, { tenantId });
      const kept = await seedConversation(adapter, { tenantId });
      const message = await adapter.messages.insertInbound(
        makeInbound(conversation, { type: "image", content: { id: "img-1" } }),
      );
      const second = await adapter.messages.insertInbound(
        makeInbound(conversation, { type: "document", content: { id: "doc-1" } }),
      );
      if (!message || !second) throw new Error("expected messages");
      const path = `${tenantId}/${account.id}/${conversation.id}/img-1.jpg`;
      await adapter.media.insert({ tenantId, messageId: message.id, storagePath: path });
      await adapter.media.insert({ tenantId, messageId: second.id });
      await adapter.templates.upsertMany(account.id, [makeTemplateInput()]);
      await adapter.accounts.update(account.id, { active: false });

      expect(await adapter.accounts.purge(account.id)).toEqual({ storagePaths: [path] });

      expect(await adapter.accounts.getById(account.id)).toBeNull();
      expect(await adapter.contacts.get(contact.id)).toBeNull();
      expect(await adapter.conversations.get(conversation.id)).toBeNull();
      expect(await adapter.messages.get(message.id)).toBeNull();
      expect(await adapter.templates.list({ accountId: account.id })).toEqual([]);
      expect(await adapter.accounts.getById(kept.account.id)).not.toBeNull();
      expect(await adapter.conversations.get(kept.conversation.id)).not.toBeNull();
    });
  });
}
