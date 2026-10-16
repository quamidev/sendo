import { demo } from "@/lib/i18n/dictionaries/demo";
import type { Lang } from "@/lib/i18n/langs";
import { DEMO_CODE_URL } from "./protocol";

/** The scripted reply in `lang` (product spec, edge cases: "Demo model cap reached"). */
export function demoFallbackText(lang: Lang): string {
  return demo[lang].agent.fallbackText.replace("{url}", DEMO_CODE_URL);
}

/** What the demo server writes in `lang`: handoff message, names, labels. */
export function demoCopy(lang: Lang) {
  return { ...demo[lang].agent, ...demo[lang].world, fallbackText: demoFallbackText(lang) };
}
