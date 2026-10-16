import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SENDO_TABLES } from "@quami/sendo";

/**
 * AC-AP-2: the Prisma models in `prisma/sendo.prisma` match the `schema` SQL migrations —
 * same tables, same columns (names, types and nullability), same enums, and every named
 * index or constraint exists in the SQL. Parses the `create table` / `create type` statements
 * of every `sendo_v*.sql` file (one column per line, as the migrations are written) and the
 * model blocks of the Prisma file. `prisma generate` on the same file runs in
 * `packages/sendo/src/adapters/prisma/prisma.supabase.test.ts`, which also reads every table
 * through the generated models.
 */
const MIGRATIONS = join(import.meta.dirname, "../schema/supabase/migrations");
const PRISMA_FILE = join(import.meta.dirname, "prisma/sendo.prisma");

interface Column {
  type: string;
  notNull: boolean;
}

function normalizeSqlType(type: string): string {
  const t = type
    .trim()
    .toLowerCase()
    .replace(/^public\./, "")
    .replace(/\s+/g, " ");
  if (t === "int") return "integer";
  return t.replace(/\(\s*(\d+)\s*,\s*(\d+)\s*\)/, "($1, $2)");
}

function migrationText(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => /_sendo_v\d+\.sql$/.test(f))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

function parseSql(text: string) {
  const tables = new Map<string, Map<string, Column>>();
  const enums = new Map<string, string[]>();
  for (const m of text.matchAll(/create type public\.(\w+) as enum \(([^)]*)\)/g)) {
    enums.set(
      m[1] ?? "",
      [...(m[2] ?? "").matchAll(/'([^']+)'/g)].map((v) => v[1] ?? ""),
    );
  }
  for (const m of text.matchAll(/create table if not exists public\.(\w+) \(\n([\s\S]*?)\n\);/g)) {
    const columns = new Map<string, Column>();
    const primary: string[] = [];
    for (const raw of (m[2] ?? "").split("\n")) {
      const line = raw.replace(/--.*$/, "").trim().replace(/,$/, "");
      if (line === "" || /^check /.test(line)) continue;
      if (/^constraint /.test(line)) {
        const pk = /primary key \(([^)]+)\)/.exec(line);
        if (pk) primary.push(...(pk[1] ?? "").split(",").map((c) => c.trim()));
        continue;
      }
      const col = /^(\w+)\s+(.+)$/.exec(line);
      if (!col) continue;
      const rest = col[2] ?? "";
      const type = rest.split(/\s+(?:not null|primary key|default|references|unique|check)\b/)[0];
      columns.set(col[1] ?? "", {
        type: normalizeSqlType(type ?? ""),
        notNull: /\bnot null\b|\bprimary key\b/.test(rest),
      });
    }
    for (const name of primary) {
      const column = columns.get(name);
      if (column) column.notNull = true;
    }
    tables.set(m[1] ?? "", columns);
  }
  return { tables, enums };
}

const mapped = (attrs: string): string | null => /@map\("([^"]+)"\)/.exec(attrs)?.[1] ?? null;

function parsePrisma(text: string) {
  const enums = new Map<string, { sqlName: string; values: string[] }>();
  for (const m of text.matchAll(/^enum (\w+) \{\n([\s\S]*?)\n\}/gm)) {
    const body = m[2] ?? "";
    const values = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\w/.test(l))
      .map((l) => mapped(l) ?? l.split(/\s+/)[0] ?? "");
    enums.set(m[1] ?? "", { sqlName: /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? m[1] ?? "", values });
  }
  const models = new Set([...text.matchAll(/^model (\w+) \{/gm)].map((m) => m[1] ?? ""));
  const tables = new Map<string, Map<string, Column>>();
  for (const m of text.matchAll(/^model (\w+) \{\n([\s\S]*?)\n\}/gm)) {
    const body = m[2] ?? "";
    const table = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? m[1] ?? "";
    const columns = new Map<string, Column>();
    for (const raw of body.split("\n")) {
      const line = raw.replace(/\/\/.*$/, "").trim();
      const field = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
      if (!field) continue;
      const [, name = "", type = "", list, optional, attrs = ""] = field;
      if (list || models.has(type)) continue; // relation fields have no column
      const native = /@db\.(\w+)(\([^)]*\))?/.exec(attrs);
      let sqlType: string;
      if (enums.has(type)) sqlType = enums.get(type)?.sqlName ?? type;
      else if (type === "String") sqlType = native?.[1] === "Uuid" ? "uuid" : "text";
      else if (type === "Boolean") sqlType = "boolean";
      else if (type === "Int") sqlType = "integer";
      else if (type === "BigInt") sqlType = "bigint";
      else if (type === "Json") sqlType = "jsonb";
      else if (type === "DateTime")
        sqlType = native?.[1] === "Timestamptz" ? "timestamptz" : "timestamp";
      else if (type === "Decimal") sqlType = normalizeSqlType(`numeric${native?.[2] ?? ""}`);
      else sqlType = `unknown:${type}`;
      columns.set(mapped(attrs) ?? name, { type: sqlType, notNull: optional === undefined });
    }
    tables.set(table, columns);
  }
  const names = [...text.matchAll(/map: "([^"]+)"/g)].map((m) => m[1] ?? "");
  return { tables, enums, names };
}

const sqlText = migrationText();
const sql = parseSql(sqlText);
const prisma = parsePrisma(readFileSync(PRISMA_FILE, "utf8"));

describe("prisma-schema matches the SQL migrations", () => {
  it("models exactly the migration tables (and the package's SENDO_TABLES)", () => {
    expect([...prisma.tables.keys()].sort()).toEqual([...sql.tables.keys()].sort());
    expect([...prisma.tables.keys()].sort()).toEqual([...SENDO_TABLES].sort());
  });

  it.each([...prisma.tables.keys()])("%s: same columns, types and nullability", (table) => {
    const expected = sql.tables.get(table);
    expect(expected, `${table} is not in the migrations`).toBeDefined();
    expect(Object.fromEntries(prisma.tables.get(table) ?? [])).toEqual(
      Object.fromEntries(expected ?? []),
    );
  });

  it("maps the migration enums with the same values", () => {
    const actual = Object.fromEntries([...prisma.enums.values()].map((e) => [e.sqlName, e.values]));
    expect(actual).toEqual(Object.fromEntries(sql.enums));
  });

  it("names only indexes and constraints the migrations create", () => {
    expect(prisma.names.length).toBeGreaterThan(0);
    for (const name of prisma.names) {
      expect(sqlText, `${name} is not created by the migrations`).toMatch(
        new RegExp(`(constraint|index if not exists) ${name}\\b`),
      );
    }
  });

  it("ships the same plain-Postgres prelude as drizzle-schema", () => {
    const drizzle = join(
      import.meta.dirname,
      "../drizzle-schema/lib/db/sendo-postgres-prelude.sql",
    );
    if (!existsSync(drizzle)) return;
    expect(
      readFileSync(join(import.meta.dirname, "prisma/sendo-postgres-prelude.sql"), "utf8"),
    ).toBe(readFileSync(drizzle, "utf8"));
  });
});
