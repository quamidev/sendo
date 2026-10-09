import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// MOTION.md rules: animate only transform and opacity (colour for hover/press), never layout
// properties, never `ease-in` on UI, never an unbounded `transition-all`.

const FORBIDDEN_PROPERTIES = [
  "height",
  "width",
  "padding",
  "margin",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "all",
];
const FORBIDDEN_MOTION_KEYS = [
  "height",
  "width",
  "padding",
  "margin",
  "maxHeight",
  "maxWidth",
  "minHeight",
  "minWidth",
];

interface MotionViolation {
  line: number;
  rule: string;
  text: string;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function isForbiddenProperty(property: string): boolean {
  const name = property.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return FORBIDDEN_PROPERTIES.some(
    (forbidden) =>
      name === forbidden ||
      ((forbidden === "padding" || forbidden === "margin") && name.startsWith(`${forbidden}-`)),
  );
}

/** Motion-rule violations in a `.tsx`/`.ts`/`.css` source. */
function findMotionViolations(source: string): MotionViolation[] {
  const violations: MotionViolation[] = [];
  const add = (index: number, rule: string, text: string) => {
    violations.push({ line: lineOf(source, index), rule, text });
  };

  for (const match of source.matchAll(/\btransition-all\b/g)) {
    add(match.index, "transition-all", match[0]);
  }
  // `ease-in` (Tailwind, CSS, tokens) but not `ease-in-out`; motion's `easeIn` but not `easeInOut`.
  for (const match of source.matchAll(/ease-in(?!-out)\b|\beaseIn\b(?!Out)/g)) {
    add(match.index, "ease-in", match[0]);
  }
  // Tailwind arbitrary transitions: `transition-[height,opacity]`.
  for (const match of source.matchAll(/transition-\[([^\]]+)\]/g)) {
    const properties = (match[1] ?? "").split(",");
    if (properties.some(isForbiddenProperty)) add(match.index, "layout-transition", match[0]);
  }
  // CSS declarations: `transition: height 200ms`, `transition-property: width`.
  for (const match of source.matchAll(/transition(?:-property)?\s*:\s*([^;}"'`]+)/g)) {
    const properties = (match[1] ?? "").split(",");
    if (properties.some(isForbiddenProperty)) add(match.index, "layout-transition", match[0]);
  }
  // motion props: `animate={{ height: … }}`, `initial`, `exit`, `while*`.
  for (const match of source.matchAll(
    /\b(?:animate|initial|exit|whileTap|whileHover|whileDrag|whileInView)\s*=\s*\{\{([^}]*)\}\}/g,
  )) {
    const keys = [...(match[1] ?? "").matchAll(/(\w+)\s*:/g)].map((key) => key[1]);
    if (keys.some((key) => key !== undefined && FORBIDDEN_MOTION_KEYS.includes(key))) {
      add(match.index, "layout-animation", match[0]);
    }
  }
  return violations;
}

const ITEM_DIR = import.meta.dirname;

function itemFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return itemFiles(full);
    if (!/\.(tsx|css)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

describe("findMotionViolations", () => {
  it.each([
    ["transition-all duration-200", "transition-all"],
    ['className="transition-[height,opacity]"', "layout-transition"],
    ["transition-[max-height]", "layout-transition"],
    ["transition-[padding-top]", "layout-transition"],
    [".a { transition: width 200ms ease-out; }", "layout-transition"],
    [".a { transition-property: margin-left; }", "layout-transition"],
    ["ease-in duration-200", "ease-in"],
    ["ease-[var(--sendo-ease-in)]", "ease-in"],
    [".a { transition: opacity 1s ease-in; }", "ease-in"],
    ['transition={{ ease: "easeIn" }}', "ease-in"],
    ["animate={{ height: 0, opacity: 1 }}", "layout-animation"],
  ])("flags %s", (source, rule) => {
    expect(findMotionViolations(source).map((violation) => violation.rule)).toContain(rule);
  });
});

describe("sendo-inbox motion rules", () => {
  const files = itemFiles(ITEM_DIR);

  it("scans the item's components and styles", () => {
    const names = files.map((file) => path.basename(file));
    expect(names).toEqual(expect.arrayContaining(["motion.css", "thread.tsx", "motion-sheet.tsx"]));
  });

  it.each(files.map((file) => [path.relative(ITEM_DIR, file), file]))(
    "%s animates only transform and opacity, without ease-in or transition-all",
    (_name, file) => {
      expect(findMotionViolations(readFileSync(file, "utf8"))).toEqual([]);
    },
  );
});
