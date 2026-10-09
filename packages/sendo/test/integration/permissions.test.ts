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
 */
import { describe, expect, it } from "vitest";
import { accountInput, makeClient, openConversation } from "../../src/core/test-utils";
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
