import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetricsViewName } from "../../metrics/sql";
import {
  type MetricsDbRow,
  aiResolutionFromDb,
  assigneeFromDb,
  dailyFromDb,
  firstResponseFromDb,
  foldAiResolution,
  foldByAssignee,
  foldBySource,
  foldCost,
  foldDaily,
  foldFirstResponse,
  sourceFromDb,
} from "../metrics";
import type { MetricsAdapterQuery, SendoAdapter } from "../types";
import { exec } from "./query";

/** Rows per request; below PostgREST's usual `max_rows` (1000). */
const PAGE_SIZE = 1000;

/** Columns that identify a row of each view, for stable paging. */
const ORDER: Record<MetricsViewName, string[]> = {
  sendo_metrics_daily: ["account_id", "channel", "day", "tag_ids"],
  sendo_metrics_by_assignee: ["account_id", "channel", "day", "sender", "assignee", "tag_ids"],
  sendo_metrics_by_source: ["account_id", "channel", "source", "day", "tag_ids"],
  sendo_metrics_first_response: ["conversation_id"],
  sendo_metrics_ai_resolution: ["conversation_id"],
};

/** Reads the `sendo_metrics_*` views (service role: no RLS) and folds them. */
export function supabaseMetrics(db: SupabaseClient): SendoAdapter["metrics"] {
  async function read(
    view: MetricsViewName,
    timeColumn: string,
    q: MetricsAdapterQuery,
    sender?: "agent" | "human",
  ): Promise<MetricsDbRow[]> {
    const rows: MetricsDbRow[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = db
        .from(view)
        .select("*")
        .gte(timeColumn, q.from.toISOString())
        .lt(timeColumn, q.to.toISOString());
      query = q.tenantId === null ? query.is("tenant_id", null) : query.eq("tenant_id", q.tenantId);
      if (q.accountId !== undefined) query = query.eq("account_id", q.accountId);
      if (q.tagIds && q.tagIds.length > 0) query = query.overlaps("tag_ids", q.tagIds);
      if (sender) query = query.eq("sender", sender);
      for (const column of ORDER[view]) query = query.order(column, { ascending: true });
      const page = await exec<MetricsDbRow[]>(
        `metrics.${view}`,
        query.range(offset, offset + PAGE_SIZE - 1),
      );
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  return {
    daily: async (q) =>
      foldDaily((await read("sendo_metrics_daily", "day_start", q)).map(dailyFromDb)),
    byAssignee: async (q) =>
      foldByAssignee(
        (await read("sendo_metrics_by_assignee", "day_start", q, "human")).map(assigneeFromDb),
      ),
    cost: async (q) =>
      foldCost(
        (await read("sendo_metrics_by_assignee", "day_start", q, "agent")).map(assigneeFromDb),
      ),
    bySource: async (q) =>
      foldBySource((await read("sendo_metrics_by_source", "day_start", q)).map(sourceFromDb)),
    firstResponse: async (q) =>
      foldFirstResponse(
        (await read("sendo_metrics_first_response", "first_inbound_at", q)).map(
          firstResponseFromDb,
        ),
      ),
    aiResolution: async (q) =>
      foldAiResolution(
        (await read("sendo_metrics_ai_resolution", "closed_at", q)).map(aiResolutionFromDb),
      ),
  };
}
