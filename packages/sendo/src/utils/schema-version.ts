/** `sendo_schema_meta.version` this package expects. Keep this a single literal line: `scripts/sync-schema.mjs --check` parses it. */
export const SENDO_SCHEMA_VERSION = 3;

/** One step of the `schema` migration history. */
export interface SchemaMigration {
  /** `sendo_schema_meta.version` after this migration runs. */
  version: number;
  /** Migration filename shipped by `@sendo/schema`. */
  file: string;
  /** Changelog entry describing the change. */
  changelog: string;
}

/** Every schema migration, in version order. Each migration ticket appends one entry. */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    file: "20261010000000_sendo_v1.sql",
    changelog: "https://sendo.dev/changelog#schema-v1",
  },
  {
    version: 2,
    file: "20261011000000_sendo_v2.sql",
    changelog: "https://sendo.dev/changelog#schema-v2",
  },
  {
    version: 3,
    file: "20261013000000_sendo_v3.sql",
    changelog: "https://sendo.dev/changelog#schema-v3",
  },
];

export interface SchemaExpectation {
  version: number;
  migrations: readonly SchemaMigration[];
}

const DEFAULT_EXPECTATION: SchemaExpectation = {
  version: SENDO_SCHEMA_VERSION,
  migrations: SCHEMA_MIGRATIONS,
};

/** Migrations needed to go from `current` to the expected version, in order. */
export function pendingSchemaMigrations(
  current: number,
  expected: SchemaExpectation = DEFAULT_EXPECTATION,
): SchemaMigration[] {
  return expected.migrations
    .filter((m) => m.version > current && m.version <= expected.version)
    .sort((a, b) => a.version - b.version);
}

/**
 * Drift message shared by `sendo doctor` and the runtime warning:
 * "Your database is at schema version N and Sendo expects M. Run these migrations: … Changes: …".
 */
export function schemaDriftMessage(
  current: number,
  expected: SchemaExpectation = DEFAULT_EXPECTATION,
): string {
  const head = `Your database is at schema version ${current} and Sendo expects ${expected.version}.`;
  const pending = pendingSchemaMigrations(current, expected);
  if (pending.length === 0) {
    return `${head} Add the latest migration with npx shadcn add @sendo/schema and apply it.`;
  }
  const changelogs = [...new Set(pending.map((m) => m.changelog))];
  return `${head} Run these migrations: ${pending.map((m) => m.file).join(", ")}. Changes: ${changelogs.join(", ")}`;
}
