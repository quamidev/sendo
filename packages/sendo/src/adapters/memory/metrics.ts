import type { Account, Conversation, Message } from "../../types/entities";
import {
  type AiResolutionViewRow,
  type AssigneeViewRow,
  type DailyViewRow,
  type FirstResponseViewRow,
  type SourceViewRow,
  foldAiResolution,
  foldByAssignee,
  foldBySource,
  foldCost,
  foldDaily,
  foldFirstResponse,
  localDay,
  localDayStart,
  matchesAiResolution,
  matchesDay,
  matchesFirstResponse,
} from "../metrics";
import type { SendoAdapter } from "../types";
import type { MemoryState } from "./index";

/**
 * The `sendo_metrics_*` views computed from the memory state (see `metrics/sql.ts` for the
 * definitions). Each method recomputes from scratch: memory datasets are small.
 */

interface ConvInfo {
  conversation: Conversation;
  timezone: string;
  tagIds: string[];
  closedAt: Date | null;
  messages: Message[];
}

const DEFAULT_TIMEZONE = "America/Guatemala";

/** Not a note, a draft or a history import. */
const isCounted = (m: Message): boolean => !m.internal && !m.draft && m.metadata.imported !== true;

const compareMessages = (a: Message, b: Message): number =>
  a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function conversations(state: MemoryState): ConvInfo[] {
  const byConversation = new Map<string, Message[]>();
  for (const m of state.messages.values()) {
    const list = byConversation.get(m.conversationId);
    if (list) list.push(m);
    else byConversation.set(m.conversationId, [m]);
  }
  const tags = new Map<string, string[]>();
  for (const row of state.conversationTags.values()) {
    const list = tags.get(row.conversationId);
    if (list) list.push(row.tagId);
    else tags.set(row.conversationId, [row.tagId]);
  }
  const out: ConvInfo[] = [];
  for (const c of state.conversations.values()) {
    const account: Account | undefined = state.accounts.get(c.accountId);
    const messages = (byConversation.get(c.id) ?? []).sort(compareMessages);
    let closedAt: Date | null = null;
    if (c.status === "closed") {
      for (const m of messages) {
        if (m.internal && m.metadata.event === "closed") closedAt = m.createdAt;
      }
      closedAt ??= c.lastActivityAt;
    }
    out.push({
      conversation: c,
      timezone: account?.timezone ?? DEFAULT_TIMEZONE,
      tagIds: [...(tags.get(c.id) ?? [])].sort(),
      closedAt,
      messages,
    });
  }
  return out;
}

const scopeOf = (info: ConvInfo) => ({
  tenantId: info.conversation.tenantId,
  accountId: info.conversation.accountId,
  channel: info.conversation.channel,
  tagIds: info.tagIds,
});

function firstResponses(infos: ConvInfo[]): (FirstResponseViewRow & { timezone: string })[] {
  const rows: (FirstResponseViewRow & { timezone: string })[] = [];
  for (const info of infos) {
    const c = info.conversation;
    const firstIn = info.messages.find((m) => m.direction === "in" && isCounted(m));
    if (!firstIn) continue;
    const reply = info.messages.find(
      (m) =>
        m.direction === "out" &&
        (m.sender === "agent" || m.sender === "human") &&
        isCounted(m) &&
        m.createdAt.getTime() > firstIn.createdAt.getTime(),
    );
    const responder = reply?.sender === "agent" || reply?.sender === "human" ? reply.sender : null;
    rows.push({
      ...scopeOf(info),
      timezone: info.timezone,
      conversationId: c.id,
      contactId: c.contactId,
      assignedTo: c.assignedTo,
      source: c.source,
      day: localDay(firstIn.createdAt, info.timezone),
      firstInboundAt: firstIn.createdAt,
      firstResponseAt: reply?.createdAt ?? null,
      responder,
      responderRef: reply ? reply.senderRef : null,
      seconds: reply ? (reply.createdAt.getTime() - firstIn.createdAt.getTime()) / 1000 : null,
    });
  }
  return rows;
}

/** Accumulates day-grain rows keyed by their grain. */
function bucket<R>(make: () => R) {
  const rows = new Map<string, R>();
  return {
    at(key: unknown[]): R {
      const k = JSON.stringify(key);
      let row = rows.get(k);
      if (!row) {
        row = make();
        rows.set(k, row);
      }
      return row;
    },
    values: () => [...rows.values()],
  };
}

function dayGrain(info: ConvInfo, at: Date) {
  const day = localDay(at, info.timezone);
  return { ...scopeOf(info), day, dayStart: localDayStart(day, info.timezone) };
}

function dailyRows(infos: ConvInfo[]): DailyViewRow[] {
  const rows = new Map<string, DailyViewRow>();
  const row = (info: ConvInfo, at: Date): DailyViewRow => {
    const grain = dayGrain(info, at);
    const key = JSON.stringify([grain.accountId, grain.channel, grain.day, grain.tagIds]);
    let r = rows.get(key);
    if (!r) {
      r = {
        ...grain,
        inbound: 0,
        outbound: 0,
        conversationsStarted: 0,
        conversationsClosed: 0,
        costCents: 0,
        tokensIn: 0,
        tokensOut: 0,
      };
      rows.set(key, r);
    }
    return r;
  };
  for (const info of infos) {
    for (const m of info.messages) {
      const r = row(info, m.createdAt);
      if (isCounted(m)) {
        if (m.direction === "in") r.inbound++;
        else r.outbound++;
      }
      r.costCents += m.costCents ?? 0;
      r.tokensIn += m.tokensIn ?? 0;
      r.tokensOut += m.tokensOut ?? 0;
    }
    row(info, info.conversation.createdAt).conversationsStarted++;
    if (info.closedAt) row(info, info.closedAt).conversationsClosed++;
  }
  return [...rows.values()];
}

function assigneeRows(infos: ConvInfo[]): AssigneeViewRow[] {
  const acc = bucket(() => ({
    row: null as AssigneeViewRow | null,
    conversations: new Set<string>(),
  }));
  const row = (info: ConvInfo, at: Date, sender: "agent" | "human", assignee: string | null) => {
    const grain = dayGrain(info, at);
    const entry = acc.at([
      grain.accountId,
      grain.channel,
      grain.day,
      sender,
      assignee,
      grain.tagIds,
    ]);
    entry.row ??= {
      ...grain,
      sender,
      assignee,
      conversations: 0,
      messagesSent: 0,
      firstResponses: 0,
      firstResponseSeconds: [],
      costCents: 0,
      tokensIn: 0,
      tokensOut: 0,
      turns: 0,
    };
    return entry;
  };
  for (const info of infos) {
    for (const m of info.messages) {
      if (m.direction !== "out" || (m.sender !== "agent" && m.sender !== "human")) continue;
      if (m.internal || m.metadata.imported === true) continue;
      const entry = row(info, m.createdAt, m.sender, m.senderRef);
      const r = entry.row;
      if (!r) continue;
      if (!m.draft) {
        r.messagesSent++;
        entry.conversations.add(m.conversationId);
        r.conversations = entry.conversations.size;
      }
      r.costCents += m.costCents ?? 0;
      r.tokensIn += m.tokensIn ?? 0;
      r.tokensOut += m.tokensOut ?? 0;
      if (m.costCents !== null || m.tokensIn !== null || m.tokensOut !== null) r.turns++;
    }
  }
  const byId = new Map(infos.map((i) => [i.conversation.id, i]));
  for (const fr of firstResponses(infos)) {
    const info = byId.get(fr.conversationId);
    if (!info || !fr.firstResponseAt || !fr.responder || fr.seconds === null) continue;
    const r = row(info, fr.firstResponseAt, fr.responder, fr.responderRef).row;
    if (!r) continue;
    r.firstResponses++;
    r.firstResponseSeconds.push(fr.seconds);
  }
  return acc.values().flatMap((entry) => {
    if (!entry.row) return [];
    entry.row.firstResponseSeconds.sort((a, b) => a - b);
    return [entry.row];
  });
}

function sourceRows(infos: ConvInfo[]): SourceViewRow[] {
  const acc = bucket(() => ({ row: null as SourceViewRow | null }));
  for (const info of infos) {
    const grain = dayGrain(info, info.conversation.createdAt);
    const source = info.conversation.source;
    const entry = acc.at([grain.accountId, grain.channel, source, grain.day, grain.tagIds]);
    entry.row ??= { ...grain, source, conversations: 0 };
    entry.row.conversations++;
  }
  return acc.values().flatMap((e) => (e.row ? [e.row] : []));
}

function aiResolutionRows(infos: ConvInfo[]): AiResolutionViewRow[] {
  const rows: AiResolutionViewRow[] = [];
  for (const info of infos) {
    if (!info.closedAt) continue;
    const c = info.conversation;
    const sent = info.messages.filter((m) => m.direction === "out" && isCounted(m));
    const humanMessages = sent.filter((m) => m.sender === "human").length;
    rows.push({
      ...scopeOf(info),
      conversationId: c.id,
      source: c.source,
      day: localDay(info.closedAt, info.timezone),
      createdAt: c.createdAt,
      closedAt: info.closedAt,
      everHuman: c.everHuman,
      humanMessages,
      agentMessages: sent.filter((m) => m.sender === "agent").length,
      aiResolved: !c.everHuman && humanMessages === 0,
    });
  }
  return rows;
}

const clone = <T>(value: T): T => structuredClone(value);

export function memoryMetrics(state: () => MemoryState): SendoAdapter["metrics"] {
  const run = <T>(fn: () => T): Promise<T> =>
    new Promise<T>((resolve) => {
      resolve(clone(fn()));
    });
  return {
    daily: (q) =>
      run(() => foldDaily(dailyRows(conversations(state())).filter((r) => matchesDay(r, q)))),
    byAssignee: (q) =>
      run(() =>
        foldByAssignee(assigneeRows(conversations(state())).filter((r) => matchesDay(r, q))),
      ),
    cost: (q) =>
      run(() => foldCost(assigneeRows(conversations(state())).filter((r) => matchesDay(r, q)))),
    bySource: (q) =>
      run(() => foldBySource(sourceRows(conversations(state())).filter((r) => matchesDay(r, q)))),
    firstResponse: (q) =>
      run(() =>
        foldFirstResponse(
          firstResponses(conversations(state()))
            .filter((r) => matchesFirstResponse(r, q))
            .map(({ timezone: _timezone, ...r }) => r),
        ),
      ),
    aiResolution: (q) =>
      run(() =>
        foldAiResolution(
          aiResolutionRows(conversations(state())).filter((r) => matchesAiResolution(r, q)),
        ),
      ),
  };
}
