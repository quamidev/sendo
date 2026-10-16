/**
 * Product spec — Acceptance Criteria — "Inbox (registry)", server-side half (sendo.inbox and the
 * sendo.conversations calls the inbox server actions make). UI criteria are covered by the RTL tests
 * in registry/items/inbox.
 *
 * [AC-IN-1] The conversation list is filterable by status and by "assigned to me", and sorted by
 *           last activity.
 * [AC-IN-5] A user only sees their own tenant's conversations (server-side tenant guard; the RLS
 *           half via sendo_can_access_tenant needs Supabase).
 * [AC-IN-3] Reply works in each window state: free-form while open, only templates when closed.
 * [AC-IN-4] Tomar / Devolver al agente / Cerrar change the status and emit `conversation.status`
 *           (the event and row change the realtime layer broadcasts).
 *
 * Every call goes through the actor-based API (SND-3.2); the role checks themselves are in
 * permissions.test.ts and the team operations in inbox-team.test.ts.
 */
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import type { ConversationStatusEvent } from "../../src/core/events";
import {
  GRAPH,
  acceptSends,
  accountInput,
  openConversation,
  useGraphServer,
} from "../../src/core/test-utils";
import { RecordNotFoundError, WindowClosedError } from "../../src/errors/errors";
import type { Actor } from "../../src/team/permissions";
import { FIXTURE_IDS } from "../support/fixtures";
import { createHarness, freshFixture } from "./harness";

const graph = useGraphServer();

const SUPERVISOR_A: Actor = {
  userId: "user-me",
  tenantId: "tenant-a",
  role: "supervisor",
  queues: [],
};
const SUPERVISOR_B: Actor = {
  userId: "user-b",
  tenantId: "tenant-b",
  role: "supervisor",
  queues: [],
};
const LUIS: Actor = { userId: "user-luis", tenantId: "tenant-a", role: "agent", queues: [] };

async function seeded() {
  const h = await createHarness();
  const tenantB = await h.adapter.accounts.insert(
    accountInput({
      tenantId: "tenant-b",
      phoneNumberId: FIXTURE_IDS.secondPhoneNumberId,
      wabaId: FIXTURE_IDS.secondWabaId,
      tokenRef: "SENDO_TOKEN_B",
    }),
  );
  const make = async (account: typeof h.account, phone: string, activityMinutesAgo: number) => {
    const { conversation } = await openConversation(h.ctx, account, phone);
    return h.adapter.conversations.update(conversation.id, {
      lastActivityAt: new Date(Date.now() - activityMinutesAgo * 60_000),
    });
  };
  const agentOld = await make(h.account, "+50255550001", 30);
  const mine = await make(h.account, "+50255550002", 20);
  const theirs = await make(h.account, "+50255550003", 10);
  const closed = await make(h.account, "+50255550004", 5);
  const otherTenant = await make(tenantB, "+50255550001", 1);
  await h.sendo.conversations.assign(mine.id, "user-me");
  await h.sendo.conversations.assign(theirs.id, "user-other");
  await h.sendo.conversations.close(closed.id);
  // assign/close touch activity; pin the order again.
  for (const [c, minutes] of [
    [agentOld, 30],
    [mine, 20],
    [theirs, 10],
    [closed, 5],
    [otherTenant, 1],
  ] as const) {
    await h.adapter.conversations.update(c.id, {
      lastActivityAt: new Date(Date.now() - minutes * 60_000),
    });
  }
  return {
    ...h,
    tenantB,
    ids: {
      agentOld: agentOld.id,
      mine: mine.id,
      theirs: theirs.id,
      closed: closed.id,
      otherTenant: otherTenant.id,
    },
  };
}

describe("Inbox server operations", () => {
  it("[AC-IN-1] filters by status and assignee and sorts by last activity (newest first)", async () => {
    const h = await seeded();
    const ids = async (query: Omit<Parameters<typeof h.sendo.inbox.list>[0], "actor">) =>
      (await h.sendo.inbox.list({ actor: SUPERVISOR_A, ...query })).items.map((c) => c.id);

    expect(await ids({})).toEqual([h.ids.closed, h.ids.theirs, h.ids.mine, h.ids.agentOld]);
    expect(await ids({ status: "human" })).toEqual([h.ids.theirs, h.ids.mine]);
    expect(await ids({ status: "agent" })).toEqual([h.ids.agentOld]);
    expect(await ids({ status: "closed" })).toEqual([h.ids.closed]);
    expect(await ids({ status: ["agent", "human"] })).toEqual([
      h.ids.theirs,
      h.ids.mine,
      h.ids.agentOld,
    ]);
    expect(await ids({ assignedTo: "user-me" })).toEqual([h.ids.mine]);
    expect(await ids({ status: "human", assignedTo: "user-me" })).toEqual([h.ids.mine]);
    expect(await ids({ mine: true })).toEqual([h.ids.mine]);
    expect(await h.sendo.inbox.count({ actor: SUPERVISOR_A, status: "human" })).toBe(2);

    const first = await h.sendo.inbox.list({ actor: SUPERVISOR_A, limit: 2 });
    const second = await h.sendo.inbox.list({
      actor: SUPERVISOR_A,
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect([...first.items, ...second.items].map((c) => c.id)).toEqual(await ids({}));
  });

  it("[AC-IN-5] a tenant only sees and touches its own conversations", async () => {
    const h = await seeded();
    const a = (await h.sendo.inbox.list({ actor: SUPERVISOR_A })).items.map((c) => c.tenantId);
    const b = (await h.sendo.inbox.list({ actor: SUPERVISOR_B })).items.map((c) => c.id);
    expect(new Set(a)).toEqual(new Set(["tenant-a"]));
    expect(b).toEqual([h.ids.otherTenant]);

    const foreign = h.ids.otherTenant;
    const actor = { actor: SUPERVISOR_A };
    for (const call of [
      () => h.sendo.inbox.thread(foreign, actor),
      () => h.sendo.inbox.get(foreign, actor),
      () => h.sendo.inbox.markSeen(foreign, actor),
      () => h.sendo.inbox.reply(foreign, { kind: "text", body: "hola" }, actor),
      () => h.sendo.inbox.note(foreign, "nota", actor),
      () => h.sendo.inbox.take(foreign, actor),
      () => h.sendo.inbox.close(foreign, actor),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(RecordNotFoundError);
    }
    expect(graph.requests).toHaveLength(0);
    await expect(h.sendo.inbox.thread(foreign, { actor: SUPERVISOR_B })).resolves.toMatchObject({
      items: [],
    });
  });

  it("[AC-IN-3] replies free-form while the window is open, and only with templates once it closes", async () => {
    const sent: unknown[] = [];
    graph.server.use(
      acceptSends(sent),
      http.get(`${GRAPH}/${FIXTURE_IDS.wabaId}/message_templates`, () =>
        HttpResponse.json({
          data: [
            {
              id: "T1",
              name: "seguimiento",
              language: "es",
              status: "APPROVED",
              category: "UTILITY",
              components: [{ type: "BODY", text: "Hola, ¿seguimos?" }],
            },
          ],
        }),
      ),
    );
    const h = await createHarness();
    await h.sendo.templates.sync();
    await h.deliver(freshFixture("text"));
    const conversationId = h.messages("in")[0]?.conversationId ?? "";
    const [listed] = (await h.sendo.inbox.list({ actor: LUIS })).items;
    expect(listed?.window.open).toBe(true);

    const reply = await h.sendo.inbox.reply(
      conversationId,
      { kind: "text", body: "Hola, soy Luis" },
      { actor: LUIS },
    );
    expect(reply).toMatchObject({
      sender: "human",
      senderRef: "user-luis",
      status: "sent",
      metaMessageId: "wamid.OUT1",
    });

    // Close the window: the last inbound was more than 24 h ago.
    await h.adapter.conversations.update(conversationId, {
      lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      windowExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const [closed] = (await h.sendo.inbox.list({ actor: LUIS })).items;
    expect(closed?.window.open).toBe(false);
    const before = graph.requests.length;
    await expect(
      h.sendo.inbox.reply(conversationId, { kind: "text", body: "¿Sigues ahí?" }, { actor: LUIS }),
    ).rejects.toBeInstanceOf(WindowClosedError);
    expect(graph.requests.length).toBe(before);

    const template = await h.sendo.inbox.reply(
      conversationId,
      { kind: "template", name: "seguimiento", language: "es" },
      { actor: LUIS },
    );
    expect(template).toMatchObject({ type: "template", sender: "human", status: "sent" });
    expect(sent).toHaveLength(2);

    const thread = await h.sendo.inbox.thread(conversationId, { actor: LUIS });
    expect(thread.items.map((m) => [m.direction, m.sender])).toEqual([
      ["out", "human"],
      ["out", "human"],
      ["in", "contact"],
    ]);
    await h.sendo.inbox.markSeen(conversationId, { actor: LUIS });
    expect((await h.sendo.inbox.get(conversationId, { actor: LUIS })).unreadCount).toBe(0);
  });

  it("[AC-IN-4] Tomar, Devolver al agente and Cerrar emit conversation.status", async () => {
    const h = await createHarness();
    const events: ConversationStatusEvent[] = [];
    h.sendo.on("conversation.status", (e) => {
      events.push(e);
    });
    const { conversation } = await openConversation(h.ctx, h.account, "+50255550001");

    const taken = await h.sendo.inbox.take(conversation.id, { actor: LUIS });
    expect(taken).toMatchObject({ status: "human", assignedTo: "user-luis" });
    const returned = await h.sendo.inbox.returnToAgent(conversation.id, { actor: LUIS });
    expect(returned).toMatchObject({ status: "agent", assignedTo: null });
    const closed = await h.sendo.inbox.close(conversation.id, { actor: LUIS });
    expect(closed.status).toBe("closed");

    expect(events.map((e) => [e.from, e.to, e.by, e.conversation.id])).toEqual([
      ["agent", "human", "user-luis", conversation.id],
      ["human", "agent", "user-luis", conversation.id],
      ["agent", "closed", "user-luis", conversation.id],
    ]);
    const [row] = (await h.sendo.inbox.list({ actor: SUPERVISOR_A, status: "closed" })).items;
    expect(row?.id).toBe(conversation.id);
  });
});
