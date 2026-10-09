import { ConstraintViolationError, RecordNotFoundError } from "../../errors";
import type { Broadcast, BroadcastRecipient, Page } from "../../types/entities";
import {
  BROADCAST_RECIPIENT_STATUSES,
  BROADCAST_STATUSES,
  type BroadcastRecipientStatus,
} from "../../types/enums";
import type { SendoAdapter } from "../types";
import type { MemoryState, Sequenced } from "./index";

interface MemoryBroadcastDeps {
  state: () => MemoryState;
  now: () => Date;
  nextSeq: () => number;
}

function run<T>(fn: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(fn());
  });
}

function strip<T extends { seq: number }>(record: T): Omit<T, "seq"> {
  const { seq: _seq, ...rest } = record;
  return structuredClone(rest);
}

function encodeCursor(t: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: t.toISOString(), id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): { t: number; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      t?: unknown;
      id?: unknown;
    };
    if (typeof parsed.t !== "string" || typeof parsed.id !== "string") return null;
    const t = Date.parse(parsed.t);
    return Number.isNaN(t) ? null : { t, id: parsed.id };
  } catch {
    return null;
  }
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function assertBroadcast(b: Broadcast): void {
  if (!BROADCAST_STATUSES.includes(b.status)) {
    throw new ConstraintViolationError({ constraint: "sendo_broadcasts_status_check" });
  }
  if (!(b.ratePerMinute > 0)) {
    throw new ConstraintViolationError({ constraint: "sendo_broadcasts_rate_per_minute_check" });
  }
}

function assertRecipientStatus(status: BroadcastRecipientStatus): void {
  if (!BROADCAST_RECIPIENT_STATUSES.includes(status)) {
    throw new ConstraintViolationError({ constraint: "sendo_broadcast_recipients_status_check" });
  }
}

export function memoryBroadcasts(deps: MemoryBroadcastDeps): SendoAdapter["broadcasts"] {
  const { state, now, nextSeq } = deps;

  const requireBroadcast = (id: string): Sequenced<Broadcast> => {
    const b = state().broadcasts.get(id);
    if (!b) throw new RecordNotFoundError({ entity: "broadcast", id });
    return b;
  };

  return {
    insert: (input) =>
      run(() => {
        if (!state().accounts.has(input.accountId)) {
          throw new RecordNotFoundError({ entity: "account", id: input.accountId });
        }
        const broadcast: Sequenced<Broadcast> = {
          id: crypto.randomUUID(),
          tenantId: input.tenantId,
          accountId: input.accountId,
          templateName: input.templateName,
          language: input.language,
          category: input.category,
          variables: structuredClone(input.variables ?? null),
          ratePerMinute: input.ratePerMinute ?? 60,
          status: input.status ?? "queued",
          pauseReason: null,
          createdBy: input.createdBy ?? null,
          createdAt: now(),
          startedAt: null,
          finishedAt: null,
          seq: nextSeq(),
        };
        assertBroadcast(broadcast);
        state().broadcasts.set(broadcast.id, broadcast);
        return strip(broadcast);
      }),

    get: (id) =>
      run(() => {
        const b = state().broadcasts.get(id);
        return b ? strip(b) : null;
      }),

    list: (query) =>
      run((): Page<Broadcast> => {
        const statuses =
          query.status === undefined
            ? null
            : Array.isArray(query.status)
              ? query.status
              : [query.status];
        const cursor = decodeCursor(query.cursor);
        const items = [...state().broadcasts.values()]
          .filter((b) => b.tenantId === query.tenantId)
          .filter((b) => query.accountId === undefined || b.accountId === query.accountId)
          .filter((b) => statuses === null || statuses.includes(b.status))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || compareText(b.id, a.id))
          .filter(
            (b) =>
              !cursor ||
              b.createdAt.getTime() < cursor.t ||
              (b.createdAt.getTime() === cursor.t && b.id < cursor.id),
          );
        const page = items.slice(0, query.limit);
        const last = page.at(-1);
        return {
          items: page.map(strip),
          nextCursor:
            items.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
        };
      }),

    update: (id, patch) =>
      run(() => {
        const b = requireBroadcast(id);
        const next: Sequenced<Broadcast> = { ...b };
        for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
          const value = patch[key];
          if (value !== undefined) Object.assign(next, { [key]: structuredClone(value) });
        }
        assertBroadcast(next);
        Object.assign(b, next);
        return strip(b);
      }),

    insertRecipients: (broadcastId, recipients) =>
      run(() => {
        const broadcast = requireBroadcast(broadcastId);
        const s = state();
        for (const r of recipients) {
          if (!s.contacts.has(r.contactId)) {
            throw new RecordNotFoundError({ entity: "contact", id: r.contactId });
          }
          assertRecipientStatus(r.status ?? "pending");
        }
        const present = new Set<string>();
        for (const row of s.broadcastRecipients.values()) {
          if (row.broadcastId === broadcastId) present.add(row.contactId);
        }
        let inserted = 0;
        const at = now();
        for (const r of recipients) {
          if (present.has(r.contactId)) continue;
          present.add(r.contactId);
          const row: Sequenced<BroadcastRecipient> = {
            id: crypto.randomUUID(),
            tenantId: broadcast.tenantId,
            broadcastId,
            contactId: r.contactId,
            variables: structuredClone(r.variables ?? null),
            messageId: null,
            status: r.status ?? "pending",
            skipReason: r.skipReason ?? null,
            error: null,
            updatedAt: at,
            seq: nextSeq(),
          };
          s.broadcastRecipients.set(row.id, row);
          inserted++;
        }
        return inserted;
      }),

    nextPending: (broadcastId, limit) =>
      run(() =>
        [...state().broadcastRecipients.values()]
          .filter((r) => r.broadcastId === broadcastId && r.status === "pending")
          .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.seq - b.seq)
          .slice(0, Math.max(0, Math.floor(limit)))
          .map(strip),
      ),

    updateRecipient: (id, patch) =>
      run(() => {
        const s = state();
        const row = s.broadcastRecipients.get(id);
        if (!row) throw new RecordNotFoundError({ entity: "broadcast_recipient", id });
        if (patch.status !== undefined) assertRecipientStatus(patch.status);
        if (patch.messageId != null && !s.messages.has(patch.messageId)) {
          throw new RecordNotFoundError({ entity: "message", id: patch.messageId });
        }
        if (patch.status !== undefined) row.status = patch.status;
        if (patch.messageId !== undefined) row.messageId = patch.messageId;
        if (patch.skipReason !== undefined) row.skipReason = patch.skipReason;
        if (patch.error !== undefined) row.error = structuredClone(patch.error);
        row.updatedAt = now();
        return strip(row);
      }),

    recipientByMessageId: (messageId) =>
      run(() => {
        for (const row of state().broadcastRecipients.values()) {
          if (row.messageId === messageId) return strip(row);
        }
        return null;
      }),

    listRecipients: (query) =>
      run((): Page<BroadcastRecipient> => {
        const statuses =
          query.status === undefined
            ? null
            : Array.isArray(query.status)
              ? query.status
              : [query.status];
        const after = query.cursor ?? null;
        const items = [...state().broadcastRecipients.values()]
          .filter((r) => r.broadcastId === query.broadcastId)
          .filter((r) => statuses === null || statuses.includes(r.status))
          .filter((r) => after === null || r.id > after)
          .sort((a, b) => compareText(a.id, b.id));
        const page = items.slice(0, query.limit);
        const last = page.at(-1);
        return {
          items: page.map(strip),
          nextCursor: items.length > query.limit && last ? last.id : null,
        };
      }),

    cancelPending: (broadcastId) =>
      run(() => {
        let count = 0;
        const at = now();
        for (const row of state().broadcastRecipients.values()) {
          if (row.broadcastId === broadcastId && row.status === "pending") {
            row.status = "cancelled";
            row.updatedAt = at;
            count++;
          }
        }
        return count;
      }),

    counts: (broadcastId) =>
      run(() => {
        const counts = Object.fromEntries(
          BROADCAST_RECIPIENT_STATUSES.map((s) => [s, 0]),
        ) as Record<BroadcastRecipientStatus, number>;
        for (const row of state().broadcastRecipients.values()) {
          if (row.broadcastId === broadcastId) counts[row.status]++;
        }
        return counts;
      }),
  };
}
