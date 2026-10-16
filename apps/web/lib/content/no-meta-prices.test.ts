/**
 * AC-ST-12: no Meta price figures anywhere in the site or docs content. Meta's rates changed twice
 * in fifteen months, so pages link to Meta's rate card and never copy a number. Ways it can fail:
 *
 * 1. A docs page (`content/docs/*.mdx`) has a price-like figure (`$5`, `$ 0.05`, `USD 12`,
 *    `0.0147`) in the same paragraph as "Meta" or "per message" / "por mensaje". Reported as
 *    `file:line`.
 * 2. A dictionary string (every section of `DICTIONARY_SECTIONS`, both languages) has one next to
 *    those words. Reported as the dictionary path and `file:line`.
 * 3. The allow-list grows past its purpose: it only covers Sendo Connect's own price and model
 *    token pricing (what an agent turn costs), which are not Meta prices.
 * 4. The detector is blind, so the checks above pass vacuously (planted violations below).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DICTIONARY_SECTIONS } from "@/lib/i18n/dictionary";
import { LANGS } from "@/lib/i18n/langs";

const WEB_ROOT = path.join(import.meta.dirname, "../..");
const DOCS_DIR = path.join(WEB_ROOT, "content/docs");
const DICTIONARIES_DIR = path.join(WEB_ROOT, "lib/i18n/dictionaries");

const PRICE = /\$\s?\d|USD\s?\d|\d+\.\d{3,4}/g;
const CONTEXT = /\bMeta\b|[Pp]er message|[Pp]or mensaje/;

/** Not Meta prices. Each entry: where, the exact figure, and why it is allowed. */
const ALLOWED_DOCS: readonly { file: string; figure: string; reason: string }[] = [
  {
    file: "voice-notes-and-cost.mdx",
    figure: "$0.0024",
    reason: "model token cost of one agent turn, not a Meta price",
  },
  {
    file: "languages.mdx",
    figure: "$0.0024",
    reason: "model token cost formatted per locale, not a Meta price",
  },
];

/** Dictionary paths (after the language) that may hold Sendo Connect's own price. */
const ALLOWED_DICTIONARY_PATHS = [/^pricing\.\w+\.plans\.connect\.(price|priceNote)$/];

type Violation = { where: string; figure: string; text: string };

/** Price-like figures in `text` whose window (the text itself) mentions Meta or per-message. */
function figuresNearMeta(text: string): string[] {
  if (!CONTEXT.test(text)) return [];
  return [...text.matchAll(PRICE)].map((match) => match[0]);
}

/** Splits an mdx file into paragraphs (blank-line separated) and scans each one. */
function scanMdx(file: string, source: string): Violation[] {
  const lines = source.split("\n");
  const out: Violation[] = [];
  let start = 0;
  for (let index = 0; index <= lines.length; index++) {
    const line = lines[index];
    if (line !== undefined && line.trim() !== "") continue;
    const paragraph = lines.slice(start, index);
    if (CONTEXT.test(paragraph.join("\n"))) {
      paragraph.forEach((text, offset) => {
        for (const match of text.matchAll(PRICE)) {
          out.push({ where: `${file}:${String(start + offset + 1)}`, figure: match[0], text });
        }
      });
    }
    start = index + 1;
  }
  return out.filter(
    (violation) =>
      !ALLOWED_DOCS.some(
        (entry) =>
          violation.where.startsWith(`${entry.file}:`) && violation.text.includes(entry.figure),
      ),
  );
}

function leaves(value: unknown, at: string, out: { at: string; text: string }[]): void {
  if (typeof value === "string") out.push({ at, text: value });
  else if (Array.isArray(value))
    value.forEach((item, i) => leaves(item, `${at}[${String(i)}]`, out));
  else if (typeof value === "object" && value !== null)
    for (const [key, item] of Object.entries(value)) leaves(item, `${at}.${key}`, out);
}

function lineOf(file: string, text: string): string {
  const source = readFileSync(path.join(DICTIONARIES_DIR, file), "utf8");
  const needle = JSON.stringify(text).slice(1, 41);
  const index = source.split("\n").findIndex((line) => line.includes(needle));
  return `lib/i18n/dictionaries/${file}:${index < 0 ? "?" : String(index + 1)}`;
}

function scanDictionaries(): Violation[] {
  const out: Violation[] = [];
  for (const [section, byLang] of Object.entries(DICTIONARY_SECTIONS)) {
    for (const lang of LANGS) {
      const found: { at: string; text: string }[] = [];
      leaves(byLang[lang], `${section}.${lang}`, found);
      for (const leaf of found) {
        if (ALLOWED_DICTIONARY_PATHS.some((pattern) => pattern.test(leaf.at))) continue;
        for (const figure of figuresNearMeta(leaf.text)) {
          out.push({
            where: `${leaf.at} (${lineOf(`${section}.ts`, leaf.text)})`,
            figure,
            text: leaf.text,
          });
        }
      }
    }
  }
  return out;
}

const report = (violations: Violation[]) =>
  violations.map((v) => `${v.where}: "${v.figure}" near Meta / per message in: ${v.text.trim()}`);

describe("no Meta price figures in site or docs content (AC-ST-12)", () => {
  it("[1] docs pages link to Meta's rate card instead of copying its numbers", () => {
    const files = readdirSync(DOCS_DIR).filter((file) => file.endsWith(".mdx"));
    expect(files.length).toBeGreaterThan(10);
    const violations = files.flatMap((file) =>
      scanMdx(file, readFileSync(path.join(DOCS_DIR, file), "utf8")),
    );
    expect(report(violations)).toEqual([]);
  });

  it("[2] no dictionary section has a Meta price figure, in either language", () => {
    expect(Object.keys(DICTIONARY_SECTIONS).length).toBeGreaterThan(5);
    expect(report(scanDictionaries())).toEqual([]);
  });

  it("[3] the allow-list only covers model token pricing and Connect's own price", () => {
    for (const entry of ALLOWED_DOCS) expect(entry.reason).toMatch(/model token|Sendo Connect/);
    expect(ALLOWED_DICTIONARY_PATHS.every((p) => p.source.includes("plans\\.connect"))).toBe(true);
  });

  it("[4] the detector catches planted Meta prices and ignores the rest", () => {
    const planted = [
      "Meta charges $0.05 for a marketing template in Guatemala.",
      "Rest of Latin America: USD 0.0740 per message.",
      "Marketing, 0.0625 por mensaje.",
      "Meta bills each utility message.\n\n\nNothing here.\n\nMeta:\n- authentication 0.0300",
      "Meta’s rate card lists $ 1 per thousand.",
    ];
    for (const text of planted) {
      expect(scanMdx("planted.mdx", text), text).not.toEqual([]);
      expect(figuresNearMeta(text.replace(/\n/g, " ")), text).not.toEqual([]);
    }
    expect(scanMdx("planted.mdx", "Meta bills it.\n\nAn agent turn costs $0.0024.")).toEqual([]);
    expect(scanMdx("planted.mdx", "Meta error 131042, WhatsApp Business app 2.24.17.")).toEqual([]);
    expect(scanMdx("planted.mdx", "Meta bills it.\nLine two costs $0.10.")[0]?.where).toBe(
      "planted.mdx:2",
    );
    expect(
      scanMdx("voice-notes-and-cost.mdx", "Meta and the model: `$0.0024 · 1102 → 64 tokens`"),
    ).toEqual([]);
  });
});
