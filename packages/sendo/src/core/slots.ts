import { NotImplementedError } from "../errors/errors";
import type { SendoEvent } from "../types/entities";
import type { InboxApi } from "../inbox/types";
import type { AgentApi } from "../agents/types";
import type { BroadcastsApi, ContactsApi } from "../broadcasts";
import type { MetricsApi } from "../metrics";
import type { RulesApi, TickSlot } from "../rules";
import type { SnippetsApi } from "../team/snippets";
import type { TagsApi } from "../team/tags";
import type { LinksApi } from "../widgets/links";

export interface HandleWebhookOptions {
  /** Keeps background work alive after the Response (`after()` / `ctx.waitUntil`). */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** Owned by WAL-2.7 (`src/core/pipeline/`). */
export type HandleWebhookSlot = (
  request: Request,
  opts?: HandleWebhookOptions,
) => Promise<Response>;

/** `sendo.events` (WAL-2.7, `src/core/pipeline/`). */
export interface EventsSlot {
  get(eventId: string): Promise<SendoEvent | null>;
  /**
   * Re-runs the background pipeline for a `received`, `failed` or `unrouted` event
   * (idempotent: stored messages are deduped). A `processed` event is returned as is.
   * Throws `RecordNotFoundError` for an unknown id.
   */
  reprocess(eventId: string): Promise<SendoEvent>;
}

export interface PruneOptions {
  /** Default `eventRetentionDays` (30). */
  olderThanDays?: number;
}

/** `sendo.maintenance` (WAL-2.7). */
export interface MaintenanceSlot {
  /** Deletes events received more than `olderThanDays` ago; returns the count. */
  prune(opts?: PruneOptions): Promise<number>;
}

/** The public `sendo.maintenance`: `prune` (pipeline) plus `tick` (SND-3.4). */
export interface MaintenanceApi extends MaintenanceSlot {
  tick: TickSlot;
}

/** Owned by WAL-3.2 (`src/inbox/`). */
export type InboxSlot = InboxApi;

/** Owned by WAL-3.1 (`src/agents/`). */
export type AgentSlot = AgentApi;

/**
 * Namespaces contributed by later modules. `createSendo` reads them lazily
 * (getters), so a module installed by `SENDO_MODULES` only has to assign
 * `ctx.slots.<name>`.
 */
export interface SendoSlots {
  handleWebhook: HandleWebhookSlot;
  events: EventsSlot;
  maintenance: MaintenanceSlot;
  inbox: InboxSlot;
  agent: AgentSlot;
  /** `sendo.maintenance.tick` (SND-3.4, `src/rules/`). */
  tick: TickSlot;
  snippets: SnippetsApi;
  tags: TagsApi;
  rules: RulesApi;
  links: LinksApi;
  broadcasts: BroadcastsApi;
  /** `sendo.contacts.setOptIn` (SND-4.2, `src/broadcasts/`). */
  contacts: ContactsApi;
  metrics: MetricsApi;
}

export function rejectWith(feature: string): () => Promise<never> {
  return () => Promise.reject(new NotImplementedError(feature));
}

/** Slots that are whole namespaces of async methods, stubbed until their module lands. */
export type NamespaceSlotName =
  "snippets" | "tags" | "rules" | "links" | "broadcasts" | "contacts" | "metrics";

/**
 * A `sendo.<slot>` whose every method rejects with `NotImplementedError("sendo.<slot>.<method>")`.
 * A feature ticket can grow its API interface without touching this file.
 */
export function stubNamespace<K extends NamespaceSlotName>(slot: K): SendoSlots[K] {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string" || property === "then" || property === "toJSON") {
          return undefined;
        }
        return rejectWith(`sendo.${slot}.${property}`);
      },
    },
  ) as SendoSlots[K];
}

export function createStubSlots(): SendoSlots {
  return {
    handleWebhook: rejectWith("sendo.handleWebhook"),
    events: {
      get: rejectWith("sendo.events.get"),
      reprocess: rejectWith("sendo.events.reprocess"),
    },
    maintenance: { prune: rejectWith("sendo.maintenance.prune") },
    inbox: {
      list: rejectWith("sendo.inbox.list"),
      thread: rejectWith("sendo.inbox.thread"),
      reply: rejectWith("sendo.inbox.reply"),
      markSeen: rejectWith("sendo.inbox.markSeen"),
    },
    agent: () => {
      throw new NotImplementedError("sendo.agent");
    },
    tick: rejectWith("sendo.maintenance.tick"),
    snippets: stubNamespace("snippets"),
    tags: stubNamespace("tags"),
    rules: stubNamespace("rules"),
    links: stubNamespace("links"),
    broadcasts: stubNamespace("broadcasts"),
    contacts: stubNamespace("contacts"),
    metrics: stubNamespace("metrics"),
  };
}
