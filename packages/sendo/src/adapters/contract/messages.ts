import { describe, expect, it } from "vitest";
import type { SendoAdapter } from "../types";
import {
  type Fresh,
  NOT_FOUND,
  HOUR_MS,
  tick,
  makeTenantId,
  makeError,
  seedConversation,
  makeInbound,
  makeOutbound,
  makeMetaId,
  violates,
} from "./helpers";

/** Contract for `messages`. */
export function messagesContract(fresh: Fresh): void {
  describe("messages", () => {
    it("inserts inbound messages with fixed direction, status and sender", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter, { tenantId: makeTenantId() });
      const input = makeInbound(conversation, {
        replyToMetaId: "wamid.previous",
        metadata: { source: "webhook" },
      });
      const message = await adapter.messages.insertInbound(input);

      expect(message).toMatchObject({
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        direction: "in",
        type: "text",
        content: { body: "Hola" },
        text: "Hola",
        metaMessageId: input.metaMessageId,
        replyToMetaId: "wamid.previous",
        status: "received",
        error: null,
        sender: "contact",
        senderRef: null,
        metadata: { source: "webhook" },
        sentAt: input.sentAt,
        internal: false,
        draft: false,
        tokensIn: null,
        tokensOut: null,
        costCents: null,
      });
      expect(message?.createdAt).toBeInstanceOf(Date);
    });

    it("returns null for a duplicate inbound metaMessageId and writes nothing", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const input = makeInbound(conversation);
      const first = await adapter.messages.insertInbound(input);
      expect(first).not.toBeNull();
      expect(await adapter.messages.insertInbound({ ...input, text: "otra vez" })).toBeNull();

      const history = await adapter.messages.history(conversation.id, 10);
      expect(history.map((m) => m.id)).toEqual([first?.id]);
      expect(history[0]?.text).toBe("Hola");
    });

    it("inserts outbound messages as pending without a Meta id", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const message = await adapter.messages.insertOutbound(makeOutbound(conversation));
      expect(message).toMatchObject({
        conversationId: conversation.id,
        direction: "out",
        status: "pending",
        metaMessageId: null,
        sender: "agent",
        senderRef: "recepcion",
        error: null,
        replyToMetaId: null,
        metadata: {},
        sentAt: null,
        internal: false,
        draft: false,
        tokensIn: null,
        tokensOut: null,
        costCents: null,
      });
    });

    it("stores internal notes, drafts and model usage on outbound messages", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const note = await adapter.messages.insertOutbound(
        makeOutbound(conversation, { sender: "human", senderRef: "user-1", internal: true }),
      );
      expect(note).toMatchObject({ internal: true, draft: false, status: "pending" });

      const draft = await adapter.messages.insertOutbound(
        makeOutbound(conversation, {
          draft: true,
          tokensIn: 812,
          tokensOut: 64,
          costCents: 0.1234,
        }),
      );
      const usage = {
        internal: false,
        draft: true,
        tokensIn: 812,
        tokensOut: 64,
        costCents: 0.1234,
      };
      expect(draft).toMatchObject(usage);
      expect(await adapter.messages.get(draft.id)).toMatchObject(usage);
      expect((await adapter.messages.get(note.id))?.internal).toBe(true);

      const line = await adapter.messages.insertOutbound(
        makeOutbound(conversation, { sender: "system", internal: true, status: "sent" }),
      );
      expect(line).toMatchObject({ internal: true, status: "sent", metaMessageId: null });
      expect(line.sentAt).toBeInstanceOf(Date);
      expect(await adapter.messages.get(line.id)).toMatchObject({ status: "sent" });
    });

    it("rejects a message that is both internal and a draft", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      await expect(
        adapter.messages.insertOutbound(
          makeOutbound(conversation, { internal: true, draft: true }),
        ),
      ).rejects.toMatchObject(violates("sendo_messages_internal_draft_check"));
      expect(await adapter.messages.history(conversation.id, 10)).toEqual([]);
    });

    it("markSent sets the Meta id, status sent and sentAt", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const pending = await adapter.messages.insertOutbound(makeOutbound(conversation));
      const metaId = makeMetaId();
      const sent = await adapter.messages.markSent(pending.id, metaId);

      expect(sent).toMatchObject({ id: pending.id, metaMessageId: metaId, status: "sent" });
      expect(sent.sentAt).toBeInstanceOf(Date);
      expect((await adapter.messages.getByMetaId(metaId))?.id).toBe(pending.id);
    });

    it("markFailed records the error", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const pending = await adapter.messages.insertOutbound(makeOutbound(conversation));
      const error = makeError();
      const failed = await adapter.messages.markFailed(pending.id, error);
      expect(failed).toMatchObject({ status: "failed", error });
      expect((await adapter.messages.get(pending.id))?.error).toEqual(error);
    });

    it("markSent on a failed message stores the Meta id but keeps failed and its error", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const pending = await adapter.messages.insertOutbound(makeOutbound(conversation));
      const error = makeError();
      await adapter.messages.markFailed(pending.id, error);
      const metaId = makeMetaId();

      const marked = await adapter.messages.markSent(pending.id, metaId);
      expect(marked).toMatchObject({
        id: pending.id,
        metaMessageId: metaId,
        status: "failed",
        error,
      });
      expect(await adapter.messages.getByMetaId(metaId)).toMatchObject({
        id: pending.id,
        status: "failed",
        error,
      });
      expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("ignored");
      expect((await adapter.messages.get(pending.id))?.status).toBe("failed");
    });

    it("throws RecordNotFoundError for writes to unknown messages", async () => {
      const adapter = await fresh();
      const id = crypto.randomUUID();
      const expected = { ...NOT_FOUND, entity: "message", id };
      await expect(adapter.messages.markSent(id, makeMetaId())).rejects.toMatchObject(expected);
      await expect(adapter.messages.markFailed(id, makeError())).rejects.toMatchObject(expected);
      await expect(adapter.messages.updateMetadata(id, { a: 1 })).rejects.toMatchObject(expected);
      expect(await adapter.messages.get(id)).toBeNull();
      expect(await adapter.messages.getByMetaId(makeMetaId())).toBeNull();
    });

    describe("updateStatus", () => {
      const sentMessage = async (adapter: SendoAdapter) => {
        const { conversation } = await seedConversation(adapter);
        const pending = await adapter.messages.insertOutbound(makeOutbound(conversation));
        const metaId = makeMetaId();
        await adapter.messages.markSent(pending.id, metaId);
        return { id: pending.id, metaId };
      };

      it("moves forward and ignores late or backward statuses", async () => {
        const adapter = await fresh();
        const { id, metaId } = await sentMessage(adapter);

        expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("updated");
        expect(await adapter.messages.updateStatus(metaId, "read")).toBe("updated");
        expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("ignored");
        expect(await adapter.messages.updateStatus(metaId, "sent")).toBe("ignored");
        expect(await adapter.messages.updateStatus(metaId, "read")).toBe("ignored");
        expect(await adapter.messages.updateStatus(metaId, "failed")).toBe("ignored");
        expect((await adapter.messages.get(id))?.status).toBe("read");
      });

      it("lets read skip delivered", async () => {
        const adapter = await fresh();
        const { id, metaId } = await sentMessage(adapter);
        expect(await adapter.messages.updateStatus(metaId, "read")).toBe("updated");
        expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("ignored");
        expect((await adapter.messages.get(id))?.status).toBe("read");
      });

      it("records the error on failed and treats failed as final", async () => {
        const adapter = await fresh();
        const { id, metaId } = await sentMessage(adapter);
        const error = makeError({ code: 131026, message: "Message undeliverable" });

        expect(await adapter.messages.updateStatus(metaId, "failed", { error })).toBe("updated");
        expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("ignored");
        expect(await adapter.messages.get(id)).toMatchObject({ status: "failed", error });
      });

      it("ignores status updates for inbound messages", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const inbound = await adapter.messages.insertInbound(makeInbound(conversation));
        const metaId = inbound?.metaMessageId ?? "";
        expect(await adapter.messages.updateStatus(metaId, "read")).toBe("ignored");
        expect((await adapter.messages.getByMetaId(metaId))?.status).toBe("received");
      });

      it("stores a hidden placeholder when no message has the Meta id", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const real = await adapter.messages.insertInbound(makeInbound(conversation));
        const metaId = makeMetaId();

        expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("placeholder");
        expect(await adapter.messages.updateStatus(metaId, "read")).toBe("placeholder");

        expect(await adapter.messages.getByMetaId(metaId)).toBeNull();
        expect((await adapter.messages.history(conversation.id, 50)).map((m) => m.id)).toEqual([
          real?.id,
        ]);
        const thread = await adapter.messages.thread(conversation.id, { limit: 50 });
        expect(thread.items.map((m) => m.id)).toEqual([real?.id]);
        expect(thread.items.every((m) => m.type !== "status_placeholder")).toBe(true);
      });

      it("markSent merges a placeholder into the highest status and removes it", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const metaId = makeMetaId();
        expect(await adapter.messages.updateStatus(metaId, "read")).toBe("placeholder");
        expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("placeholder");

        const pending = await adapter.messages.insertOutbound(makeOutbound(conversation));
        const merged = await adapter.messages.markSent(pending.id, metaId);
        expect(merged).toMatchObject({ id: pending.id, metaMessageId: metaId, status: "read" });

        expect(await adapter.messages.getByMetaId(metaId)).toMatchObject({
          id: pending.id,
          status: "read",
        });
        expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("ignored");
        const history = await adapter.messages.history(conversation.id, 50);
        expect(history.map((m) => m.id)).toEqual([pending.id]);
      });

      it("markSent merges a failed placeholder with its error", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const metaId = makeMetaId();
        const error = makeError();
        expect(await adapter.messages.updateStatus(metaId, "failed", { error })).toBe(
          "placeholder",
        );

        const pending = await adapter.messages.insertOutbound(makeOutbound(conversation));
        const merged = await adapter.messages.markSent(pending.id, metaId);
        expect(merged).toMatchObject({ status: "failed", error });
      });

      it("a placeholder keeps the forward-only rule (failed does not beat delivered)", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const metaId = makeMetaId();
        await adapter.messages.updateStatus(metaId, "delivered");
        await adapter.messages.updateStatus(metaId, "failed", { error: makeError() });

        const pending = await adapter.messages.insertOutbound(makeOutbound(conversation));
        const merged = await adapter.messages.markSent(pending.id, metaId);
        expect(merged).toMatchObject({ status: "delivered", error: null });
      });

      it("markSent without a placeholder for its Meta id leaves other placeholders alone", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const otherMetaId = makeMetaId();
        await adapter.messages.updateStatus(otherMetaId, "read");

        const first = await adapter.messages.insertOutbound(makeOutbound(conversation));
        expect((await adapter.messages.markSent(first.id, makeMetaId())).status).toBe("sent");

        const second = await adapter.messages.insertOutbound(makeOutbound(conversation));
        expect((await adapter.messages.markSent(second.id, otherMetaId)).status).toBe("read");
      });
    });

    it("get and getByMetaId attach media", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const message = await adapter.messages.insertInbound(
        makeInbound(conversation, { type: "image", content: { id: "media-1" }, text: null }),
      );
      if (!message) throw new Error("expected a message");
      expect((await adapter.messages.get(message.id))?.media).toBeNull();

      const media = await adapter.media.insert({
        tenantId: conversation.tenantId,
        messageId: message.id,
        metaMediaId: "media-1",
        mimeType: "image/jpeg",
      });
      expect((await adapter.messages.get(message.id))?.media).toEqual(media);
      expect((await adapter.messages.getByMetaId(message.metaMessageId ?? ""))?.media).toEqual(
        media,
      );
    });

    it("history returns the last N messages oldest first with media", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const other = await seedConversation(adapter);
      await adapter.messages.insertInbound(makeInbound(other.conversation));

      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const m =
          i % 2 === 0
            ? await adapter.messages.insertInbound(makeInbound(conversation, { text: `m${i}` }))
            : await adapter.messages.insertOutbound(makeOutbound(conversation, { text: `m${i}` }));
        if (!m) throw new Error("expected a message");
        ids.push(m.id);
        await tick();
      }
      const lastId = ids[3] ?? "";
      const media = await adapter.media.insert({
        tenantId: conversation.tenantId,
        messageId: lastId,
        mimeType: "audio/ogg",
        downloadStatus: "done",
      });

      const history = await adapter.messages.history(conversation.id, 3);
      expect(history.map((m) => m.id)).toEqual(ids.slice(1));
      expect(history.map((m) => m.text)).toEqual(["m1", "m2", "m3"]);
      expect(history[2]?.media).toEqual(media);
      expect(history[0]?.media).toBeNull();

      expect((await adapter.messages.history(conversation.id, 50)).map((m) => m.id)).toEqual(ids);
      expect(await adapter.messages.history(crypto.randomUUID(), 10)).toEqual([]);
    });

    it("thread pages newest first and nextCursor loads older messages", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const m = await adapter.messages.insertOutbound(
          makeOutbound(conversation, { text: `m${i}` }),
        );
        ids.push(m.id);
        await tick();
      }
      const newestFirst = [...ids].reverse();

      const first = await adapter.messages.thread(conversation.id, { limit: 2 });
      expect(first.items.map((m) => m.id)).toEqual(newestFirst.slice(0, 2));
      expect(first.items[0]).toHaveProperty("media", null);
      expect(first.nextCursor).not.toBeNull();

      const second = await adapter.messages.thread(conversation.id, {
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(second.items.map((m) => m.id)).toEqual(newestFirst.slice(2, 4));
      expect(second.nextCursor).not.toBeNull();

      const third = await adapter.messages.thread(conversation.id, {
        limit: 2,
        cursor: second.nextCursor,
      });
      expect(third.items.map((m) => m.id)).toEqual(newestFirst.slice(4));
      expect(third.nextCursor).toBeNull();

      const all = await adapter.messages.thread(conversation.id, { limit: 5, cursor: null });
      expect(all.items).toHaveLength(5);
      expect(all.nextCursor).toBeNull();

      const empty = await adapter.messages.thread(crypto.randomUUID(), { limit: 5 });
      expect(empty).toEqual({ items: [], nextCursor: null });
    });

    it("countInboundSince counts the contact's inbound messages only", async () => {
      const adapter = await fresh();
      const { contact, conversation } = await seedConversation(adapter);
      const other = await seedConversation(adapter);
      const before = new Date(Date.now() - HOUR_MS);

      await adapter.messages.insertInbound(makeInbound(conversation));
      await adapter.messages.insertInbound(makeInbound(conversation));
      await adapter.messages.insertOutbound(makeOutbound(conversation));
      await adapter.messages.insertInbound(makeInbound(other.conversation));
      await adapter.messages.updateStatus(makeMetaId(), "read");

      expect(await adapter.messages.countInboundSince(contact.id, before)).toBe(2);
      expect(
        await adapter.messages.countInboundSince(contact.id, new Date(Date.now() + HOUR_MS)),
      ).toBe(0);
      expect(await adapter.messages.countInboundSince(other.contact.id, before)).toBe(1);
    });

    it("updateMetadata shallow-merges", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const message = await adapter.messages.insertOutbound(
        makeOutbound(conversation, { metadata: { a: 1, nested: { x: 1 } } }),
      );
      const updated = await adapter.messages.updateMetadata(message.id, {
        b: 2,
        nested: { y: 2 },
      });
      expect(updated.metadata).toEqual({ a: 1, b: 2, nested: { y: 2 } });
      expect((await adapter.messages.get(message.id))?.metadata).toEqual(updated.metadata);
    });

    it("update approves a draft: text, content, draft flag and merged metadata", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const draft = await adapter.messages.insertOutbound(
        makeOutbound(conversation, { draft: true, metadata: { turn: 3 }, tokensIn: 12 }),
      );

      const approved = await adapter.messages.update(draft.id, {
        draft: false,
        text: "Buenas tardes, Ana",
        content: { body: "Buenas tardes, Ana" },
        metadata: { approvedBy: "user-luis", edited: true },
      });
      expect(approved).toMatchObject({
        id: draft.id,
        draft: false,
        text: "Buenas tardes, Ana",
        content: { body: "Buenas tardes, Ana" },
        metadata: { turn: 3, approvedBy: "user-luis", edited: true },
        sender: "agent",
        status: "pending",
        tokensIn: 12,
      });
      expect(await adapter.messages.get(draft.id)).toMatchObject({
        draft: false,
        text: "Buenas tardes, Ana",
        metadata: { turn: 3, approvedBy: "user-luis", edited: true },
      });

      const metadataOnly = await adapter.messages.update(draft.id, { metadata: { sent: 1 } });
      expect(metadataOnly).toMatchObject({ text: "Buenas tardes, Ana", metadata: { sent: 1 } });
      expect(await adapter.messages.update(draft.id, {})).toMatchObject({ id: draft.id });
    });

    it("update refuses a draft internal note and unknown ids", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const note = await adapter.messages.insertOutbound(
        makeOutbound(conversation, { sender: "human", internal: true }),
      );
      await expect(adapter.messages.update(note.id, { draft: true })).rejects.toMatchObject(
        violates("sendo_messages_internal_draft_check"),
      );
      expect((await adapter.messages.get(note.id))?.draft).toBe(false);

      const id = crypto.randomUUID();
      await expect(adapter.messages.update(id, { text: "x" })).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "message",
        id,
      });
      await expect(adapter.messages.update(id, { metadata: { a: 1 } })).rejects.toMatchObject(
        NOT_FOUND,
      );
      await expect(adapter.messages.update(id, {})).rejects.toMatchObject(NOT_FOUND);
    });

    it("deleteDrafts removes only the conversation's pending drafts", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const other = await seedConversation(adapter);
      const kept = await adapter.messages.insertOutbound(makeOutbound(conversation));
      await adapter.messages.insertOutbound(makeOutbound(conversation, { draft: true }));
      await adapter.messages.insertOutbound(makeOutbound(conversation, { draft: true }));
      const otherDraft = await adapter.messages.insertOutbound(
        makeOutbound(other.conversation, { draft: true }),
      );

      expect(await adapter.messages.deleteDrafts(conversation.id)).toBe(2);
      expect((await adapter.messages.history(conversation.id, 10)).map((m) => m.id)).toEqual([
        kept.id,
      ]);
      expect(await adapter.messages.get(otherDraft.id)).not.toBeNull();
      expect(await adapter.messages.deleteDrafts(conversation.id)).toBe(0);
      expect(await adapter.messages.deleteDrafts(crypto.randomUUID())).toBe(0);
    });
  });
}
