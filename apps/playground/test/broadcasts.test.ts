/**
 * The installed broadcasts item end to end in fixtures mode: the real Broadcasts server actions
 * (`app/(protected)/inbox/broadcasts/actions.ts`), the playground's audiences
 * (`broadcasts-config.ts`), `sendo.actor` with the playground's `resolveRole`, the package
 * broadcasts API on the memory adapter, `sendo.maintenance.tick()` and the fake Graph API.
 *
 * [BC-1] The composer's data: approved templates of the number (with category and body) and the
 *        app's audiences with their sizes.
 * [BC-2] Flow H step 2 / AC-BC-2: a MARKETING template to contacts without opt-in previews
 *        0 eligible (all `no_opt_in`) and stores nothing; one `setOptIn` makes one eligible.
 * [BC-3] Flow H steps 3–4: preview → create → tick. Counts come from `getBroadcast`, the invalid
 *        phone is counted but not stored, recipients page by state with the contact's phone.
 * [BC-4] AC-BC-4: cancel turns the pending recipients into `cancelled`; sent ones stay sent.
 * [BC-5] The server, not the browser, decides the recipients: an audience the config doesn't
 *        offer, a bad rate or a template that isn't approved is refused and nothing is stored.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as ActionsModule from "@/app/(protected)/inbox/broadcasts/actions";
import type { BroadcastDraft } from "@/components/sendo/broadcasts/types";
import type * as SendoLib from "@/lib/sendo";

let actions: typeof ActionsModule;
let lib: typeof SendoLib;
let accountId: string;

function data<T>(result: { ok: true; data: T } | { ok: false; code: string; message: string }): T {
  if (!result.ok) throw new Error(`action failed: ${result.code} ${result.message}`);
  return result.data;
}

function draft(overrides: Partial<BroadcastDraft> = {}): BroadcastDraft {
  return {
    account: accountId,
    template: "recordatorio_cita",
    language: "es",
    audience: "test-phones",
    variables: ["Ana", "lunes 12"],
    ratePerMinute: 60,
    ...overrides,
  };
}

async function tick() {
  const report = await lib.sendo.maintenance.tick();
  expect(report.skipped).toBe(false);
  return report;
}

beforeAll(async () => {
  vi.stubEnv("SENDO_PLAYGROUND_MODE", "fixtures");
  vi.stubEnv("SENDO_AGENT_MODEL", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
  actions = await import("@/app/(protected)/inbox/broadcasts/actions");
  lib = await import("@/lib/sendo");
  const seeded = await lib.playground.ready;
  if (seeded === null) throw new Error("fixtures not seeded");
  accountId = seeded.account.id;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("broadcasts in the playground", () => {
  it("[BC-1] lists the number's approved templates and the app's audiences", async () => {
    const templates = data(await actions.listTemplates(accountId));
    expect(templates.map((t) => [t.name, t.category, t.variableCount]).sort()).toEqual([
      ["novedades", "MARKETING", 1],
      ["recordatorio_cita", "UTILITY", 2],
      ["seguimiento", "UTILITY", 0],
    ]);
    expect(templates.find((t) => t.name === "novedades")?.body).toContain("{{1}}");

    const audiences = data(await actions.listAudiences(accountId));
    expect(audiences.map((a) => a.id)).toEqual(["inbox", "test-phones"]);
    expect(audiences[0]?.size).toBeGreaterThan(3);
    expect(audiences[1]).toMatchObject({ label: "Teléfonos de prueba", size: 4 });
  });

  it("[BC-2] previews 0 eligible for a MARKETING template without opt-in, and stores nothing", async () => {
    const marketing = draft({ template: "novedades", audience: "inbox", variables: ["vecino"] });
    const before = data(await actions.previewBroadcast(marketing));
    expect(before.category).toBe("MARKETING");
    expect(before.eligible).toBe(0);
    expect(before.total).toBeGreaterThan(3);
    expect(before.skipped).toEqual({ no_opt_in: before.total, opted_out: 0, invalid_phone: 0 });
    expect(data(await actions.listBroadcasts()).items).toEqual([]);

    // The same list as UTILITY reaches everyone (nobody opted out).
    const utility = data(
      await actions.previewBroadcast(
        draft({ template: "seguimiento", audience: "inbox", variables: null }),
      ),
    );
    expect(utility.eligible).toBe(before.total);

    const conversations = await lib.sendo.inbox.list({
      actor: await lib.sendo.actor("dev-user", "00000000-0000-4000-8000-00000000a001"),
      accountId,
      limit: 1,
    });
    const contact = conversations.items[0]?.contact;
    if (contact === undefined) throw new Error("no inbox contact");
    await lib.sendo.contacts.setOptIn(contact.id, true, { source: "test" });
    const after = data(await actions.previewBroadcast(marketing));
    expect(after.eligible).toBe(1);
    expect(after.skipped.no_opt_in).toBe(before.total - 1);
  });

  it("[BC-3] creates, sends on the tick and reports counts and recipients from the package", async () => {
    const preview = data(await actions.previewBroadcast(draft()));
    expect(preview).toMatchObject({
      total: 4,
      eligible: 3,
      skipped: { no_opt_in: 0, opted_out: 0, invalid_phone: 1 },
      ratePerMinute: 60,
      estimatedMinutes: 1,
    });

    const created = data(await actions.createBroadcast(draft()));
    expect(created).toMatchObject({
      status: "queued",
      templateName: "recordatorio_cita",
      accountId,
      counts: { pending: 3, sent: 0, skipped: 0, failed: 0 },
    });
    expect(data(await actions.listBroadcasts()).items.map((b) => b.id)).toContain(created.id);

    await tick();
    const progressed = data(await actions.getBroadcast(created.id));
    expect(progressed.status).toBe("done");
    expect(progressed.counts.pending).toBe(0);
    expect(progressed.counts.sent + progressed.counts.delivered + progressed.counts.read).toBe(3);
    expect(progressed.startedAt).not.toBeNull();

    const all = data(await actions.listRecipients(created.id));
    expect(all.items).toHaveLength(3);
    expect(all.nextCursor).toBeNull();
    expect(all.items.every((r) => r.phone?.startsWith("+") === true)).toBe(true);
    const failed = data(await actions.listRecipients(created.id, { status: "failed" }));
    expect(failed.items).toEqual([]);
  });

  it("[BC-4] cancel turns the pending recipients into cancelled", async () => {
    const created = data(await actions.createBroadcast(draft({ ratePerMinute: 1 })));
    await tick();
    const midway = data(await actions.getBroadcast(created.id));
    expect(midway.status).toBe("sending");
    expect(midway.counts.pending).toBe(2);

    const cancelled = data(await actions.cancelBroadcast(created.id));
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.counts).toMatchObject({ pending: 0, cancelled: 2 });
    expect(cancelled.counts.sent + cancelled.counts.delivered + cancelled.counts.read).toBe(1);
    const rows = data(await actions.listRecipients(created.id, { status: "cancelled" }));
    expect(rows.items.map((r) => r.status)).toEqual(["cancelled", "cancelled"]);

    await tick();
    expect(data(await actions.getBroadcast(created.id)).counts.cancelled).toBe(2);
  });

  it("[BC-5] refuses audiences the app doesn't offer, bad rates and unapproved templates", async () => {
    const before = data(await actions.listBroadcasts()).items.length;
    expect(await actions.createBroadcast(draft({ audience: "everyone-in-the-db" }))).toMatchObject({
      ok: false,
      code: "INVALID",
    });
    expect(await actions.previewBroadcast(draft({ ratePerMinute: 0 }))).toMatchObject({
      ok: false,
      code: "INVALID",
    });
    expect(await actions.previewBroadcast(draft({ template: "no_existe" }))).toMatchObject({
      ok: false,
      code: "TEMPLATE",
    });
    expect(await actions.previewBroadcast(draft({ variables: ["solo una"] }))).toMatchObject({
      ok: false,
      code: "VARIABLES",
      expected: 2,
    });
    expect(await actions.getBroadcast("00000000-0000-4000-8000-000000000000")).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(data(await actions.listBroadcasts()).items).toHaveLength(before);
  });
});
