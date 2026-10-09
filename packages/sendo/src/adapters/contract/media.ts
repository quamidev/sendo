import { describe, expect, it } from "vitest";
import { type Fresh, NOT_FOUND, makeTenantId, seedConversation, makeInbound } from "./helpers";

/** Contract for `media`. */
export function mediaContract(fresh: Fresh): void {
  describe("media", () => {
    it("inserts with defaults and updates", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter, { tenantId: makeTenantId() });
      const message = await adapter.messages.insertInbound(
        makeInbound(conversation, { type: "document", content: { id: "doc-1" } }),
      );
      if (!message) throw new Error("expected a message");

      const media = await adapter.media.insert({
        tenantId: conversation.tenantId,
        messageId: message.id,
        metaMediaId: "doc-1",
      });
      expect(media).toMatchObject({
        tenantId: conversation.tenantId,
        messageId: message.id,
        metaMediaId: "doc-1",
        mimeType: null,
        sizeBytes: null,
        sha256: null,
        storagePath: null,
        downloadStatus: "pending",
      });

      const updated = await adapter.media.update(media.id, {
        mimeType: "application/pdf",
        sizeBytes: 2048,
        sha256: "abc123",
        storagePath: "t/a/c/doc-1.pdf",
        downloadStatus: "done",
      });
      expect(updated).toEqual({
        ...media,
        mimeType: "application/pdf",
        sizeBytes: 2048,
        sha256: "abc123",
        storagePath: "t/a/c/doc-1.pdf",
        downloadStatus: "done",
      });
      expect((await adapter.messages.get(message.id))?.media).toEqual(updated);

      const failed = await adapter.media.update(media.id, { downloadStatus: "failed" });
      expect(failed).toMatchObject({ downloadStatus: "failed", mimeType: "application/pdf" });
    });

    it("throws RecordNotFoundError for unknown media", async () => {
      const adapter = await fresh();
      const id = crypto.randomUUID();
      await expect(adapter.media.update(id, { downloadStatus: "done" })).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "media",
        id,
      });
    });
  });
}
