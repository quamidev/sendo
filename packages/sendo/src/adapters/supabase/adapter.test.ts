import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SENDO_TABLES } from "../types";
import { decodeCursor } from "./adapter";
import { supabaseAdapter } from ".";

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
  return { adapter: supabaseAdapter(client, { storageBucket: "sendo-media" }), calls };
};

const UUID = "7f1c2a4e-0d1b-4b8e-9a51-3c1f0e2d4a5b";

describe("schema checks", () => {
  it.each(["42P01", "PGRST205"])(
    "schemaVersion is null when the table is missing (%s)",
    async (code) => {
      const { adapter } = adapterWith(() => ({ error: { code, message: "missing" } }));
      expect(await adapter.schemaVersion()).toBeNull();
    },
  );

  it("healthCheck reports missing tables", async () => {
    const { adapter } = adapterWith((target) =>
      target === "table:sendo_locks" || target === "table:sendo_media"
        ? { error: { code: "PGRST205", message: "Could not find the table" } }
        : { data: [] },
    );
    expect(await adapter.healthCheck()).toEqual({
      tablesOk: false,
      missing: SENDO_TABLES.filter((t) => t === "sendo_media" || t === "sendo_locks"),
    });
  });
});

describe("storage", () => {
  it("reports a missing bucket as false", async () => {
    const { adapter } = adapterWith(() => ({
      error: { message: "Bucket not found", status: 400, statusCode: "404" },
    }));
    expect(await adapter.storage.exists?.()).toBe(false);
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
