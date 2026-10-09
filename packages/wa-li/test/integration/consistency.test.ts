/**
 * Cross-cutting consistency checks (implementation spec WAL-6.1). The memory vs Supabase parity
 * check lives in pipeline-parity.supabase.test.ts so `pnpm test:supabase` picks it up.
 *
 * [CC-ERR-1] Every namespace throws AccountNotFoundError for an unknown or inactive account
 *            (send.*, templates.sync, templates.list, inbox.reply).
 * [CC-ERR-2] Every namespace throws RecordNotFoundError for an unknown conversation id
 *            (inbox.thread / markSeen / reply, conversations.handoff / returnToAgent / close /
 *            assign / windowStatus); conversations.get returns null like every adapter `get`.
 * [CC-REG-1] Registry-built JSON matches the source files under registry/items.
 * [CC-SCH-1] The schema migration mirrors (root supabase/, playground) are byte-identical.
 * [CC-ENT-1] The main entry dist doesn't import next, @supabase/supabase-js or vitest.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountInput, openConversation, useGraphServer } from "../../src/core/test-utils";
import { AccountNotFoundError, RecordNotFoundError } from "../../src/errors/errors";
import { findForbiddenImports } from "../support/entry-imports";
import { createHarness } from "./harness";

const graph = useGraphServer();
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const PACKAGE_DIST = resolve(import.meta.dirname, "../../dist");
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const PHONE = "+50255550001";

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("Cross-cutting consistency", () => {
  it("[CC-ERR-1] AccountNotFoundError for unknown and inactive accounts in every namespace", async () => {
    const h = await createHarness();
    const inactive = await h.adapter.accounts.insert(
      accountInput({ phoneNumberId: "PN_OFF", wabaId: "WABA_OFF" }),
    );
    const { conversation: inactiveConversation } = await openConversation(h.ctx, inactive, PHONE);
    const ghost = await h.adapter.accounts.insert(
      accountInput({ phoneNumberId: "PN_GHOST", wabaId: "WABA_G" }),
    );
    const { conversation: ghostConversation } = await openConversation(h.ctx, ghost, PHONE);
    const stored = h.adapter.__state.accounts.get(inactive.id);
    if (!stored) throw new Error("missing account");
    stored.active = false;
    h.adapter.__state.accounts.delete(ghost.id);

    for (const account of ["PN_NOPE", UNKNOWN_ID, inactive.id, "PN_OFF", ghost.id]) {
      const errors = [
        await rejection(h.wa.send.text(PHONE, "hola", { account })),
        await rejection(
          h.wa.send.media(PHONE, { type: "image", url: "https://x.dev/a.jpg" }, { account }),
        ),
        await rejection(
          h.wa.send.buttons(PHONE, { body: "x", buttons: [{ id: "a", title: "A" }] }, { account }),
        ),
        await rejection(h.wa.send.template(PHONE, "t", { account, language: "es" })),
        await rejection(h.wa.templates.sync({ account })),
        await rejection(h.wa.templates.list({ account })),
      ];
      for (const error of errors) {
        expect(error, `account ${account}`).toBeInstanceOf(AccountNotFoundError);
        expect(error).toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
      }
    }
    for (const conversationId of [inactiveConversation.id, ghostConversation.id]) {
      const error = await rejection(
        h.wa.inbox.reply(
          conversationId,
          { kind: "text", body: "hola" },
          { userId: "u", tenantId: "tenant-a" },
        ),
      );
      expect(error).toBeInstanceOf(AccountNotFoundError);
    }
    expect(graph.requests).toHaveLength(0);
  });

  it("[CC-ERR-2] RecordNotFoundError for unknown conversation ids in every namespace", async () => {
    const h = await createHarness();
    for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
      const errors = [
        await rejection(h.wa.inbox.thread(id)),
        await rejection(h.wa.inbox.thread(id, { tenantId: "tenant-a" })),
        await rejection(h.wa.inbox.markSeen(id, { tenantId: "tenant-a" })),
        await rejection(h.wa.inbox.reply(id, { kind: "text", body: "x" }, { userId: "u" })),
        await rejection(h.wa.conversations.handoff(id, { reason: "x" })),
        await rejection(h.wa.conversations.returnToAgent(id)),
        await rejection(h.wa.conversations.close(id)),
        await rejection(h.wa.conversations.assign(id, "u")),
        await rejection(h.wa.conversations.windowStatus(id)),
      ];
      for (const error of errors) {
        expect(error).toBeInstanceOf(RecordNotFoundError);
        expect(error).toMatchObject({ code: "RECORD_NOT_FOUND", entity: "conversation", id });
      }
      expect(await h.wa.conversations.get(id)).toBeNull();
    }
    await expect(h.wa.events.reprocess(UNKNOWN_ID)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  describe("[CC-REG-1] registry-built JSON matches the source files", () => {
    let outDir = "";
    beforeAll(() => {
      // Built into a private temp dir (same shadcn invocation as scripts/registry-build.mjs) so the
      // check never races turbo's registry#build rewriting apps/web/registry-dist.
      outDir = mkdtempSync(join(tmpdir(), "wa-li-registry-"));
      const pkg = JSON.parse(
        readFileSync(join(REPO_ROOT, "node_modules/shadcn/package.json"), "utf8"),
      ) as {
        bin: string | Record<string, string>;
      };
      const bin = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin.shadcn ?? "");
      const result = spawnSync(
        process.execPath,
        [
          join(REPO_ROOT, "node_modules/shadcn", bin),
          "build",
          "registry/registry.json",
          "-o",
          outDir,
          "-c",
          REPO_ROOT,
        ],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
      if (result.status !== 0)
        throw new Error(`shadcn build failed:\n${result.stdout}\n${result.stderr}`);
    }, 120_000);
    afterAll(() => {
      if (outDir) rmSync(outDir, { recursive: true, force: true });
    });

    it("[CC-REG-1] every item file's built content equals its source", () => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, "registry/registry.json"), "utf8"),
      ) as {
        items: { name: string; files: { path: string }[] }[];
      };
      expect(manifest.items.length).toBeGreaterThanOrEqual(3);
      let compared = 0;
      for (const item of manifest.items) {
        const built = JSON.parse(readFileSync(join(outDir, `${item.name}.json`), "utf8")) as {
          name: string;
          files: { path: string; content: string }[];
        };
        expect(built.name).toBe(item.name);
        expect(built.files.map((f) => f.path)).toEqual(item.files.map((f) => f.path));
        for (const file of built.files) {
          expect(file.path.startsWith("registry/items/")).toBe(true);
          const source = readFileSync(join(REPO_ROOT, file.path), "utf8");
          expect(file.content, `${item.name}: ${file.path}`).toBe(source);
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(10);
    });
  });

  it("[CC-SCH-1] the schema migration mirrors are byte-identical to the registry item", () => {
    const canonicalDir = join(REPO_ROOT, "registry/items/wa-li-schema/supabase/migrations");
    const mirrors = [
      join(REPO_ROOT, "supabase/migrations"),
      join(REPO_ROOT, "apps/playground/supabase/migrations"),
    ];
    const files = readdirSync(canonicalDir).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);
    for (const mirror of mirrors) {
      for (const file of files) {
        const copy = join(mirror, file);
        expect(existsSync(copy), copy).toBe(true);
        expect(readFileSync(copy).equals(readFileSync(join(canonicalDir, file))), copy).toBe(true);
      }
    }
    const playground = "20261006100000_playground.sql";
    expect(
      readFileSync(join(REPO_ROOT, "supabase/migrations", playground)).equals(
        readFileSync(join(REPO_ROOT, "apps/playground/supabase/migrations", playground)),
      ),
    ).toBe(true);
  });

  it.each(["index.js", "index.cjs", "adapters/memory/index.js", "adapters/memory/index.cjs"])(
    "[CC-ENT-1] dist/%s does not import next, @supabase/supabase-js or vitest",
    (file) => {
      const entry = join(PACKAGE_DIST, file);
      expect(existsSync(entry), `${entry} missing, run the build first`).toBe(true);
      expect(findForbiddenImports(entry)).toEqual([]);
    },
  );
});
