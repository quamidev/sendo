import type { SendoContext } from "../core/context";
import { rejectWith, stubNamespace } from "../core/slots";
import type { Actor } from "../team/permissions";

/** `sendo.rules` (SND-3.4). Placeholder signatures until the `StoredRule` entity lands. */
export interface RulesApi {
  list(o: { actor: Actor; accountId?: string }): Promise<unknown[]>;
  upsert(input: Record<string, unknown>, o: { actor: Actor }): Promise<unknown>;
  toggle(id: string, enabled: boolean, o: { actor: Actor }): Promise<unknown>;
  reorder(ids: string[], o: { actor: Actor }): Promise<void>;
  delete(id: string, o: { actor: Actor }): Promise<void>;
}

export interface TickOptions {
  now?: Date;
  /** Default 50 000 ms. */
  budgetMs?: number;
}

/** SND-3.4 adds the per-step counts. */
export interface TickReport {
  /** `true` when another tick holds the lock. */
  skipped: boolean;
}

/** `sendo.maintenance.tick` (SND-3.4). */
export type TickSlot = (opts?: TickOptions) => Promise<TickReport>;

/** `SENDO_MODULES` entry. Placeholder: keeps the stubs (and the no-op `ctx.rulesHooks`) until SND-3.4. */
export function installRules(ctx: SendoContext): void {
  ctx.slots.rules = stubNamespace("rules");
  ctx.slots.tick = rejectWith("sendo.maintenance.tick");
}
