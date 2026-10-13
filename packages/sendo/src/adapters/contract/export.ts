import { describe, expect, it } from "vitest";
import {
  exportAccount,
  type AccountExportOptions,
  type SendoExportDocumentV1,
} from "../../core/accounts/export";
import type { Account, Conversation } from "../../types/entities";
import type { SendoAdapter } from "../types";
import {
  type Fresh,
  HOUR_MS,
  makeInbound,
  makeOutbound,
  makePhone,
  makeTenantId,
  seedAccount,
  seedContact,
  tick,
} from "./helpers";

const DAY_MS = 24 * HOUR_MS;
const at = (day: number): Date => new Date(Date.UTC(2026, 4, day, 12));

/** Every chunk of `exportAccount`, joined and parsed. */
async function exportDocument(
  adapter: SendoAdapter,
  account: Account,
  options: AccountExportOptions = {},
): Promise<SendoExportDocumentV1> {
  let text = "";
  const deps = { adapter, media: adapter.storage ?? null, logger: { warn: () => undefined } };
  for await (const chunk of exportAccount(deps, account.id, options)) text += chunk;
  return JSON.parse(text) as SendoExportDocumentV1;
}

async function conversationOn(
  adapter: SendoAdapter,
  account: Account,
  lastActivityAt: Date,
): Promise<Conversation> {
  const contact = await seedContact(adapter, account, makePhone());
  const { conversation } = await adapter.conversations.getOpenOrCreate({
    contactId: contact.id,
    accountId: account.id,
    tenantId: account.tenantId,
  });
  return adapter.conversations.update(conversation.id, { lastActivityAt });
}

/**
 * Contract for the account export (`sendo.accounts.export`, `sendo accounts export`): it is built
 * only from adapter reads, so every adapter must page, filter and join them the same way.
 */
export function exportContract(fresh: Fresh): void {
  describe("account export", () => {
    it("exports a disconnected number as one v1 document: paged threads, notes, system lines, drafts, tags and media", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const account = await seedAccount(adapter, { tenantId, label: "Torre Vista" });
      const other = await seedAccount(adapter, { tenantId });
      await conversationOn(adapter, other, at(9));
      const vip = await adapter.tags.upsert({ tenantId, name: "VIP", color: "violet" });
      const unused = await adapter.tags.upsert({ tenantId, name: "Unused", color: "gray" });

      const main = await conversationOn(adapter, account, at(3));
      const second = await conversationOn(adapter, account, at(2));
      const third = await conversationOn(adapter, account, at(1));
      const inbound = await adapter.messages.insertInbound(
        makeInbound(main, { type: "image", content: { id: "img-1" }, text: null }),
      );
      if (!inbound) throw new Error("expected an inbound message");
      const path = `${tenantId}/${account.id}/${main.id}/img-1.jpg`;
      await adapter.storage?.put(path, new Uint8Array([1, 2, 3]), "image/jpeg");
      const image = await adapter.media.insert({
        tenantId,
        messageId: inbound.id,
        metaMediaId: "img-1",
        mimeType: "image/jpeg",
        storagePath: path,
        downloadStatus: "done",
      });
      await tick();
      const lost = await adapter.messages.insertInbound(
        makeInbound(main, { type: "document", content: { id: "doc-1" }, text: null }),
      );
      if (!lost) throw new Error("expected an inbound message");
      const failed = await adapter.media.insert({
        tenantId,
        messageId: lost.id,
        metaMediaId: "doc-1",
        downloadStatus: "failed",
      });
      await tick();
      const reply = await adapter.messages.insertOutbound(makeOutbound(main));
      await tick();
      const note = await adapter.messages.insertOutbound(
        makeOutbound(main, {
          sender: "human",
          senderRef: "user-1",
          internal: true,
          status: "sent",
          text: "Called the resident",
          content: { body: "Called the resident" },
        }),
      );
      await tick();
      const assigned = await adapter.messages.insertOutbound(
        makeOutbound(main, {
          sender: "system",
          senderRef: null,
          internal: true,
          status: "sent",
          text: "Ana assigned the conversation to Sofia",
          content: { body: "Ana assigned the conversation to Sofia" },
          metadata: { kind: "system", event: "assigned", by: "user-1", assignedTo: "user-2" },
        }),
      );
      await tick();
      const closed = await adapter.messages.insertOutbound(
        makeOutbound(main, {
          sender: "system",
          senderRef: null,
          internal: true,
          status: "sent",
          text: "Sofia closed the conversation",
          content: { body: "Sofia closed the conversation" },
          metadata: { kind: "system", event: "closed", by: "user-2" },
        }),
      );
      await tick();
      const draft = await adapter.messages.insertOutbound(makeOutbound(main, { draft: true }));
      await adapter.tags.addToConversation(main.id, vip.id);
      await adapter.conversations.update(main.id, { status: "closed", assignedTo: "user-2" });
      await adapter.messages.insertInbound(makeInbound(second));
      await adapter.accounts.update(account.id, { active: false });

      const doc = await exportDocument(adapter, account, {
        at: new Date(Date.now() + HOUR_MS),
        pageSize: { conversations: 2, messages: 2 },
      });
      expect(doc).toMatchObject({
        format: "sendo-export",
        version: 1,
        account: {
          id: account.id,
          tenantId,
          phoneNumberId: account.phoneNumberId,
          wabaId: account.wabaId,
          displayPhone: account.displayPhone,
          label: "Torre Vista",
          active: false,
          onboardedVia: "manual",
          createdAt: account.createdAt.toISOString(),
        },
      });
      expect(typeof doc.sendoVersion).toBe("string");
      expect(doc.contacts.map((c) => c.id).sort()).toEqual(
        [main.contactId, second.contactId, third.contactId].sort(),
      );
      expect(doc.contacts[0]).toEqual({
        id: expect.any(String) as string,
        waId: expect.any(String) as string,
        profileName: "Ana López",
        appRef: null,
        optIn: { marketing: false, at: null },
      });
      expect(doc.tags).toEqual([
        { id: unused.id, name: "Unused", color: "gray" },
        { id: vip.id, name: "VIP", color: "violet" },
      ]);
      expect(doc.conversations.map((c) => c.id)).toEqual([main.id, second.id, third.id]);

      const [exported] = doc.conversations;
      expect(exported).toMatchObject({
        id: main.id,
        contactId: main.contactId,
        status: "closed",
        assignedTo: "user-2",
        tagIds: [vip.id],
        createdAt: main.createdAt.toISOString(),
        closedAt: closed.createdAt.toISOString(),
      });
      const messages = exported?.messages ?? [];
      expect(messages.map((m) => m.id)).toEqual([
        draft.id,
        closed.id,
        assigned.id,
        note.id,
        reply.id,
        lost.id,
        inbound.id,
      ]);
      expect(messages[0]).toMatchObject({ draft: true, sender: "agent", media: [] });
      expect(messages[2]).toMatchObject({
        internal: true,
        sender: "system",
        metadata: { kind: "system", event: "assigned", by: "user-1", assignedTo: "user-2" },
      });
      expect(messages[3]).toEqual({
        id: note.id,
        direction: "out",
        sender: "human",
        senderRef: "user-1",
        type: "text",
        text: "Called the resident",
        content: { body: "Called the resident" },
        internal: true,
        draft: false,
        status: "sent",
        metadata: {},
        sentAt: note.sentAt?.toISOString() ?? null,
        createdAt: note.createdAt.toISOString(),
        media: [],
      });
      expect(messages[5]?.media).toEqual([
        { id: failed.id, mimeType: null, storageKey: null, url: null, missing: true },
      ]);
      expect(messages[6]).toMatchObject({ direction: "in", sender: "contact", type: "image" });
      expect(messages[6]?.media).toEqual([
        {
          id: image.id,
          mimeType: "image/jpeg",
          storageKey: path,
          url: adapter.storage ? (expect.any(String) as string) : null,
          missing: false,
        },
      ]);
      expect(doc.conversations[1]).toMatchObject({ status: "agent", closedAt: null, tagIds: [] });
      expect(doc.conversations[1]?.messages).toHaveLength(1);
      expect(doc.conversations[2]?.messages).toEqual([]);

      await adapter.storage?.delete([path]);
    });

    it("is a snapshot: rows created after it are left out, a conversation that moves while paging is exported once", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const account = await seedAccount(adapter, { tenantId });
      await adapter.tags.upsert({ tenantId, name: "VIP", color: "violet" });
      const newest = await conversationOn(adapter, account, at(3));
      const middle = await conversationOn(adapter, account, at(2));
      const oldest = await conversationOn(adapter, account, at(1));
      await adapter.messages.insertInbound(makeInbound(oldest));

      const before = await exportDocument(adapter, account, { at: new Date(Date.now() - DAY_MS) });
      expect(before).toMatchObject({ contacts: [], tags: [], conversations: [] });

      const snapshot = new Date(Date.now() + HOUR_MS);
      const deps = { adapter, media: adapter.storage ?? null, logger: { warn: () => undefined } };
      const chunks = exportAccount(deps, account.id, {
        at: snapshot,
        pageSize: { conversations: 1, messages: 1 },
      });
      let text = "";
      let moved = false;
      for await (const chunk of chunks) {
        text += chunk;
        if (!moved && chunk.startsWith('],"closedAt"')) {
          // The first conversation is written; activity now moves the oldest one to the top.
          await adapter.conversations.update(oldest.id, {
            lastActivityAt: new Date(snapshot.getTime() + DAY_MS),
          });
          moved = true;
        }
      }
      const doc = JSON.parse(text) as SendoExportDocumentV1;
      expect(doc.exportedAt).toBe(snapshot.toISOString());
      expect(doc.conversations.map((c) => c.id)).toEqual([newest.id, middle.id, oldest.id]);
      expect(doc.conversations[2]?.messages).toHaveLength(1);
      expect(doc.contacts).toHaveLength(3);
    });
  });
}
