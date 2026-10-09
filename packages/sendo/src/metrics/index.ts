import type { SendoContext } from "../core/context";
import { stubNamespace } from "../core/slots";
import type { Actor } from "../team/permissions";

export interface MetricsQuery {
  actor: Actor;
  from: Date;
  to: Date;
  account?: string;
  tagIds?: string[];
}

/** `sendo.metrics` (SND-4.4). Placeholder row types until SND-4.1 defines them. */
export interface MetricsApi {
  daily(q: MetricsQuery): Promise<unknown[]>;
  byAssignee(q: MetricsQuery): Promise<unknown[]>;
  firstResponse(q: MetricsQuery): Promise<unknown[]>;
  aiResolution(q: MetricsQuery): Promise<unknown[]>;
  bySource(q: MetricsQuery): Promise<unknown[]>;
  cost(q: MetricsQuery): Promise<unknown[]>;
}

/** `SENDO_MODULES` entry. Placeholder: keeps the stub until SND-4.4. */
export function installMetrics(ctx: SendoContext): void {
  ctx.slots.metrics = stubNamespace("metrics");
}
