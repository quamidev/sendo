import { describe, expect, it } from "vitest";
import type { MediaStore } from "../../media/types";
import { uid } from "./helpers";

/** Returns the store under test, or `null` to skip (an adapter without a default store). */
export type MakeMediaStore = () => Promise<MediaStore | null> | MediaStore | null;

/** Contract for a `MediaStore` (the adapters' default `storage`, `supabaseStorage`, `s3Storage`). */
export function mediaStoreContract(make: MakeMediaStore): void {
  describe("media store", () => {
    it("puts and gets bytes, and returns null for missing paths", async (ctx) => {
      const store = await make();
      if (store === null) return ctx.skip("no media store");
      const path = `_/${uid()}/media/${uid()}.jpg`;
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
      await store.put(path, bytes, "image/jpeg");

      const read = await store.get(path);
      expect(read).not.toBeNull();
      expect(Array.from(read ?? [])).toEqual(Array.from(bytes));
      expect(await store.get(`_/${uid()}/missing.jpg`)).toBeNull();
    }, 20_000);

    it("returns a signed URL and reports the bucket", async (ctx) => {
      const store = await make();
      if (store === null) return ctx.skip("no media store");
      const path = `_/${uid()}/doc.pdf`;
      await store.put(path, new Uint8Array([37, 80, 68, 70]), "application/pdf");
      const url = await store.signedUrl(path, 300);
      expect(typeof url).toBe("string");
      expect(() => new URL(url)).not.toThrow();
      expect(url).toContain("doc.pdf");
      if (store.exists) expect(await store.exists()).toBe(true);
    }, 20_000);

    it("deletes objects and ignores missing paths", async (ctx) => {
      const store = await make();
      if (store === null) return ctx.skip("no media store");
      const kept = `_/${uid()}/kept.jpg`;
      const removed = `_/${uid()}/removed.jpg`;
      await store.put(kept, new Uint8Array([1]), "image/jpeg");
      await store.put(removed, new Uint8Array([2]), "image/jpeg");

      await store.delete([removed, `_/${uid()}/missing.jpg`]);
      expect(await store.get(removed)).toBeNull();
      expect(await store.get(kept)).not.toBeNull();
      await store.delete([]);
    }, 20_000);
  });
}
