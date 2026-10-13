import type { Lang } from "../langs";

/**
 * Changelog chrome. The release entries themselves come from `packages/sendo/CHANGELOG.md` and the
 * pending changesets, stay English and render inside `lang="en"`.
 * Strings may use the inline markup of `rich()`.
 */
export interface ChangelogDict {
  meta: { title: string; description: string };
  title: string;
  intro: string;
  entriesInEnglish: string;
  schema: {
    heading: string;
    body: string;
    columns: { version: string; file: string; notes: string };
    nextRelease: string;
  };
  nextRelease: { heading: string; body: string };
  releases: { heading: string; empty: string };
  anchorLabel: string;
}

export const changelog = {
  es: {
    meta: {
      title: "Cambios",
      description:
        "Cada versión de @quami/sendo, la próxima, y las migraciones de esquema que necesita cada una.",
    },
    title: "Cambios",
    intro:
      "Versiones de `@quami/sendo`. Los componentes del registro se copian a tu app y no se actualizan solos, así que lee las notas antes de actualizar y corre las migraciones de abajo.",
    entriesInEnglish: "Las notas de cada versión están en inglés.",
    schema: {
      heading: "Versiones del esquema",
      body: "`npx @quami/sendo doctor` compara tu base de datos con el paquete. Cuando reporta diferencias, copia cada archivo que falte del componente `schema` del registro (o vuelve a correr `npx shadcn add @sendo/schema`) a `supabase/migrations/` y córrelo, en orden.",
      columns: { version: "Versión", file: "Archivo de migración", notes: "Notas" },
      nextRelease: "Próxima versión",
    },
    nextRelease: {
      heading: "Próxima versión",
      body: "Cambios ya integrados que esperan la próxima versión de `@quami/sendo`.",
    },
    releases: {
      heading: "Versiones",
      empty:
        "Todavía no hay versiones publicadas: `0.1.0` es la primera versión pública. Sus notas están en Próxima versión hasta que se publique.",
    },
    anchorLabel: "Enlace a esta sección",
  },
  en: {
    meta: {
      title: "Changelog",
      description:
        "Every @quami/sendo release, the next one, and the schema migrations each version needs.",
    },
    title: "Changelog",
    intro:
      "Releases of `@quami/sendo`. Registry items are copied into your app and don’t update themselves, so read the notes before you upgrade and run the migrations below.",
    entriesInEnglish: "Release notes are in English.",
    schema: {
      heading: "Schema versions",
      body: "`npx @quami/sendo doctor` compares your database with the package. When it reports drift, copy each missing file from the `schema` registry item (or re-run `npx shadcn add @sendo/schema`) into `supabase/migrations/` and run it, in order.",
      columns: { version: "Version", file: "Migration file", notes: "Notes" },
      nextRelease: "Next release",
    },
    nextRelease: {
      heading: "Next release",
      body: "Merged and waiting for the next `@quami/sendo` version.",
    },
    releases: {
      heading: "Releases",
      empty:
        "No release yet: `0.1.0` is the first public version. Its notes are under Next release until it is published.",
    },
    anchorLabel: "Link to this section",
  },
} satisfies Record<Lang, ChangelogDict>;
