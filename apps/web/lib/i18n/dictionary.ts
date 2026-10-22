import { changelog, type ChangelogDict } from "./dictionaries/changelog";
import { compare, type CompareDict } from "./dictionaries/compare";
import { demo, type DemoDict } from "./dictionaries/demo";
import { footer, type FooterDict } from "./dictionaries/footer";
import { header, type HeaderDict } from "./dictionaries/header";
import { home, type HomeDict } from "./dictionaries/home";
import { legal, type LegalDict } from "./dictionaries/legal";
import { pricing, type PricingDict } from "./dictionaries/pricing";
import type { Lang } from "./langs";

/** All marketing copy. Each section file exports `{ es, en } satisfies Record<Lang, <Section>Dict>`. */
export interface SiteDictionary {
  header: HeaderDict;
  footer: FooterDict;
  home: HomeDict;
  pricing: PricingDict;
  compare: CompareDict;
  demo: DemoDict;
  changelog: ChangelogDict;
  legal: LegalDict;
}

/** Every section in both languages: what the leak test walks. */
export const DICTIONARY_SECTIONS = {
  header,
  footer,
  home,
  pricing,
  compare,
  demo,
  changelog,
  legal,
} satisfies { [Section in keyof SiteDictionary]: Record<Lang, SiteDictionary[Section]> };

export function getDictionary(lang: Lang): SiteDictionary {
  return {
    header: header[lang],
    footer: footer[lang],
    home: home[lang],
    pricing: pricing[lang],
    compare: compare[lang],
    demo: demo[lang],
    changelog: changelog[lang],
    legal: legal[lang],
  };
}
