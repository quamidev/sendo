import { describe, expect, it } from "vitest";
import { SENDO_SCHEMA_VERSION } from "../../utils/schema-version";
import { type Fresh, NOT_FOUND, HOUR_MS, uid, sleep } from "./helpers";

/** Contract for `events, locks, storage and schema`. */
export function systemContract(fresh: Fresh): void {
  describe("events", () => {
    it("inserts as received and sets status", async () => {
      const adapter = await fresh();
      const payload = { object: "whatsapp_business_account", entry: [{ id: uid() }] };
      const event = await adapter.events.insert({ payload });
      expect(event).toMatchObject({
        payload,
        status: "received",
        error: null,
        processedAt: null,
      });
      expect(event.receivedAt).toBeInstanceOf(Date);
      expect(await adapter.events.get(event.id)).toEqual(event);

      const failed = await adapter.events.setStatus(event.id, "failed", "boom");
      expect(failed).toMatchObject({ status: "failed", error: "boom" });
      expect(failed.processedAt).toBeInstanceOf(Date);

      const processed = await adapter.events.setStatus(event.id, "processed");
      expect(processed).toMatchObject({ status: "processed", error: null });
      expect(processed.processedAt).toBeInstanceOf(Date);

      const unrouted = await adapter.events.setStatus(event.id, "unrouted", null);
      expect(unrouted.status).toBe("unrouted");
      expect(await adapter.events.get(event.id)).toEqual(unrouted);
    });

    it("returns null or throws RecordNotFoundError for unknown events", async () => {
      const adapter = await fresh();
      const id = crypto.randomUUID();
      expect(await adapter.events.get(id)).toBeNull();
      await expect(adapter.events.setStatus(id, "processed")).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "event",
        id,
      });
    });

    it("prune deletes events received before the cutoff and returns the count", async () => {
      const adapter = await fresh();
      const a = await adapter.events.insert({ payload: { n: 1 } });
      const b = await adapter.events.insert({ payload: { n: 2 } });

      expect(await adapter.events.prune(new Date(a.receivedAt.getTime() - HOUR_MS))).toBe(0);
      expect(await adapter.events.get(a.id)).not.toBeNull();

      const pruned = await adapter.events.prune(new Date(b.receivedAt.getTime() + HOUR_MS));
      expect(pruned).toBeGreaterThanOrEqual(2);
      expect(await adapter.events.get(a.id)).toBeNull();
      expect(await adapter.events.get(b.id)).toBeNull();
    });
  });

  describe("locks", () => {
    it("acquires a free key and rejects a held one", async () => {
      const adapter = await fresh();
      const key = `lock:${uid()}`;
      expect(await adapter.locks.acquire(key, 60_000)).toBe(true);
      expect(await adapter.locks.acquire(key, 60_000)).toBe(false);
      expect(await adapter.locks.acquire(`lock:${uid()}`, 60_000)).toBe(true);
    });

    it("lets only one of several concurrent acquires win", async () => {
      const adapter = await fresh();
      const key = `lock:${uid()}`;
      const results = await Promise.all(
        Array.from({ length: 5 }, () => adapter.locks.acquire(key, 60_000)),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("frees the key on release", async () => {
      const adapter = await fresh();
      const key = `lock:${uid()}`;
      await adapter.locks.acquire(key, 60_000);
      await adapter.locks.release(key);
      expect(await adapter.locks.acquire(key, 60_000)).toBe(true);
      await adapter.locks.release(`lock:${uid()}`);
    });

    it("lets an expired lock be taken", async () => {
      const adapter = await fresh();
      const key = `lock:${uid()}`;
      expect(await adapter.locks.acquire(key, 100)).toBe(true);
      expect(await adapter.locks.acquire(key, 100)).toBe(false);
      await sleep(250);
      expect(await adapter.locks.acquire(key, 60_000)).toBe(true);
      expect(await adapter.locks.acquire(key, 60_000)).toBe(false);
    });
  });

  describe("storage", () => {
    it("puts and gets bytes, and returns null for missing paths", async () => {
      const adapter = await fresh();
      const path = `_/${uid()}/media/${uid()}.jpg`;
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
      await adapter.storage.put(path, bytes, "image/jpeg");

      const read = await adapter.storage.get(path);
      expect(read).not.toBeNull();
      expect(Array.from(read ?? [])).toEqual(Array.from(bytes));
      expect(await adapter.storage.get(`_/${uid()}/missing.jpg`)).toBeNull();
    }, 20_000);

    it("returns a signed URL and reports the bucket", async () => {
      const adapter = await fresh();
      const path = `_/${uid()}/doc.pdf`;
      await adapter.storage.put(path, new Uint8Array([37, 80, 68, 70]), "application/pdf");
      const url = await adapter.storage.signedUrl(path, 300);
      expect(typeof url).toBe("string");
      expect(() => new URL(url)).not.toThrow();
      expect(url).toContain("doc.pdf");
      expect(await adapter.storage.bucketExists()).toBe(true);
    }, 20_000);
  });

  describe("schema", () => {
    it("reports the schema version and a healthy schema", async () => {
      const adapter = await fresh();
      expect(await adapter.schemaVersion()).toBe(SENDO_SCHEMA_VERSION);
      expect(await adapter.healthCheck()).toEqual({ tablesOk: true, missing: [] });
    });
  });
}
