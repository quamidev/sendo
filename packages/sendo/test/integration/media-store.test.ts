/**
 * Product spec 4.3 "Adapters": AC-AP-3, media storage is pluggable through `MediaStore`. End to
 * end: signed webhook → pipeline download → `createSendo({ media })` store → `sendo.inbox.thread`
 * signed URLs, the agent's vision input, `sendo.accounts.purge` and `doctor`.
 *
 * [AC-AP-3a] An inbound image is `put` into `config.media` (path, bytes, MIME type), not into the
 *            adapter's default store; `inbox.thread` signs the URL through it (300 s) and the
 *            agent reads the bytes through it.
 * [AC-AP-3b] `accounts.purge` deletes the account's objects from `config.media`.
 * [AC-AP-3c] A failing `put` stores a `failed` media row (after the retry) and no URL.
 * [AC-AP-3d] Without any store (adapter without `storage`, no `media`) inbound media is stored as
 *            `failed` with an actionable log, `inbox.thread` gives no URL, doctor's storage check
 *            fails with a `config` fix; an invalid `media` fails `createSendo` with `ConfigError`.
 * [AC-AP-3e] doctor checks `media.exists()` of the app's store (missing bucket → `config` fix).
 */
import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../../src/adapters/memory";
import type { SendoAdapter } from "../../src/adapters/types";
import { scriptedModel, promptOf, textResult } from "../../src/agents/test-helpers";
import { createGraphClient } from "../../src/client/graph-client";
import { runDoctor } from "../../src/cli/doctor";
import { doctorEnv, healthyGraph, seededAdapter } from "../../src/cli/test-helpers";
import { createSendo } from "../../src/core/create-sendo";
import { accountInput, captureLogger, useGraphServer } from "../../src/core/test-utils";
import { ConfigError } from "../../src/errors/errors";
import type { MediaStore } from "../../src/media/types";
import type { Actor } from "../../src/team/permissions";
import { FIXTURE_IDS } from "../support/fixtures";
import {
  APP_SECRET,
  MEDIA_BYTES,
  VERIFY_TOKEN,
  createHarness,
  freshFixture,
  mediaHandlers,
  signedPost,
} from "./harness";

const graph = useGraphServer();
const ADMIN: Actor = { userId: "u-admin", tenantId: "tenant-a", role: "admin", queues: [] };

function recordingStore(opts: { failPut?: boolean; exists?: boolean } = {}) {
  const objects = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  const calls: string[] = [];
  const store: MediaStore = {
    put(path, bytes, mimeType) {
      calls.push(`put ${path}`);
      if (opts.failPut === true) return Promise.reject(new Error("bucket offline"));
      objects.set(path, { bytes: bytes.slice(), mimeType });
      return Promise.resolve();
    },
    get(path) {
      calls.push(`get ${path}`);
      return Promise.resolve(objects.get(path)?.bytes.slice() ?? null);
    },
    signedUrl(path, ttlSeconds) {
      calls.push(`signedUrl ${path}`);
      return Promise.resolve(`https://cdn.example/${path}?ttl=${String(ttlSeconds)}`);
    },
    delete(paths) {
      calls.push(`delete ${paths.join(",")}`);
      for (const path of paths) objects.delete(path);
      return Promise.resolve();
    },
  };
  if (opts.exists !== undefined) {
    const exists = opts.exists;
    store.exists = () => Promise.resolve(exists);
  }
  return { store, objects, calls };
}

async function threadMedia(sendo: ReturnType<typeof createSendo>, conversationId: string) {
  const page = await sendo.inbox.thread(conversationId, { actor: ADMIN });
  return page.items.find((m) => m.type === "image")?.media;
}

describe("MediaStore (AC-AP-3)", () => {
  it("[AC-AP-3a] stores inbound media in config.media and signs and reads it from there", async () => {
    graph.server.use(...mediaHandlers());
    const { store, objects, calls } = recordingStore();
    const h = await createHarness({ media: store });
    const model = scriptedModel(textResult("Recibí tu foto."));
    h.sendo.agent({ name: "recepcion", model, instructions: "Responde breve." });

    await h.deliver(freshFixture("image"));

    const row = [...h.adapter.__state.media.values()][0];
    expect(row).toMatchObject({ downloadStatus: "done", mimeType: "image/jpeg" });
    const path = row?.storagePath ?? "";
    expect(path).toMatch(new RegExp(`^tenant-a/${h.account.id}/[^/]+/300000000000001\\.jpg$`));
    expect(objects.get(path)).toEqual({ bytes: MEDIA_BYTES, mimeType: "image/jpeg" });
    expect(h.adapter.__state.storage.size).toBe(0);

    // The agent saw the image through `media.get`.
    expect(calls).toContain(`get ${path}`);
    const user = promptOf(model).find((m) => m.role === "user");
    const parts = user?.role === "user" ? user.content : [];
    expect(parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "file", mediaType: "image/jpeg" })]),
    );

    const conversationId = h.messages("in")[0]?.conversationId ?? "";
    expect(await threadMedia(h.sendo, conversationId)).toMatchObject({
      url: `https://cdn.example/${path}?ttl=300`,
      mimeType: "image/jpeg",
      downloadStatus: "done",
    });
  });

  it("[AC-AP-3b] purge deletes the account's objects from config.media", async () => {
    graph.server.use(...mediaHandlers());
    const { store, objects, calls } = recordingStore();
    const h = await createHarness({ media: store });
    await h.deliver(freshFixture("image"));
    await h.deliver(freshFixture("document"));
    await store.put("tenant-b/keep.jpg", new Uint8Array([1]), "image/jpeg");
    const paths = [...h.adapter.__state.media.values()].map((m) => m.storagePath ?? "");
    expect(paths).toHaveLength(2);

    await h.sendo.accounts.disconnect(h.account.id);
    await h.sendo.accounts.purge(h.account.id);

    expect(calls.filter((c) => c.startsWith("delete"))).toHaveLength(1);
    expect([...objects.keys()]).toEqual(["tenant-b/keep.jpg"]);
  });

  it("[AC-AP-3c] a failing put stores a failed media row and no URL", async () => {
    graph.server.use(...mediaHandlers());
    const { store, calls } = recordingStore({ failPut: true });
    const h = await createHarness({ media: store });

    await h.deliver(freshFixture("image"));

    expect(calls.filter((c) => c.startsWith("put"))).toHaveLength(2);
    expect([...h.adapter.__state.media.values()][0]).toMatchObject({
      downloadStatus: "failed",
      storagePath: null,
    });
    const conversationId = h.messages("in")[0]?.conversationId ?? "";
    expect(await threadMedia(h.sendo, conversationId)).toMatchObject({
      url: null,
      downloadStatus: "failed",
    });
  });

  it("[AC-AP-3d] without any store media is marked failed, doctor says how to fix it", async () => {
    graph.server.use(...mediaHandlers());
    const base = memoryAdapter();
    const { storage: _default, ...withoutStorage } = base;
    const adapter: SendoAdapter = withoutStorage;
    await adapter.accounts.insert(
      accountInput({ phoneNumberId: FIXTURE_IDS.phoneNumberId, wabaId: FIXTURE_IDS.wabaId }),
    );
    const { logs, logger } = captureLogger();
    const sendo = createSendo({
      adapter,
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
      resolveToken: () => "token-main",
      logger,
    });
    const tasks: Promise<unknown>[] = [];
    const response = await sendo.handleWebhook(signedPost(freshFixture("image")), {
      waitUntil: (p) => tasks.push(p),
    });
    expect(response.status).toBe(200);
    await Promise.all(tasks);

    expect([...base.__state.media.values()][0]).toMatchObject({ downloadStatus: "failed" });
    expect(JSON.stringify(logs)).toContain("pass `media` to createSendo");
    const conversationId = [...base.__state.messages.values()][0]?.conversationId ?? "";
    expect(await threadMedia(sendo, conversationId)).toMatchObject({ url: null });

    graph.server.use(...healthyGraph());
    const results = await runDoctor({
      env: doctorEnv(),
      adapter,
      graph: createGraphClient(),
    });
    expect(results.find((r) => r.id === "storage")).toMatchObject({
      ok: false,
      fix: { kind: "config" },
    });

    expect(() =>
      createSendo({
        adapter,
        appSecret: APP_SECRET,
        verifyToken: VERIFY_TOKEN,
        resolveToken: () => "token-main",
        media: { put: () => Promise.resolve() } as unknown as MediaStore,
      }),
    ).toThrow(ConfigError);
  });

  it("[AC-AP-3e] doctor checks the app's store, not the adapter's default bucket", async () => {
    graph.server.use(...healthyGraph());
    const adapter = await seededAdapter();
    const check = async (media: MediaStore) =>
      (await runDoctor({ env: doctorEnv(), adapter, media, graph: createGraphClient() })).find(
        (r) => r.id === "storage",
      );

    expect(await check(recordingStore({ exists: false }).store)).toMatchObject({
      ok: false,
      fix: { kind: "config" },
    });
    expect(await check(recordingStore({ exists: true }).store)).toMatchObject({ ok: true });
    expect(await check(recordingStore().store)).toMatchObject({ ok: true });
  });
});
