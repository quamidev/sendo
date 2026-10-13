import { ConfigError, RecordNotFoundError } from "../../errors/errors";
import type { SendoEvent } from "../../types/entities";
import type { SendoContext } from "../context";
import type { EventsSlot, MaintenanceSlot } from "../slots";
import { createHandleWebhook } from "./handle-webhook";
import { processEvent } from "./process-event";

export { createHandleWebhook } from "./handle-webhook";
export { processEvent } from "./process-event";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Statuses `reprocess` re-runs; `processed` events are returned untouched. */
const REPROCESSABLE = new Set<SendoEvent["status"]>(["received", "failed", "unrouted"]);

export function createEventsApi(ctx: SendoContext): EventsSlot {
  return {
    async get(eventId) {
      await ctx.ready();
      return ctx.adapter.events.get(eventId);
    },
    async reprocess(eventId) {
      await ctx.ready();
      const event = await ctx.adapter.events.get(eventId);
      if (event === null) throw new RecordNotFoundError({ entity: "event", id: eventId });
      if (!REPROCESSABLE.has(event.status)) return event;
      return processEvent(ctx, eventId);
    },
  };
}

export function createMaintenanceApi(ctx: SendoContext): MaintenanceSlot {
  return {
    async prune(opts = {}) {
      const days = opts.olderThanDays ?? ctx.config.eventRetentionDays;
      if (!Number.isFinite(days) || days < 0) {
        throw new ConfigError("maintenance.prune: olderThanDays must be a non-negative number.");
      }
      await ctx.ready();
      return ctx.adapter.events.prune(new Date(Date.now() - days * DAY_MS));
    },
  };
}

/** `SENDO_MODULES` entry: `sendo.handleWebhook`, `sendo.events`, `sendo.maintenance`. */
export function installPipeline(ctx: SendoContext): void {
  ctx.slots.handleWebhook = createHandleWebhook(ctx);
  ctx.slots.events = createEventsApi(ctx);
  ctx.slots.maintenance = createMaintenanceApi(ctx);
}
