/**
 * AC-ST-4: no Spanish on `/en` pages and no English UI text on `/es` pages, enforced over every
 * dictionary section (the marketing copy's only source). Ways it can fail:
 *
 * 1. Spanish leaks into an `en` string: Spanish-only characters (ñ, accents, ¿ ¡) or Spanish
 *    stop-words (the "Precio por confirmar" bug).
 * 2. English UI text leaks into an `es` string: English stop-words or UI words.
 * 3. A section or a nested key escapes the check: the walk must reach every section of
 *    `DICTIONARY_SECTIONS` recursively, arrays and records included, and every leaf must be text.
 * 4. The detector is blind, so the two checks above pass vacuously.
 *
 * Product names, language endonyms, code spans (`` `x` ``), link targets and `{placeholders}` are
 * removed before checking; they are identical in both languages by design.
 */
import { describe, expect, it } from "vitest";
import { DICTIONARY_SECTIONS } from "./dictionary";
import { LANGS, type Lang } from "./langs";

const ALLOWED = [
  "Sendo Connect",
  "Sendo",
  "Quami",
  "WhatsApp Business",
  "WhatsApp Cloud API",
  "WhatsApp Web",
  "WhatsApp",
  "Meta",
  "MIDI Med",
  "Respond.io",
  "Kapso",
  "GitHub",
  "Next.js",
  "Tech Provider",
  "Embedded Signup",
  "MIT",
  "npm",
  "shadcn",
  "@quami/sendo",
  "@sendo",
  "Español",
  "English",
];

const SPANISH_CHARS = /[ñáéíóúü¿¡]/i;
const SPANISH_WORDS = new Set(
  (
    "el la los las del al lo le les que y de para por con una uno unos unas es son está están " +
    "su sus tu tus mi sin pero más también cuando donde como muy ya hay ese esta este estos " +
    "precio precios gratis próximamente mensajes cliente cuenta novedades cambios idioma inicio"
  ).split(" "),
);
const ENGLISH_WORDS = new Set(
  (
    "the and of to with your you is are for this that from it its our will be by at on in or an " +
    "not can all more read see how what who why which when free price pricing soon coming link " +
    "page home language toggle theme main plans changelog compare release releases notes " +
    "version install quickstart full screen live"
  ).split(" "),
);

type Leaf = { path: string; text: string };

function walk(value: unknown, path: string, out: Leaf[]): void {
  if (typeof value === "string") {
    out.push({ path, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${String(index)}]`, out));
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`, out);
  } else {
    throw new Error(`${path} is ${typeof value}: dictionary leaves must be text`);
  }
}

function leavesOf(lang: Lang): Leaf[] {
  const out: Leaf[] = [];
  for (const [section, byLang] of Object.entries(DICTIONARY_SECTIONS)) {
    walk(byLang[lang], `${section}.${lang}`, out);
  }
  return out;
}

function prose(text: string): string {
  let out = text
    .replace(/`[^`]*`/g, " ")
    .replace(/\]\([^)]*\)/g, "] ")
    .replace(/\{\w+\}/g, " ");
  for (const term of ALLOWED) out = out.split(term).join(" ");
  return out;
}

function leaksIn(lang: Lang, text: string): string[] {
  const clean = prose(text);
  const words = (clean.match(/\p{L}+/gu) ?? []).map((word) => word.toLowerCase());
  if (lang === "en") {
    const found = words.filter((word) => SPANISH_WORDS.has(word));
    if (SPANISH_CHARS.test(clean))
      found.push(...(clean.match(new RegExp(SPANISH_CHARS, "gi")) ?? []));
    return found;
  }
  return words.filter((word) => ENGLISH_WORDS.has(word));
}

describe("site dictionaries (AC-ST-4)", () => {
  it("[3] walk every section in both languages", () => {
    for (const lang of LANGS) {
      const sections = new Set(leavesOf(lang).map((leaf) => leaf.path.split(".")[0]));
      expect([...sections].sort()).toEqual(Object.keys(DICTIONARY_SECTIONS).sort());
    }
  });

  it("[1] en strings have no Spanish characters or stop-words", () => {
    const leaks = leavesOf("en")
      .map((leaf) => ({ ...leaf, found: leaksIn("en", leaf.text) }))
      .filter((leaf) => leaf.found.length > 0)
      .map((leaf) => `${leaf.path}: ${leaf.found.join(", ")} in "${leaf.text}"`);
    expect(leaks).toEqual([]);
  });

  it("[2] es strings have no English UI stop-words", () => {
    const leaks = leavesOf("es")
      .map((leaf) => ({ ...leaf, found: leaksIn("es", leaf.text) }))
      .filter((leaf) => leaf.found.length > 0)
      .map((leaf) => `${leaf.path}: ${leaf.found.join(", ")} in "${leaf.text}"`);
    expect(leaks).toEqual([]);
  });

  it("[4] the detector catches the leaks it exists for", () => {
    expect(leaksIn("en", "Precio por confirmar")).not.toEqual([]);
    expect(leaksIn("en", "Meta cobra los mensajes directo a tu cliente")).not.toEqual([]);
    expect(leaksIn("es", "Price coming soon")).not.toEqual([]);
    expect(leaksIn("es", "Link to this section")).not.toEqual([]);
    expect(leaksIn("en", "Add `connect` to `createSendo` in Sendo Connect")).toEqual([]);
  });
});
