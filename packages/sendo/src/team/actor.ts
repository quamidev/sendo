import type { SendoContext } from "../core/context";
import { ForbiddenError } from "../errors/errors";
import type { TenantId } from "../types/entities";
import { isRole, type Actor } from "./permissions";

export type ActorResolver = (userId: string, tenantId: TenantId) => Promise<Actor>;

/**
 * `sendo.actor(userId, tenantId)`. Fails closed: throws `ForbiddenError` when
 * `resolveRole` is not configured, returns `null`, or returns an unknown role.
 */
export function createActorResolver(ctx: Pick<SendoContext, "team">): ActorResolver {
  return async (userId, tenantId) => {
    const resolveRole = ctx.team.resolveRole;
    if (resolveRole === null) {
      throw new ForbiddenError({
        message: "Access denied: `resolveRole` is not configured.",
      });
    }
    if (typeof userId !== "string" || userId.trim() === "") {
      throw new ForbiddenError({ message: "Access denied: no user." });
    }
    const resolved = await resolveRole({ userId, tenantId });
    if (resolved === null || typeof resolved !== "object" || !isRole(resolved.role)) {
      throw new ForbiddenError({ message: "Access denied: the user has no role in this tenant." });
    }
    const queues = Array.isArray(resolved.queues)
      ? resolved.queues.filter((queue): queue is string => typeof queue === "string")
      : [];
    return { userId, tenantId, role: resolved.role, queues };
  };
}
