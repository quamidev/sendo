"use server";

import { assertCan, can, isSendoError, metricsDayRange, type MetricsQuery } from "@quami/sendo";
import { summarizeMetrics } from "@/components/sendo/metrics/summary";
import {
  isDay,
  METRICS_MAX_DAYS,
  metricsTimeZone,
  rangeLength,
  serializeMetricsNumber,
  serializeMetricsTag,
  type MetricsActionResult,
  type MetricsErrorCode,
  type MetricsFilters,
  type MetricsReport,
} from "@/components/sendo/metrics/types";
import { sendo } from "@/lib/sendo";
import { requireUser } from "./metrics-config";

class InvalidInputError extends Error {}

function errorCode(error: unknown): MetricsErrorCode {
  if (error instanceof InvalidInputError) return "INVALID";
  if (!isSendoError(error)) return "UNKNOWN";
  switch (error.code) {
    case "FORBIDDEN":
      return "FORBIDDEN";
    case "ACCOUNT_NOT_FOUND":
    case "RECORD_NOT_FOUND":
      return "NOT_FOUND";
    case "INVALID_PAYLOAD":
      return "INVALID";
    default:
      return "UNKNOWN";
  }
}

/** Runs `fn` and turns errors into `{ ok: false }`. Library errors carry user-safe messages. */
async function attempt<T>(fn: () => Promise<T>): Promise<MetricsActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    const code = errorCode(error);
    if (code === "UNKNOWN" && !isSendoError(error)) console.error("[sendo metrics]", error);
    const message =
      error instanceof InvalidInputError || isSendoError(error)
        ? error.message
        : "Unexpected error";
    return { ok: false, code, message };
  }
}

/** Server actions take untrusted input: re-check the shape the screen sends. */
function validFilters(input: MetricsFilters): MetricsFilters {
  const { from, to, account, tagIds } = input;
  if (!isDay(from) || !isDay(to) || to < from) throw new InvalidInputError("Invalid period");
  if (rangeLength(from, to) > METRICS_MAX_DAYS) {
    throw new InvalidInputError(`Pick ${String(METRICS_MAX_DAYS)} days or fewer`);
  }
  if (account !== null && (typeof account !== "string" || account === "" || account.length > 200)) {
    throw new InvalidInputError("Invalid number");
  }
  if (
    !Array.isArray(tagIds) ||
    tagIds.length > 100 ||
    tagIds.some((id) => typeof id !== "string" || id === "" || id.length > 200)
  ) {
    throw new InvalidInputError("Invalid tags");
  }
  return { from, to, account, tagIds: [...new Set(tagIds)] };
}

/**
 * Every metric for one filter selection, folded for the screen. Needs `metrics.view`
 * (supervisor, admin); the cost section is only loaded with `costs.view` (admin).
 */
export async function loadMetrics(
  filters: MetricsFilters,
): Promise<MetricsActionResult<MetricsReport>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await sendo.actor(user.userId, user.tenantId);
    assertCan(actor, "metrics.view");
    const input = validFilters(filters);
    const [accounts, tags] = await Promise.all([
      sendo.accounts.list({ tenant: actor.tenantId, includeInactive: true }),
      sendo.tags.list({ actor }),
    ]);
    const numbers = accounts.map(serializeMetricsNumber);
    const timeZone = metricsTimeZone(numbers, input.account);
    const query: MetricsQuery = {
      actor,
      ...metricsDayRange({ from: input.from, to: input.to, timeZone }),
      ...(input.account !== null && { account: input.account }),
      ...(input.tagIds.length > 0 && { tagIds: input.tagIds }),
    };
    const [daily, byAssignee, firstResponse, aiResolution, bySource, cost] = await Promise.all([
      sendo.metrics.daily(query),
      sendo.metrics.byAssignee(query),
      sendo.metrics.firstResponse(query),
      sendo.metrics.aiResolution(query),
      sendo.metrics.bySource(query),
      can(actor, "costs.view") ? sendo.metrics.cost(query) : Promise.resolve(null),
    ]);
    return summarizeMetrics({
      filters: input,
      timeZone,
      raw: { daily, byAssignee, firstResponse, aiResolution, bySource, cost },
      tags: tags.map(serializeMetricsTag),
    });
  });
}
