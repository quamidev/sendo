import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { SENDO_TABLES } from "@quami/sendo";
import { sendoTables } from "./lib/db/sendo-schema";

/**
 * AC-AP-2: the Drizzle schema matches the `schema` SQL migrations — same tables, same
 * columns (names, types and nullability), same enums. Parses the `create table` / `create type`
 * statements of every `sendo_v*.sql` file (one column per line, as the migrations are written).
 */
const MIGRATIONS = join(import.meta.dirname, "../schema/supabase/migrations");

interface SqlColumn {
  type: string;
  notNull: boolean;
}

/** Postgres spellings → the names Drizzle's `getSQLType()` uses. */
function normalizeType(type: string): string {
  const t = type
    .trim()
    .toLowerCase()
    .replace(/^public\./, "")
    .replace(/\s+/g, " ");
  if (t === "timestamptz") return "timestamp with time zone";
  if (t === "int") return "integer";
  return t.replace(/\(\s*(\d+)\s*,\s*(\d+)\s*\)/, "($1, $2)");
}

function parseMigrations() {
  const tables = new Map<string, Map<string, SqlColumn>>();
  const enums = new Map<string, string[]>();
  const files = readdirSync(MIGRATIONS)
    .filter((f) => /_sendo_v\d+\.sql$/.test(f))
    .sort();
  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const m of text.matchAll(/create type public\.(\w+) as enum \(([^)]*)\)/g)) {
      enums.set(
        m[1] ?? "",
        [...(m[2] ?? "").matchAll(/'([^']+)'/g)].map((v) => v[1] ?? ""),
      );
    }
    for (const m of text.matchAll(
      /create table if not exists public\.(\w+) \(\n([\s\S]*?)\n\);/g,
    )) {
      const columns = new Map<string, SqlColumn>();
      const primary: string[] = [];
      for (const raw of (m[2] ?? "").split("\n")) {
        const line = raw.replace(/--.*$/, "").trim().replace(/,$/, "");
        if (line === "") continue;
        if (/^constraint /.test(line)) {
          const pk = /primary key \(([^)]+)\)/.exec(line);
          if (pk) primary.push(...(pk[1] ?? "").split(",").map((c) => c.trim()));
          continue;
        }
        if (/^check /.test(line)) continue;
        const col = /^(\w+)\s+(.+)$/.exec(line);
        if (!col) continue;
        const rest = col[2] ?? "";
        const type = rest.split(/\s+(?:not null|primary key|default|references|unique|check)\b/)[0];
        columns.set(col[1] ?? "", {
          type: normalizeType(type ?? ""),
          notNull: /\bnot null\b|\bprimary key\b/.test(rest),
        });
      }
      for (const name of primary) {
        const column = columns.get(name);
        if (column) column.notNull = true;
      }
      tables.set(m[1] ?? "", columns);
    }
  }
  return { tables, enums };
}

const sql = parseMigrations();

describe("drizzle-schema matches the SQL migrations", () => {
  it("defines exactly the migration tables (and the package's SENDO_TABLES)", () => {
    expect(Object.keys(sendoTables).sort()).toEqual([...sql.tables.keys()].sort());
    expect(Object.keys(sendoTables).sort()).toEqual([...SENDO_TABLES].sort());
    for (const [name, table] of Object.entries(sendoTables)) {
      expect(getTableConfig(table).name).toBe(name);
    }
  });

  it.each(Object.entries(sendoTables))("%s: same columns, types and nullability", (name, table) => {
    const expected = sql.tables.get(name);
    expect(expected, `${name} is not in the migrations`).toBeDefined();
    const actual = Object.fromEntries(
      getTableConfig(table).columns.map((c) => [
        c.name,
        { type: normalizeType(c.getSQLType()), notNull: c.notNull || c.primary },
      ]),
    );
    expect(actual).toEqual(Object.fromEntries(expected ?? []));
  });

  it("uses the migration enums with the same values", () => {
    const used = new Map<string, string[]>();
    for (const table of Object.values(sendoTables)) {
      for (const column of getTableConfig(table).columns) {
        if (column.enumValues && column.columnType === "PgEnumColumn") {
          used.set(column.getSQLType(), [...column.enumValues]);
        }
      }
    }
    expect(Object.fromEntries(used)).toEqual(Object.fromEntries(sql.enums));
  });
});
