import { describe, expect, it } from "vitest";
import type { Account } from "../types/entities";
import { accountInput, makeClient, openConversation } from "../core/test-utils";

type Client = ReturnType<typeof makeClient>;

async function setup() {
  const client = makeClient();
  const accountA = await client.adapter.accounts.insert(accountInput());
  const accountB = await client.adapter.accounts.insert(
    accountInput({ tenantId: "tenant-b", phoneNumberId: "PN_B", tokenRef: "SENDO_TOKEN_B" }),
  );
  return { ...client, accountA, accountB };
}

async function seedConversation(
  client: Client,
  account: Account,
  opts: { phone: string; minutesAgo?: number; activityMinutesAgo?: number; profileName?: string },
) {
  const { contact, conversation } = await openConversation(
    client.ctx,
    account,
    opts.phone,
    opts.minutesAgo ?? 1,
  );
  if (opts.profileName !== undefined) {
    await client.adapter.contacts.upsert({
      accountId: account.id,
      tenantId: account.tenantId,
      phone: contact.phone,
      profileName: opts.profileName,
    });
  }
  const updated = await client.adapter.conversations.update(conversation.id, {
    lastActivityAt: new Date(Date.now() - (opts.activityMinutesAgo ?? 0) * 60_000),
  });
  return { contact, conversation: updated };
}

describe("sendo.inbox.list", () => {
  it("never returns another tenant's conversations", async () => {
    const client = await setup();
    const a = await seedConversation(client, client.accountA, { phone: "+50255550001" });
    const b = await seedConversation(client, client.accountB, { phone: "+50255550001" });

    const listA = await client.sendo.inbox.list({ tenantId: "tenant-a" });
    const listB = await client.sendo.inbox.list({ tenantId: "tenant-b" });
    const listNone = await client.sendo.inbox.list({ tenantId: null });

    expect(listA.items.map((c) => c.id)).toEqual([a.conversation.id]);
    expect(listB.items.map((c) => c.id)).toEqual([b.conversation.id]);
    expect(listNone.items).toEqual([]);
  });
});
