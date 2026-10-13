/**
 * Cross-language leak check for the registry UI items (AC-RS-2), shared by every item's test:
 * render a screen in one locale, then look for the other locale's known strings in what the user
 * can see or hear.
 */

import type { SendoLocale } from "@/lib/sendo-ui";

/**
 * Everyday words of each language that the other one never uses as a whole word. They catch what
 * `knownStrings` can't: a phrase copied into the wrong locale object, or text built outside the
 * strings (a hard-coded label, a formatter with a fixed locale). Matched case-insensitively.
 */
export const LANGUAGE_MARKERS: Record<SendoLocale, readonly string[]> = {
  es: [
    "hoy",
    "ayer",
    "hace",
    "abiertas",
    "cerradas",
    "cerrar",
    "buscar",
    "cargar",
    "conversación",
    "conversaciones",
    "asignada",
    "asignar",
    "etiquetas",
    "número",
    "números",
    "reglas",
    "envíos",
    "métricas",
    "enlaces",
    "detalles",
    "responder",
    "nota",
    "plantilla",
    "ventana",
    "agente",
    "persona",
    "enviar",
    "guardar",
    "cancelar",
    "eliminar",
    "sin",
    "por",
    "para",
    "del",
    "las",
    "los",
    "una",
    "está",
    "lun",
    "mié",
    "jue",
    "vie",
    "sáb",
    "dom",
    "ene",
    "abr",
  ],
  en: [
    "today",
    "yesterday",
    "ago",
    "open",
    "closed",
    "close",
    "search",
    "load",
    "conversation",
    "conversations",
    "assigned",
    "assign",
    "tags",
    "number",
    "numbers",
    "rules",
    "broadcasts",
    "metrics",
    "links",
    "details",
    "reply",
    "note",
    "template",
    "window",
    "agent",
    "person",
    "send",
    "save",
    "cancel",
    "delete",
    "without",
    "by",
    "for",
    "the",
    "and",
    "with",
    "is",
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "sun",
    "jan",
    "apr",
    "aug",
    "am",
    "pm",
  ],
};

/**
 * The plain (non-function) string values of `strings` that `other` doesn't also use: the known
 * phrases of one locale. Shared values ("Sendo", "WhatsApp", "—") prove nothing and are dropped.
 */
export function knownStrings(strings: object, other: object): string[] {
  const shared = new Set(Object.values(other).filter((value) => typeof value === "string"));
  const known = Object.values(strings).filter(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  return [...new Set(known.filter((value) => !shared.has(value)))];
}

const LABEL_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt", "aria-description"];

/**
 * What a user can see or hear in `root`: its text, again with every text node on its own line
 * (adjacent table cells read as separate words, not "ShareDirect"), plus labels, titles and
 * placeholders.
 */
export function visibleText(root: ParentNode): string {
  const parts = [root.textContent ?? ""];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    parts.push(node.textContent ?? "");
  }
  for (const element of root.querySelectorAll("*")) {
    for (const name of LABEL_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value !== null) parts.push(value);
    }
  }
  return parts.join("\n");
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The `foreign` phrases found in `text` as whole words (so "Person" doesn't match "Persona"),
 * after removing `userData` (names, message bodies, tags: whatever the app stored).
 */
export function leakedStrings(
  text: string,
  foreign: readonly string[],
  userData: readonly string[] = [],
  flags = "u",
): string[] {
  let clean = text;
  for (const data of [...userData].sort((a, b) => b.length - a.length)) {
    clean = clean.split(data).join("\n");
  }
  return foreign.filter((phrase) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escape(phrase.trim())}(?![\\p{L}\\p{N}])`, flags).test(clean),
  );
}

/**
 * Every sign of `other` in `root` rendered in `locale`: `other`'s own phrases (exact) and its
 * `LANGUAGE_MARKERS` (any case), user data excluded. `strings` are the item's locale objects.
 */
export function leaksIn(
  root: ParentNode,
  strings: Record<SendoLocale, object>,
  locale: SendoLocale,
  other: SendoLocale,
  userData: readonly string[] = [],
): string[] {
  const text = visibleText(root);
  return [
    ...leakedStrings(text, knownStrings(strings[other], strings[locale]), userData),
    ...leakedStrings(text, LANGUAGE_MARKERS[other], userData, "iu"),
  ];
}
