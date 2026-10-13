"use server";

import type {
  BroadcastAudienceView,
  BroadcastDraft,
  BroadcastPreviewView,
  BroadcastRecipientRowView,
  BroadcastsActionResult,
  BroadcastSummaryView,
  BroadcastTemplateView,
  PageView,
  RecipientStatus,
  RecipientsQuery,
} from "@/components/sendo/broadcasts/types";
import {
  broadcastsFixture,
  fixtureRecipient,
  type FixtureBroadcast,
  type FixtureAudience,
} from "@/fixtures/broadcasts";

// Dev-only stand-ins for app/(protected)/inbox/broadcasts/actions.ts: same result shapes, fixture
// data kept per dataset in this server process (reload with &reset to start over). Eligibility is
// faked from each audience's split; the real rules live in the package.

const stores = new Map<string, FixtureBroadcast[]>();
const PAGE = 50;
const notFound = { ok: false, code: "NOT_FOUND", message: "Unknown broadcast" } as const;

function store(data: string): FixtureBroadcast[] {
  const { key, fixture } = broadcastsFixture(data);
  let broadcasts = stores.get(key);
  if (broadcasts === undefined) {
    broadcasts = structuredClone(fixture.broadcasts);
    stores.set(key, broadcasts);
  }
  return broadcasts;
}

function countsOf(plan: [RecipientStatus, number][]): BroadcastSummaryView["counts"] {
  const counts = {
    pending: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
  };
  for (const [status, count] of plan) counts[status] += count;
  return counts;
}

function moveFromPending(entry: FixtureBroadcast, to: RecipientStatus | null, max: number): number {
  const pending = entry.plan.find(([status]) => status === "pending");
  if (pending === undefined || pending[1] === 0) return 0;
  const moved = to === null ? 0 : Math.min(max, pending[1]);
  pending[1] -= moved;
  if (to !== null && moved > 0) entry.plan.unshift([to, moved]);
  return moved;
}

/** A live broadcast advances on every read, like the tick would between polls. */
function advance(entry: FixtureBroadcast): void {
  if (entry.live !== true) return;
  const summary = entry.summary;
  if (summary.status === "queued") {
    summary.status = "sending";
    summary.startedAt = new Date().toISOString();
  }
  if (summary.status !== "sending") return;
  moveFromPending(entry, "read", 8);
  moveFromPending(entry, "delivered", 14);
  moveFromPending(entry, "sent", 6);
  moveFromPending(entry, "failed", 1);
  if (countsOf(entry.plan).pending === 0) {
    summary.status = "done";
    summary.finishedAt = new Date().toISOString();
  }
}

function view(entry: FixtureBroadcast): BroadcastSummaryView {
  return { ...entry.summary, counts: countsOf(entry.plan) };
}

export async function resetFixtureBroadcasts(data: string): Promise<void> {
  stores.delete(broadcastsFixture(data).key);
}

export async function listFixtureBroadcasts(
  data: string,
  cursor?: string | null,
): Promise<BroadcastsActionResult<PageView<BroadcastSummaryView>>> {
  const all = store(data);
  const start = cursor == null ? 0 : Number(cursor);
  const items = all.slice(start, start + 20).map(view);
  return {
    ok: true,
    data: { items, nextCursor: start + 20 < all.length ? String(start + 20) : null },
  };
}

export async function getFixtureBroadcast(
  data: string,
  id: string,
): Promise<BroadcastsActionResult<BroadcastSummaryView>> {
  const entry = store(data).find((candidate) => candidate.summary.id === id);
  if (entry === undefined) return notFound;
  advance(entry);
  return { ok: true, data: view(entry) };
}

export async function listFixtureRecipients(
  data: string,
  id: string,
  query: RecipientsQuery = {},
): Promise<BroadcastsActionResult<PageView<BroadcastRecipientRowView>>> {
  const entry = store(data).find((candidate) => candidate.summary.id === id);
  if (entry === undefined) return notFound;
  // Row indexes of the wanted state, in id order, without materializing all of them.
  const ranges: [number, number][] = [];
  let offset = 0;
  for (const [status, count] of entry.plan) {
    if (query.status == null || query.status === status) ranges.push([offset, count]);
    offset += count;
  }
  const start = query.cursor == null ? 0 : Number(query.cursor);
  const items: BroadcastRecipientRowView[] = [];
  let seen = 0;
  for (const [from, count] of ranges) {
    const lo = Math.max(start, seen);
    const hi = Math.min(start + PAGE, seen + count);
    for (let index = lo; index < hi; index++) {
      items.push(fixtureRecipient(entry.summary.id, entry.plan, from + index - seen));
    }
    seen += count;
  }
  const total = ranges.reduce((sum, [, count]) => sum + count, 0);
  const next = start + items.length;
  return { ok: true, data: { items, nextCursor: next < total ? String(next) : null } };
}

export async function listFixtureTemplates(
  data: string,
): Promise<BroadcastsActionResult<BroadcastTemplateView[]>> {
  return { ok: true, data: broadcastsFixture(data).fixture.templates };
}

export async function listFixtureAudiences(
  data: string,
): Promise<BroadcastsActionResult<BroadcastAudienceView[]>> {
  return {
    ok: true,
    data: broadcastsFixture(data).fixture.audiences.map(({ id, label, description, size }) => ({
      id,
      label,
      description,
      size,
    })),
  };
}

function previewOf(
  data: string,
  draft: BroadcastDraft,
): { preview: BroadcastPreviewView; audience: FixtureAudience } | null {
  const { fixture } = broadcastsFixture(data);
  const audience = fixture.audiences.find((candidate) => candidate.id === draft.audience);
  const template = fixture.templates.find(
    (candidate) => candidate.name === draft.template && candidate.language === draft.language,
  );
  if (audience === undefined || template === undefined) return null;
  const marketing = template.category === "MARKETING";
  const eligible = audience.optedIn + (marketing ? 0 : audience.noDecision);
  return {
    audience,
    preview: {
      total: audience.optedIn + audience.noDecision + audience.optedOut + audience.invalidPhone,
      eligible,
      skipped: {
        no_opt_in: marketing ? audience.noDecision : 0,
        opted_out: audience.optedOut,
        invalid_phone: audience.invalidPhone,
      },
      category: template.category,
      ratePerMinute: draft.ratePerMinute,
      estimatedMinutes: Math.ceil(eligible / draft.ratePerMinute),
    },
  };
}

export async function previewFixtureBroadcast(
  data: string,
  draft: BroadcastDraft,
): Promise<BroadcastsActionResult<BroadcastPreviewView>> {
  const result = previewOf(data, draft);
  if (result === null) return { ok: false, code: "INVALID", message: "Unknown draft" };
  return { ok: true, data: result.preview };
}

export async function createFixtureBroadcast(
  data: string,
  draft: BroadcastDraft,
): Promise<BroadcastsActionResult<BroadcastSummaryView>> {
  const result = previewOf(data, draft);
  if (result === null) return { ok: false, code: "INVALID", message: "Unknown draft" };
  const { preview } = result;
  const template = broadcastsFixture(data).fixture.templates.find(
    (candidate) => candidate.name === draft.template,
  );
  const now = new Date().toISOString();
  const entry: FixtureBroadcast = {
    live: true,
    plan: [
      ["skipped", preview.skipped.no_opt_in + preview.skipped.opted_out],
      ["pending", preview.eligible],
    ],
    summary: {
      id: `bc-new-${crypto.randomUUID().slice(0, 8)}`,
      accountId: draft.account,
      templateName: draft.template,
      language: draft.language,
      category: template?.category ?? "UTILITY",
      status: "queued",
      pauseReason: null,
      ratePerMinute: draft.ratePerMinute,
      createdBy: "dev-user",
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      counts: countsOf([]),
    },
  };
  store(data).unshift(entry);
  return { ok: true, data: view(entry) };
}

export async function cancelFixtureBroadcast(
  data: string,
  id: string,
): Promise<BroadcastsActionResult<BroadcastSummaryView>> {
  const entry = store(data).find((candidate) => candidate.summary.id === id);
  if (entry === undefined) return notFound;
  const { status } = entry.summary;
  if (status === "queued" || status === "sending" || status === "paused") {
    for (const item of entry.plan) if (item[0] === "pending") item[0] = "cancelled";
    entry.summary.status = "cancelled";
    entry.summary.pauseReason = null;
    entry.summary.finishedAt = new Date().toISOString();
  }
  return { ok: true, data: view(entry) };
}
