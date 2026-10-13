import {
  createSendo,
  METRICS_SQL,
  metricsDayRange,
  metricsSqlParams,
  METRICS_VIEWS,
  type Actor,
} from "@quami/sendo";
import { memoryAdapter } from "@quami/sendo/adapters/memory";

const sendo = createSendo({
  adapter: memoryAdapter(),
  appSecret: process.env.SENDO_META_APP_SECRET ?? "",
  verifyToken: process.env.SENDO_VERIFY_TOKEN ?? "",
  resolveToken: (account) => process.env[account.tokenRef],
});
declare const userId: string;
declare const tenantId: string;
declare const ventasTagId: string;
declare const phoneNumberId: string;

// #region api
// Supervisors and admins (`metrics.view`); agents get FORBIDDEN.
const actor: Actor = await sendo.actor(userId, tenantId);

// October, both days included, in the number's timezone (local midnights, DST-safe).
const range = metricsDayRange({
  from: "2026-10-01",
  to: "2026-10-31",
  timeZone: "America/Guatemala",
});

const daily = await sendo.metrics.daily({ actor, ...range }); // per day and number
const people = await sendo.metrics.byAssignee({ actor, ...range }); // names from resolveUsers
const firstResponse = await sendo.metrics.firstResponse({
  actor,
  ...range,
  account: phoneNumberId,
});
const resolved = await sendo.metrics.aiResolution({ actor, ...range, tagIds: [ventasTagId] });
const sources = await sendo.metrics.bySource({ actor, ...range });
// Admins only (`costs.view`): supervisors get FORBIDDEN here and `costCents: null` in `daily`.
const cost = await sendo.metrics.cost({ actor, ...range });
// #endregion api

// #region sql
// Any Postgres client that takes `$1…$5` parameters. Every query returns view rows (snake_case,
// one row per day × number × tag set): sum them per day yourself, or use `sendo.metrics.*`.
interface PgClient {
  query(text: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
declare const pool: PgClient; // node-postgres Pool, or Drizzle's `db.$client`

const params = metricsSqlParams({ tenantId, ...range, tagIds: [ventasTagId] });
const { rows: dailyRows } = await pool.query(METRICS_SQL.daily, params);
// #endregion sql

// #region prisma
interface PrismaLike {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}
declare const prisma: PrismaLike;

const sourceRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
  METRICS_SQL.bySource,
  ...metricsSqlParams({ tenantId, ...range }),
);
// #endregion prisma

// #region views
// The select bodies of the five `sendo_metrics_*` views (as the v3 migration creates them).
const ddl = Object.entries(METRICS_VIEWS)
  .map(
    ([name, body]) =>
      `create or replace view public.${name}\nwith (security_invoker = true) as\n${body};`,
  )
  .join("\n\n");
// #endregion views

export { cost, daily, dailyRows, ddl, firstResponse, people, resolved, sourceRows, sources };
