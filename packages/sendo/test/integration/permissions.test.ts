/**
 * Product spec 3.4 "Roles": the actor (AC-RL-1) and the permission matrix (AC-RL-2).
 * Security boundary, exercised through the public `sendo.actor`, the exported checks and real
 * conversations stored by the memory adapter. SND-3.2 extends this file so every row also runs
 * through the public `inbox.*` / `conversations.*` methods.
 *
 * Ways it could fail (one test each):
 * [AC-RL-1a] `resolveRole` not configured, yet `sendo.actor` returns an actor (fail open).
 * [AC-RL-1b] `resolveRole` returns `null` (no access), yet an actor is returned.
 * [AC-RL-1c] `resolveRole` returns a role outside agent/supervisor/admin, and it is accepted.
 * [AC-RL-1d] The actor loses the user, the tenant or the queues the app returned.
 * [AC-RL-2a] A role is granted a capability the AC-RL-2 table does not give it, or denied one it does.
 * [AC-RL-2b] A denial is not a typed `FORBIDDEN` SendoError carrying `{ capability, role }`.
 * [AC-RL-2c] An agent sees a conversation assigned to someone else, in a queue that is not theirs,
 *            or in another tenant; or does not see their own / unassigned-in-queue ones.
 * [AC-RL-2d] A supervisor or admin sees another tenant's conversation, or misses one in their own.
 * [AC-RL-2e] An untyped caller passing an unknown role or capability is granted access.
 *
 * The same matrix through the public `sendo.inbox.*` / `sendo.conversations.*` (SND-3.2), for
 * the three roles, on the memory adapter with msw for Meta:
 * [AC-RL-2f] An agent lists, counts or opens a conversation that is not theirs and not
 *            unassigned in their queues (or the general queue); or misses one that is.
 * [AC-RL-2g] A supervisor or admin misses a conversation of their tenant; anyone reaches
 *            another tenant's conversation (it must be "not found", not even FORBIDDEN).
 * [AC-RL-2h] Reply, note, tag or draft approval is refused on a visible conversation, or allowed
 *            on one the actor can't see.
 * [AC-RL-2i] Take (unassigned), return to the AI or close is refused on a visible conversation.
 * [AC-RL-2j] An agent reassigns to someone else, unassigns, or pauses the AI (needs
 *            `conversations.reassign` / `conversations.pause_agent`); a supervisor or admin can't.
 * [AC-RL-2k] Anyone but an admin (`costs.view`) reads usage or cost in the thread.
 * [AC-RL-2l] An agent keeps acting on a conversation reassigned away from them.
 * [AC-RL-2m] An inbox call without a resolved actor (missing, or a forged role) is allowed.
 * Rows "reports and metrics" and the admin-only row (numbers, rules, AI pause per number, tenant
 * snippets, tag catalog, broadcasts) have no inbox entry point: [AC-RL-2a] checks them here and
 * their own suites check their APIs.
 */
import { describe, expect, it } from "vitest";
import {
  acceptSends,
  accountInput,
  makeClient,
  openConversation,
  useGraphServer,
} from "../../src/core/test-utils";
import { ForbiddenError } from "../../src/errors/errors";
import { isSendoError } from "../../src/errors/base";
import {
  assertCan,
  can,
  canSeeConversation,
  type Actor,
  type Capability,
  type Role,
} from "../../src/team/permissions";
import type { ResolveRole } from "../../src/team/config";
import type { Conversation } from "../../src/types/entities";
import { createHarness } from "./harness";

const graph = useGraphServer();

/** AC-RL-2, transcribed from the product spec table (not from the implementation). */
const EXPECTED: Record<Capability, Record<Role, boolean>> = {
  "conversations.view_all": { agent: false, supervisor: true, admin: true },
  "conversations.reassign": { agent: false, supervisor: true, admin: true },
  "conversations.pause_agent": { agent: false, supervisor: true, admin: true },
  "metrics.view": { agent: false, supervisor: true, admin: true },
  "costs.view": { agent: false, supervisor: false, admin: true },
  "numbers.manage": { agent: false, supervisor: false, admin: true },
  "rules.manage": { agent: false, supervisor: false, admin: true },
  "snippets.manage_tenant": { agent: false, supervisor: false, admin: true },
  "tags.manage": { agent: false, supervisor: false, admin: true },
  "broadcasts.manage": { agent: false, supervisor: false, admin: true },
};
const ROLES: Role[] = ["agent", "supervisor", "admin"];

const DIRECTORY: Record<string, { role: Role; queues?: string[] }> = {
  "tenant-a:ana": { role: "agent", queues: ["cobranza"] },
  "tenant-a:sofia": { role: "supervisor" },
  "tenant-a:alma": { role: "admin" },
};

const resolveRole: ResolveRole = ({ userId, tenantId }) =>
  Promise.resolve(DIRECTORY[`${tenantId ?? ""}:${userId}`] ?? null);

async function forbidden(promise: Promise<unknown>): Promise<ForbiddenError> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isSendoError(error)).toBe(true);
  expect(error).toBeInstanceOf(ForbiddenError);
  return error as ForbiddenError;
}

describe("sendo.actor (AC-RL-1)", () => {
  it("[AC-RL-1a] fails closed with FORBIDDEN when resolveRole is not configured", async () => {
    const { sendo } = makeClient();
    const error = await forbidden(sendo.actor("ana", "tenant-a"));
    expect(error.code).toBe("FORBIDDEN");
    expect(error.toJSON()).toMatchObject({ code: "FORBIDDEN", capability: null, role: null });
  });

  it("[AC-RL-1b] a null role means no access: FORBIDDEN, even for a user known in another tenant", async () => {
    const { sendo } = makeClient({ resolveRole });
    const error = await forbidden(sendo.actor("ana", "tenant-b"));
    expect(error.code).toBe("FORBIDDEN");
    await forbidden(sendo.actor("nadie", "tenant-a"));
  });

  it("[AC-RL-1c] an unknown role from the app is rejected", async () => {
    const owner = (() => Promise.resolve({ role: "owner" })) as unknown as ResolveRole;
    const { sendo } = makeClient({ resolveRole: owner });
    const error = await forbidden(sendo.actor("ana", "tenant-a"));
    expect(error.role).toBeNull();
  });

  it("[AC-RL-1d] the actor carries the user, the tenant, the role and the queues", async () => {
    const seen: unknown[] = [];
    const { sendo } = makeClient({
      resolveRole: (input) => {
        seen.push(input);
        return resolveRole(input);
      },
    });
    await expect(sendo.actor("ana", "tenant-a")).resolves.toEqual({
      userId: "ana",
      tenantId: "tenant-a",
      role: "agent",
      queues: ["cobranza"],
    });
    await expect(sendo.actor("sofia", "tenant-a")).resolves.toMatchObject({
      role: "supervisor",
      queues: [],
    });
    expect(seen).toEqual([
      { userId: "ana", tenantId: "tenant-a" },
      { userId: "sofia", tenantId: "tenant-a" },
    ]);
  });
});

describe("permission matrix (AC-RL-2)", () => {
  async function actors() {
    const { sendo } = makeClient({ resolveRole });
    return {
      agent: await sendo.actor("ana", "tenant-a"),
      supervisor: await sendo.actor("sofia", "tenant-a"),
      admin: await sendo.actor("alma", "tenant-a"),
    } satisfies Record<Role, Actor>;
  }

  it("[AC-RL-2a] every role × capability matches the product spec table", async () => {
    const byRole = await actors();
    const actual = Object.fromEntries(
      Object.keys(EXPECTED).map((capability) => [
        capability,
        Object.fromEntries(
          ROLES.map((role) => [role, can(byRole[role], capability as Capability)]),
        ),
      ]),
    );
    expect(actual).toEqual(EXPECTED);
  });

  it("[AC-RL-2b] assertCan throws a typed FORBIDDEN with { capability, role } on every denial", async () => {
    const byRole = await actors();
    for (const [capability, grants] of Object.entries(EXPECTED) as [
      Capability,
      Record<Role, boolean>,
    ][]) {
      for (const role of ROLES) {
        if (grants[role]) {
          expect(() => {
            assertCan(byRole[role], capability);
          }).not.toThrow();
          continue;
        }
        let error: unknown;
        try {
          assertCan(byRole[role], capability);
        } catch (e) {
          error = e;
        }
        expect(isSendoError(error)).toBe(true);
        expect((error as ForbiddenError).toJSON()).toMatchObject({
          code: "FORBIDDEN",
          capability,
          role,
        });
      }
    }
  });

  async function conversations() {
    const { sendo, ctx, adapter } = makeClient({ resolveRole });
    const accountA = await adapter.accounts.insert(accountInput());
    const accountB = await adapter.accounts.insert(
      accountInput({ tenantId: "tenant-b", phoneNumberId: "PN_B", wabaId: "WABA_B" }),
    );
    const open = async (phone: string, assignee: string | null, queue: string | null) => {
      const { conversation } = await openConversation(ctx, accountA, phone);
      const assigned =
        assignee === null
          ? conversation
          : await sendo.conversations.assign(conversation.id, assignee);
      return { ...assigned, queue } satisfies Conversation;
    };
    const otherTenant = (await openConversation(ctx, accountB, "+50255550009")).conversation;
    return {
      sendo,
      mine: await open("+50255550001", "ana", null),
      othersAssigned: await open("+50255550002", "beto", "cobranza"),
      unassignedMyQueue: await open("+50255550003", null, "cobranza"),
      unassignedOtherQueue: await open("+50255550004", null, "ventas"),
      unassignedNoQueue: await open("+50255550005", null, null),
      otherTenant: { ...otherTenant, queue: null } satisfies Conversation,
    };
  }

  it("[AC-RL-2c] agents see their own and unassigned conversations in their queues only", async () => {
    const c = await conversations();
    const agent = await c.sendo.actor("ana", "tenant-a");
    expect(c.mine.assignedTo).toBe("ana");
    expect({
      mine: canSeeConversation(agent, c.mine),
      othersAssigned: canSeeConversation(agent, c.othersAssigned),
      unassignedMyQueue: canSeeConversation(agent, c.unassignedMyQueue),
      unassignedOtherQueue: canSeeConversation(agent, c.unassignedOtherQueue),
      unassignedNoQueue: canSeeConversation(agent, c.unassignedNoQueue),
      otherTenant: canSeeConversation(agent, c.otherTenant),
    }).toEqual({
      mine: true,
      othersAssigned: false,
      unassignedMyQueue: true,
      unassignedOtherQueue: false,
      unassignedNoQueue: true,
      otherTenant: false,
    });
  });

  it("[AC-RL-2d] supervisors and admins see every conversation of their tenant and none of another", async () => {
    const c = await conversations();
    for (const userId of ["sofia", "alma"]) {
      const actor = await c.sendo.actor(userId, "tenant-a");
      for (const conversation of [
        c.mine,
        c.othersAssigned,
        c.unassignedMyQueue,
        c.unassignedOtherQueue,
        c.unassignedNoQueue,
      ]) {
        expect(canSeeConversation(actor, conversation)).toBe(true);
      }
      expect(canSeeConversation(actor, c.otherTenant)).toBe(false);
    }
  });

  it("[AC-RL-2e] unknown roles and capabilities from untyped callers are never granted", async () => {
    const c = await conversations();
    const forged = { userId: "ana", tenantId: "tenant-a", role: "root", queues: ["cobranza"] };
    const actor = forged as unknown as Actor;
    for (const capability of Object.keys(EXPECTED) as Capability[]) {
      expect(can(actor, capability)).toBe(false);
    }
    expect(canSeeConversation(actor, c.unassignedMyQueue)).toBe(false);
    const admin = await c.sendo.actor("alma", "tenant-a");
    expect(can(admin, "everything" as Capability)).toBe(false);
    expect(() => {
      assertCan(admin, "__proto__" as Capability);
    }).toThrow(ForbiddenError);
  });
});

describe("permission matrix through sendo.inbox and sendo.conversations (AC-RL-2)", () => {
  const VISIBLE_TO_ANA = ["mine", "myQueue", "noQueue"] as const;
  const HIDDEN_FROM_ANA = ["others", "otherQueue"] as const;
  type Slot = (typeof VISIBLE_TO_ANA)[number] | (typeof HIDDEN_FROM_ANA)[number];

  async function scenario() {
    graph.server.use(acceptSends());
    const h = await createHarness({ resolveRole, handoffMessage: null });
    const tenantB = await h.adapter.accounts.insert(
      accountInput({ tenantId: "tenant-b", phoneNumberId: "PN_B", wabaId: "WABA_B" }),
    );
    const open = async (phone: string, assignee: string | null, queue: string | null) => {
      const { conversation } = await openConversation(h.ctx, h.account, phone);
      if (assignee !== null) await h.sendo.conversations.assign(conversation.id, assignee);
      const updated = await h.adapter.conversations.update(conversation.id, { queue });
      // A pending agent draft and a priced agent reply on every conversation.
      for (const draft of [false, true]) {
        await h.adapter.messages.insertOutbound({
          tenantId: updated.tenantId,
          conversationId: updated.id,
          type: "text",
          content: { body: draft ? "borrador" : "respuesta" },
          text: draft ? "borrador" : "respuesta",
          sender: "agent",
          senderRef: "recepcion",
          draft,
          tokensIn: 100,
          tokensOut: 10,
          costCents: 0.02,
        });
      }
      return updated.id;
    };
    const ids: Record<Slot, string> = {
      mine: await open("+50255550001", "ana", null),
      others: await open("+50255550002", "beto", "cobranza"),
      myQueue: await open("+50255550003", null, "cobranza"),
      otherQueue: await open("+50255550004", null, "ventas"),
      noQueue: await open("+50255550005", null, null),
    };
    const foreign = (await openConversation(h.ctx, tenantB, "+50255550009")).conversation.id;
    const actors: Record<Role, Actor> = {
      agent: await h.sendo.actor("ana", "tenant-a"),
      supervisor: await h.sendo.actor("sofia", "tenant-a"),
      admin: await h.sendo.actor("alma", "tenant-a"),
    };
    const draftOf = (conversationId: string) => {
      const draft = [...h.adapter.__state.messages.values()].find(
        (m) => m.conversationId === conversationId && m.draft,
      );
      if (!draft) throw new Error("no draft");
      return draft.id;
    };
    return { ...h, ids, foreign, actors, draftOf };
  }

  async function outcome(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
      return "ok";
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return error.capability === null ? "FORBIDDEN" : `FORBIDDEN:${error.capability}`;
      }
      if (isSendoError(error)) return error.code;
      throw error;
    }
  }

  it("[AC-RL-2f] agents list, count and open only their own and unassigned-in-queue conversations", async () => {
    const c = await scenario();
    const actor = c.actors.agent;
    const listed = (await c.sendo.inbox.list({ actor })).items.map((i) => i.id);
    expect(new Set(listed)).toEqual(new Set(VISIBLE_TO_ANA.map((slot) => c.ids[slot])));
    expect(await c.sendo.inbox.count({ actor })).toBe(VISIBLE_TO_ANA.length);
    expect((await c.sendo.inbox.list({ actor, mine: true })).items.map((i) => i.id)).toEqual([
      c.ids.mine,
    ]);
    for (const slot of VISIBLE_TO_ANA) {
      expect(await outcome(c.sendo.inbox.thread(c.ids[slot], { actor })), slot).toBe("ok");
    }
    for (const slot of HIDDEN_FROM_ANA) {
      expect(await outcome(c.sendo.inbox.thread(c.ids[slot], { actor })), slot).toBe("FORBIDDEN");
      expect(await outcome(c.sendo.inbox.get(c.ids[slot], { actor })), slot).toBe("FORBIDDEN");
    }
  });

  it("[AC-RL-2g] supervisors and admins see the whole tenant; nobody reaches another tenant", async () => {
    const c = await scenario();
    for (const role of ["supervisor", "admin"] as const) {
      const actor = c.actors[role];
      const listed = (await c.sendo.inbox.list({ actor })).items.map((i) => i.id);
      expect(new Set(listed), role).toEqual(new Set(Object.values(c.ids)));
      expect(await c.sendo.inbox.count({ actor })).toBe(5);
      expect(await outcome(c.sendo.inbox.thread(c.ids.others, { actor }))).toBe("ok");
    }
    for (const role of ROLES) {
      const actor = c.actors[role];
      expect(await outcome(c.sendo.inbox.thread(c.foreign, { actor })), role).toBe(
        "RECORD_NOT_FOUND",
      );
      expect(await outcome(c.sendo.inbox.note(c.foreign, "x", { actor })), role).toBe(
        "RECORD_NOT_FOUND",
      );
    }
  });

  it("[AC-RL-2h] every role replies, notes, tags and approves drafts on visible conversations only", async () => {
    for (const role of ROLES) {
      const c = await scenario();
      const actor = c.actors[role];
      const tag = await c.adapter.tags.upsert({ tenantId: "tenant-a", name: "VIP", color: "red" });
      const visible = c.ids.myQueue;
      const ops = (id: string) => ({
        reply: c.sendo.inbox.reply(id, { kind: "text", body: "Hola" }, { actor }),
        note: c.sendo.inbox.note(id, "nota", { actor }),
        tag: c.sendo.inbox.tags.add(id, tag.id, { actor }),
        untag: c.sendo.inbox.tags.remove(id, tag.id, { actor }),
      });
      const results = async (id: string) =>
        Object.fromEntries(
          await Promise.all(
            Object.entries(ops(id)).map(async ([name, p]) => [name, await outcome(p)] as const),
          ),
        );
      expect(await results(visible), role).toEqual({
        reply: "ok",
        note: "ok",
        tag: "ok",
        untag: "ok",
      });
      // The reply above discarded myQueue's draft; approve the one on noQueue.
      expect(
        await outcome(c.sendo.inbox.approveDraft(c.draftOf(c.ids.noQueue), { actor })),
        role,
      ).toBe("ok");
      expect(
        await outcome(c.sendo.inbox.discardDraft(c.draftOf(c.ids.mine), { actor })),
        role,
      ).toBe("ok");

      const hidden = c.ids.others;
      const expected = role === "agent" ? "FORBIDDEN" : "ok";
      expect(await results(hidden), role).toEqual({
        reply: expected,
        note: expected,
        tag: expected,
        untag: expected,
      });
      expect(
        await outcome(c.sendo.inbox.approveDraft(c.draftOf(c.ids.otherQueue), { actor })),
        role,
      ).toBe(expected);
    }
  });

  it("[AC-RL-2i] every role takes unassigned conversations, returns them to the AI and closes them", async () => {
    for (const role of ROLES) {
      const c = await scenario();
      const actor = c.actors[role];
      const taken = await c.sendo.inbox.take(c.ids.myQueue, { actor });
      expect(taken, role).toMatchObject({ status: "human", assignedTo: actor.userId });
      expect(await outcome(c.sendo.inbox.returnToAgent(c.ids.myQueue, { actor })), role).toBe("ok");
      expect(await outcome(c.sendo.inbox.close(c.ids.noQueue, { actor })), role).toBe("ok");
      expect(await outcome(c.sendo.inbox.markSeen(c.ids.noQueue, { actor })), role).toBe("ok");
      const hidden = role === "agent" ? "FORBIDDEN" : "ok";
      expect(await outcome(c.sendo.inbox.close(c.ids.otherQueue, { actor })), role).toBe(hidden);
    }
  });

  it("[AC-RL-2j] only supervisors and admins reassign and pause the AI on a conversation", async () => {
    for (const role of ROLES) {
      const c = await scenario();
      const actor = c.actors[role];
      const results = {
        assignOther: await outcome(c.sendo.inbox.assign(c.ids.myQueue, "beto", { actor })),
        unassign: await outcome(c.sendo.inbox.assign(c.ids.mine, null, { actor })),
        takeFromOther: await outcome(c.sendo.inbox.take(c.ids.others, { actor })),
        assignSelf: await outcome(c.sendo.inbox.assign(c.ids.noQueue, actor.userId, { actor })),
        pause: await outcome(c.sendo.inbox.pauseAgent(c.ids.mine, true, { actor })),
      };
      expect(results, role).toEqual(
        role === "agent"
          ? {
              assignOther: "FORBIDDEN:conversations.reassign",
              unassign: "FORBIDDEN:conversations.reassign",
              takeFromOther: "FORBIDDEN",
              assignSelf: "ok",
              pause: "FORBIDDEN:conversations.pause_agent",
            }
          : {
              assignOther: "ok",
              unassign: "ok",
              takeFromOther: "ok",
              assignSelf: "ok",
              pause: "ok",
            },
      );
    }
  });

  it("[AC-RL-2k] only admins read usage and cost (costs.view)", async () => {
    const c = await scenario();
    for (const role of ROLES) {
      const actor = c.actors[role];
      const reply = (await c.sendo.inbox.thread(c.ids.mine, { actor })).items.find(
        (m) => m.text === "respuesta",
      );
      expect(reply, role).toMatchObject(
        role === "admin"
          ? { tokensIn: 100, tokensOut: 10, costCents: 0.02 }
          : { tokensIn: null, tokensOut: null, costCents: null },
      );
    }
  });

  it("[AC-RL-2l] an agent can't act on a conversation reassigned away from them", async () => {
    const c = await scenario();
    const ana = c.actors.agent;
    expect(await outcome(c.sendo.inbox.note(c.ids.mine, "mía", { actor: ana }))).toBe("ok");
    await c.sendo.inbox.assign(c.ids.mine, "beto", { actor: c.actors.supervisor });
    for (const op of [
      c.sendo.inbox.reply(c.ids.mine, { kind: "text", body: "hola" }, { actor: ana }),
      c.sendo.inbox.note(c.ids.mine, "otra", { actor: ana }),
      c.sendo.inbox.take(c.ids.mine, { actor: ana }),
      c.sendo.inbox.thread(c.ids.mine, { actor: ana }),
      c.sendo.inbox.markSeen(c.ids.mine, { actor: ana }),
    ]) {
      expect(await outcome(op)).toBe("FORBIDDEN");
    }
  });

  it("[AC-RL-2m] inbox calls fail closed without a resolved actor", async () => {
    const c = await scenario();
    const forged = { userId: "ana", tenantId: "tenant-a", role: "root", queues: [] };
    for (const actor of [undefined, null, forged, { userId: "", tenantId: "tenant-a" }]) {
      expect(await outcome(c.sendo.inbox.list({ actor: actor as unknown as Actor }))).toBe(
        "FORBIDDEN",
      );
      expect(
        await outcome(c.sendo.inbox.thread(c.ids.mine, { actor: actor as unknown as Actor })),
      ).toBe("FORBIDDEN");
    }
  });
});
