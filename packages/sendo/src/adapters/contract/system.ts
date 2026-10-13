import { describe, expect, it } from "vitest";
import { SENDO_SCHEMA_VERSION } from "../../utils/schema-version";
import { type Fresh, NOT_FOUND, HOUR_MS, uid, sleep } from "./helpers";
import { mediaStoreContract } from "./media-store";

/** Contract for `events, locks, storage (the default `MediaStore`, if any) and schema`. */
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

  mediaStoreContract(async () => (await fresh()).storage ?? null);

  describe("schema", () => {
    it("reports the schema version and a healthy schema", async () => {
      const adapter = await fresh();
      expect(await adapter.schemaVersion()).toBe(SENDO_SCHEMA_VERSION);
      expect(await adapter.healthCheck()).toEqual({ tablesOk: true, missing: [] });
    });
  });
}
