import { describe, expect, it } from "vitest";
import {
  type Fresh,
  NOT_FOUND,
  makePhone,
  makeTenantId,
  seedAccount,
  seedContact,
  violates,
} from "./helpers";

/** Contract for `contacts`. */
export function contactsContract(fresh: Fresh): void {
  describe("contacts", () => {
    it("creates a contact on first upsert", async () => {
      const adapter = await fresh();
      const account = await seedAccount(adapter, { tenantId: makeTenantId() });
      const phone = makePhone();
      const result = await adapter.contacts.upsert({
        accountId: account.id,
        tenantId: account.tenantId,
        phone,
        waId: phone.slice(1),
        profileName: "Ana",
      });

      expect(result.created).toBe(true);
      expect(result.profileChanged).toBe(false);
      expect(result.contact).toMatchObject({
        accountId: account.id,
        tenantId: account.tenantId,
        phone,
        waId: phone.slice(1),
        profileName: "Ana",
        appRef: null,
        marketingOptIn: false,
        optInAt: null,
        channel: "whatsapp",
        channelUserId: null,
      });
      expect(await adapter.contacts.get(result.contact.id)).toEqual(result.contact);
    });

    it("reuses the contact per (account, phone) and reports profile changes", async () => {
      const adapter = await fresh();
      const account = await seedAccount(adapter);
      const phone = makePhone();
      const base = { accountId: account.id, tenantId: account.tenantId, phone };
      const first = await adapter.contacts.upsert({
        ...base,
        waId: "502111",
        profileName: "Ana",
      });

      const same = await adapter.contacts.upsert({ ...base, profileName: "Ana" });
      expect(same).toMatchObject({ created: false, profileChanged: false });
      expect(same.contact.id).toBe(first.contact.id);

      const renamed = await adapter.contacts.upsert({ ...base, profileName: "Ana María" });
      expect(renamed).toMatchObject({ created: false, profileChanged: true });
      expect(renamed.contact.profileName).toBe("Ana María");

      const kept = await adapter.contacts.upsert({ ...base, waId: null, profileName: null });
      expect(kept).toMatchObject({ created: false, profileChanged: false });
      expect(kept.contact).toMatchObject({ waId: "502111", profileName: "Ana María" });
    });

    it("keeps one contact per account for the same phone", async () => {
      const adapter = await fresh();
      const phone = makePhone();
      const a = await seedAccount(adapter);
      const b = await seedAccount(adapter);
      const onA = await adapter.contacts.upsert({ accountId: a.id, tenantId: null, phone });
      const onB = await adapter.contacts.upsert({ accountId: b.id, tenantId: null, phone });

      expect(onA.created).toBe(true);
      expect(onB.created).toBe(true);
      expect(onA.contact.id).not.toBe(onB.contact.id);
      expect(onB.contact.accountId).toBe(b.id);
    });

    it("identifies a contact by channelUserId when it has no phone", async () => {
      const adapter = await fresh();
      const account = await seedAccount(adapter);
      const base = { accountId: account.id, tenantId: account.tenantId };
      const first = await adapter.contacts.upsert({ ...base, channelUserId: "igsid-1" });
      expect(first).toMatchObject({ created: true, profileChanged: false });
      expect(first.contact).toMatchObject({ phone: null, channelUserId: "igsid-1" });

      const again = await adapter.contacts.upsert({
        ...base,
        channelUserId: "igsid-1",
        profileName: "Ana",
      });
      expect(again).toMatchObject({ created: false, profileChanged: true });
      expect(again.contact.id).toBe(first.contact.id);
      expect(await adapter.contacts.get(first.contact.id)).toMatchObject({
        phone: null,
        channelUserId: "igsid-1",
        profileName: "Ana",
      });
    });

    it("keys on the phone when both identities are given", async () => {
      const adapter = await fresh();
      const account = await seedAccount(adapter);
      const base = { accountId: account.id, tenantId: account.tenantId };
      const phone = makePhone();
      const byPhone = await adapter.contacts.upsert({ ...base, phone });

      const linked = await adapter.contacts.upsert({ ...base, phone, channelUserId: "bsuid-7" });
      expect(linked).toMatchObject({ created: false });
      expect(linked.contact).toMatchObject({
        id: byPhone.contact.id,
        phone,
        channelUserId: "bsuid-7",
      });

      const byUserId = await adapter.contacts.upsert({ ...base, channelUserId: "bsuid-7" });
      expect(byUserId).toMatchObject({ created: false });
      expect(byUserId.contact.id).toBe(byPhone.contact.id);
    });

    it("rejects a contact without phone and channelUserId", async () => {
      const adapter = await fresh();
      const account = await seedAccount(adapter);
      const base = { accountId: account.id, tenantId: account.tenantId };
      await expect(adapter.contacts.upsert(base)).rejects.toMatchObject(
        violates("sendo_contacts_identity"),
      );
      await expect(
        adapter.contacts.upsert({ ...base, phone: null, channelUserId: null }),
      ).rejects.toMatchObject(violates("sendo_contacts_identity"));
    });

    it("keeps channelUserId unique per account", async () => {
      const adapter = await fresh();
      const account = await seedAccount(adapter);
      const other = await seedAccount(adapter);
      const base = { accountId: account.id, tenantId: account.tenantId };
      const owner = await adapter.contacts.upsert({
        ...base,
        phone: makePhone(),
        channelUserId: "igsid-9",
      });

      const taken = violates("sendo_contacts_account_id_channel_user_id_key");
      await expect(
        adapter.contacts.upsert({ ...base, phone: makePhone(), channelUserId: "igsid-9" }),
      ).rejects.toMatchObject(taken);
      const second = await adapter.contacts.upsert({ ...base, phone: makePhone() });
      await expect(
        adapter.contacts.upsert({ ...base, phone: second.contact.phone, channelUserId: "igsid-9" }),
      ).rejects.toMatchObject(taken);
      expect((await adapter.contacts.get(second.contact.id))?.channelUserId).toBeNull();

      const elsewhere = await adapter.contacts.upsert({
        accountId: other.id,
        tenantId: other.tenantId,
        channelUserId: "igsid-9",
      });
      expect(elsewhere.created).toBe(true);
      expect(elsewhere.contact.id).not.toBe(owner.contact.id);
    });

    it("sets and clears appRef", async () => {
      const adapter = await fresh();
      const contact = await seedContact(adapter, await seedAccount(adapter));
      expect((await adapter.contacts.setAppRef(contact.id, "patient-42")).appRef).toBe(
        "patient-42",
      );
      expect((await adapter.contacts.get(contact.id))?.appRef).toBe("patient-42");
      expect((await adapter.contacts.setAppRef(contact.id, null)).appRef).toBeNull();
    });

    it("finds a contact by (account, phone) without creating one", async () => {
      const adapter = await fresh();
      const account = await seedAccount(adapter);
      const other = await seedAccount(adapter, { tenantId: account.tenantId });
      const contact = await seedContact(adapter, account);
      const phone = contact.phone ?? "";
      expect(await adapter.contacts.getByPhone(account.id, phone)).toEqual(contact);
      expect(await adapter.contacts.getByPhone(other.id, phone)).toBeNull();
      expect(await adapter.contacts.getByPhone(account.id, makePhone())).toBeNull();
    });

    it("sets and clears the marketing opt-in with its timestamp", async () => {
      const adapter = await fresh();
      const contact = await seedContact(adapter, await seedAccount(adapter));
      const at = new Date("2026-10-09T15:00:00.000Z");
      const optedIn = await adapter.contacts.setOptIn(contact.id, {
        marketingOptIn: true,
        optInAt: at,
      });
      expect(optedIn).toMatchObject({ marketingOptIn: true, optInAt: at });
      expect(await adapter.contacts.get(contact.id)).toEqual(optedIn);
      const later = new Date("2026-10-10T15:00:00.000Z");
      expect(
        await adapter.contacts.setOptIn(contact.id, { marketingOptIn: false, optInAt: later }),
      ).toMatchObject({ marketingOptIn: false, optInAt: later });
      expect(
        await adapter.contacts.setOptIn(contact.id, { marketingOptIn: false, optInAt: null }),
      ).toMatchObject({ marketingOptIn: false, optInAt: null });
    });

    it("returns null or throws RecordNotFoundError for unknown contacts", async () => {
      const adapter = await fresh();
      const id = crypto.randomUUID();
      expect(await adapter.contacts.get(id)).toBeNull();
      await expect(adapter.contacts.setAppRef(id, "x")).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "contact",
        id,
      });
      await expect(
        adapter.contacts.setOptIn(id, { marketingOptIn: true, optInAt: new Date() }),
      ).rejects.toMatchObject({ ...NOT_FOUND, entity: "contact", id });
    });
  });
}
