import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { WA_TABLES } from "../types";
import { decodeCursor } from "./adapter";
import { SupabaseAdapterError, supabaseAdapter } from ".";
import type { MediaRow, MessageWithMediaRow } from "./rows";
import { toMessageWithMedia } from "./rows";

interface Call {
  target: string;
  method: string;
  args: unknown[];
}

interface FakeResult {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

type Responder = (target: string, calls: Call[]) => FakeResult;

/**
 * Minimal stand-in for `SupabaseClient`: every builder method is chainable and
 * awaiting the chain resolves to whatever `respond` returns for that table/RPC/bucket.
 */
function fakeClient(respond: Responder): { client: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const chain = (target: string): object => {
    const own: Call[] = [];
    const proxy: object = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            const result = respond(target, own);
            return (onFulfilled: (value: FakeResult) => unknown) =>
              Promise.resolve({ data: null, error: null, count: null, ...result }).then(
                onFulfilled,
              );
          }
          return (...args: unknown[]) => {
            const call = { target, method: String(prop), args };
            own.push(call);
            calls.push(call);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  const client = {
    from: (table: string) => chain(`table:${table}`),
    rpc: (fn: string, params: unknown) => {
      const c = chain(`rpc:${fn}`);
      calls.push({ target: `rpc:${fn}`, method: "rpc", args: [params] });
      return c;
    },
    storage: {
      from: (bucket: string) => chain(`bucket:${bucket}`),
      getBucket: (bucket: string) => chain(`getBucket:${bucket}`),
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const adapterWith = (respond: Responder) => {
  const { client, calls } = fakeClient(respond);
  return { adapter: supabaseAdapter(client, { storageBucket: "whatsapp-media" }), calls };
};

const UUID = "7f1c2a4e-0d1b-4b8e-9a51-3c1f0e2d4a5b";

const mediaRow = (overrides: Partial<MediaRow> = {}): MediaRow => ({
  id: "b7a0c1d2-0000-4000-8000-000000000001",
  tenant_id: null,
  message_id: UUID,
  meta_media_id: "m-1",
  mime_type: "image/jpeg",
  size_bytes: "2048",
  sha256: null,
  storage_path: null,
  download_status: "done",
  ...overrides,
});

const messageRow = (overrides: Partial<MessageWithMediaRow> = {}): MessageWithMediaRow => ({
  id: UUID,
  tenant_id: "a3b0c1d2-0000-4000-8000-0000000000aa",
  conversation_id: "c3b0c1d2-0000-4000-8000-0000000000cc",
  direction: "out",
  type: "text",
  content: { body: "Hola" },
  text: "Hola",
  meta_message_id: "wamid.1",
  reply_to_meta_id: null,
  status: "sent",
  error: null,
  sender: "agent",
  sender_ref: "recepcion",
  metadata: { a: 1 },
  sent_at: "2026-10-06T12:00:00.123456+00:00",
  created_at: "2026-10-06T11:59:59+00:00",
  ...overrides,
});

describe("row mapping", () => {
  it("maps snake_case rows to camelCase entities with Date timestamps", () => {
    const message = toMessageWithMedia(messageRow({ wa_media: [mediaRow()] }));
    expect(message).toMatchObject({
      id: UUID,
      conversationId: "c3b0c1d2-0000-4000-8000-0000000000cc",
      metaMessageId: "wamid.1",
      senderRef: "recepcion",
      metadata: { a: 1 },
      media: { messageId: UUID, mimeType: "image/jpeg", sizeBytes: 2048, downloadStatus: "done" },
    });
    expect(message.sentAt).toEqual(new Date("2026-10-06T12:00:00.123Z"));
    expect(message.createdAt).toBeInstanceOf(Date);
    expect(message).not.toHaveProperty("wa_media");
  });

  it("treats empty or missing embedded media as null", () => {
    expect(toMessageWithMedia(messageRow({ wa_media: [] })).media).toBeNull();
    expect(toMessageWithMedia(messageRow({ wa_media: null })).media).toBeNull();
    expect(toMessageWithMedia(messageRow({ wa_media: mediaRow() })).media?.sizeBytes).toBe(2048);
  });
});

describe("error mapping", () => {
  it("maps the phone_number_id unique violation to DuplicateAccountError", async () => {
    const { adapter } = adapterWith(() => ({
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "wa_accounts_phone_number_id_key"',
        details: "Key (phone_number_id)=(pn1) already exists.",
        hint: null,
      },
    }));
    await expect(
      adapter.accounts.insert({
        phoneNumberId: "pn1",
        wabaId: "w",
        displayPhone: "+1",
        tokenRef: "T",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_EXISTS", phoneNumberId: "pn1" });
  });

  it("wraps other database errors in SupabaseAdapterError", async () => {
    const { adapter } = adapterWith(() => ({
      error: { code: "23503", message: "violates foreign key constraint", details: "", hint: "" },
    }));
    const error = await adapter.media
      .insert({ tenantId: null, messageId: UUID })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SupabaseAdapterError);
    expect(error).toMatchObject({ code: "23503", operation: "media.insert" });
  });

  it("throws RecordNotFoundError when an update matches no row or the id is malformed", async () => {
    const { adapter } = adapterWith((target) =>
      target === "table:wa_contacts"
        ? { data: null }
        : { error: { code: "22P02", message: "invalid input syntax for type uuid" } },
    );
    await expect(adapter.contacts.setAppRef(UUID, "x")).rejects.toMatchObject({
      code: "RECORD_NOT_FOUND",
      entity: "contact",
      id: UUID,
    });
    await expect(adapter.events.setStatus("not-a-uuid", "processed")).rejects.toMatchObject({
      code: "RECORD_NOT_FOUND",
      entity: "event",
    });
    expect(await adapter.events.get("not-a-uuid")).toBeNull();
  });

  it("throws RecordNotFoundError when markSent's RPC returns no row", async () => {
    const { adapter, calls } = adapterWith(() => ({ data: [] }));
    await expect(adapter.messages.markSent(UUID, "wamid.9")).rejects.toMatchObject({
      code: "RECORD_NOT_FOUND",
      entity: "message",
    });
    expect(calls[0]).toMatchObject({
      target: "rpc:wa_mark_sent",
      args: [{ message_id: UUID, meta_message_id: "wamid.9" }],
    });
  });
});

describe("rpc calls", () => {
  it("updateStatus sends the status, error and timestamp to wa_update_message_status", async () => {
    const { adapter, calls } = adapterWith(() => ({ data: "placeholder" }));
    const at = new Date("2026-10-06T12:00:00.000Z");
    const error = { code: 131026, message: "undeliverable" };
    expect(await adapter.messages.updateStatus("wamid.1", "failed", { error, at })).toBe(
      "placeholder",
    );
    expect(calls[0]?.args[0]).toEqual({
      meta_message_id: "wamid.1",
      status: "failed",
      error,
      at: at.toISOString(),
    });
  });

  it("rejects an unexpected RPC result", async () => {
    const { adapter } = adapterWith(() => ({ data: "weird" }));
    await expect(adapter.messages.updateStatus("wamid.1", "read")).rejects.toBeInstanceOf(
      SupabaseAdapterError,
    );
  });

  it("increments unread through wa_increment_unread after the field update", async () => {
    const row = {
      id: UUID,
      tenant_id: null,
      account_id: UUID,
      contact_id: UUID,
      status: "agent",
      assigned_to: null,
      handoff_reason: null,
      last_inbound_at: null,
      last_activity_at: "2026-10-06T12:00:00+00:00",
      window_expires_at: null,
      unread_count: 5,
      created_at: "2026-10-06T12:00:00+00:00",
    };
    const { adapter, calls } = adapterWith((target) =>
      target === "rpc:wa_increment_unread" ? { data: 6 } : { data: row },
    );
    const updated = await adapter.conversations.update(UUID, {
      unreadCount: 5,
      incrementUnread: 1,
    });
    expect(updated.unreadCount).toBe(6);
    expect(calls.find((c) => c.method === "update")?.args[0]).toEqual({ unread_count: 5 });
    expect(calls.find((c) => c.method === "rpc")?.args[0]).toEqual({
      conversation_id: UUID,
      amount: 1,
    });
  });

  it("acquires locks through wa_acquire_lock with an integer ttl", async () => {
    const { adapter, calls } = adapterWith(() => ({ data: false }));
    expect(await adapter.locks.acquire("k", 99.2)).toBe(false);
    expect(calls[0]?.args[0]).toEqual({ key: "k", ttl_ms: 100 });
  });
});

describe("schema checks", () => {
  it.each(["42P01", "PGRST205"])(
    "schemaVersion is null when the table is missing (%s)",
    async (code) => {
      const { adapter } = adapterWith(() => ({ error: { code, message: "missing" } }));
      expect(await adapter.schemaVersion()).toBeNull();
    },
  );

  it("schemaVersion reads the highest version", async () => {
    const { adapter, calls } = adapterWith(() => ({ data: { version: 1 } }));
    expect(await adapter.schemaVersion()).toBe(1);
    expect(calls.find((c) => c.method === "order")?.args).toEqual([
      "version",
      { ascending: false },
    ]);
  });

  it("healthCheck reports missing tables", async () => {
    const { adapter } = adapterWith((target) =>
      target === "table:wa_locks" || target === "table:wa_media"
        ? { error: { code: "PGRST205", message: "Could not find the table" } }
        : { data: [] },
    );
    expect(await adapter.healthCheck()).toEqual({
      tablesOk: false,
      missing: WA_TABLES.filter((t) => t === "wa_media" || t === "wa_locks"),
    });
  });

  it("healthCheck rethrows unrelated errors", async () => {
    const { adapter } = adapterWith(() => ({
      error: { code: "PGRST301", message: "JWT expired" },
    }));
    await expect(adapter.healthCheck()).rejects.toBeInstanceOf(SupabaseAdapterError);
  });
});

describe("storage", () => {
  it("returns null for a missing object and rethrows other failures", async () => {
    const missing = adapterWith(() => ({
      error: {
        name: "StorageApiError",
        message: "Object not found",
        status: 400,
        statusCode: "404",
      },
    }));
    expect(await missing.adapter.storage.get("a/b.jpg")).toBeNull();

    const broken = adapterWith(() => ({
      error: { name: "StorageApiError", message: "Internal", status: 500, statusCode: "500" },
    }));
    await expect(broken.adapter.storage.get("a/b.jpg")).rejects.toBeInstanceOf(
      SupabaseAdapterError,
    );
  });

  it("reports a missing bucket as false", async () => {
    const { adapter } = adapterWith(() => ({
      error: { message: "Bucket not found", status: 400, statusCode: "404" },
    }));
    expect(await adapter.storage.bucketExists()).toBe(false);
  });

  it("uploads with upsert and the content type", async () => {
    const { adapter, calls } = adapterWith(() => ({ data: { path: "a/b.jpg" } }));
    const bytes = new Uint8Array([1, 2, 3]);
    await adapter.storage.put("a/b.jpg", bytes, "image/jpeg");
    expect(calls[0]).toMatchObject({
      target: "bucket:whatsapp-media",
      method: "upload",
      args: ["a/b.jpg", bytes, { contentType: "image/jpeg", upsert: true }],
    });
  });
});

describe("decodeCursor", () => {
  it("round-trips valid cursors and rejects malformed or unsafe ones", () => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const valid = { t: "2026-04-01T12:00:00+00:00", id: UUID };
    expect(decodeCursor(encode(valid))).toEqual(valid);
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("%%%")).toBeNull();
    expect(decodeCursor(encode({ t: "nope", id: UUID }))).toBeNull();
    expect(decodeCursor(encode({ t: valid.t, id: "x),status.eq.closed" }))).toBeNull();
  });
});
