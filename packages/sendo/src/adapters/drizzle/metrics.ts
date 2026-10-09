import { type SQL, sql } from "drizzle-orm";
import { METRICS_SQL, metricsSqlParams } from "../../metrics/sql";
import { type MetricsDbRow, metricsFromSql } from "../metrics";
import type { SendoAdapter } from "../types";
import { type DrizzleDatabase, jsonRows, param, uuidArray } from "./db";

/**
 * `METRICS_SQL` with its `$1..$5` placeholders bound as Drizzle parameters. The tag ids (`$5`)
 * become a `uuid[]` built from JSON (drivers disagree on array parameters); every other
 * parameter keeps the cast written next to it in the query.
 */
export function boundMetricsSql(text: string, params: ReturnType<typeof metricsSqlParams>): SQL {
  const chunks: SQL[] = [];
  let last = 0;
  for (const match of text.matchAll(/\$([1-5])(?!\d)/g)) {
    chunks.push(sql.raw(text.slice(last, match.index)));
    const index = Number(match[1]) - 1;
    const value = params[index];
    if (index === 4)
      chunks.push(value === null ? sql`(null)` : sql`(${uuidArray(value as string[])})`);
    else chunks.push(sql`(${param(value)})`);
    last = match.index + match[0].length;
  }
  chunks.push(sql.raw(text.slice(last)));
  return sql.join(chunks, sql``);
}

/** `metrics.*` from `METRICS_SQL` (the same queries the Supabase views run). */
export function drizzleMetrics(db: DrizzleDatabase): SendoAdapter["metrics"] {
  return metricsFromSql((name, query) =>
    jsonRows<MetricsDbRow>(
      db,
      `metrics.${name}`,
      sql`select to_jsonb(v) as r from (${boundMetricsSql(METRICS_SQL[name], metricsSqlParams(query))}) v`,
    ),
  );
}
