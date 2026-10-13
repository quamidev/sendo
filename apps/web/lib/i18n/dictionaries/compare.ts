import type { Lang } from "../langs";

/** `/[lang]/compare`. STUB from SNL-4.1: SNL-4.6 owns this file and adds the comparison. */
export interface CompareDict {
  meta: { title: string; description: string };
  title: string;
  intro: string;
  placeholder: string;
}

export const compare = {
  es: {
    meta: {
      title: "Sendo vs Respond.io vs Kapso",
      description:
        "En qué se parece y en qué se diferencia Sendo de Respond.io y Kapso: dónde viven los datos, el modelo de precios y lo que mantienes tú.",
    },
    title: "Sendo vs Respond.io vs Kapso",
    intro:
      "Sendo hace el mismo trabajo que Respond.io o Kapso, pero se instala como tu propio código.",
    placeholder: "La comparación completa llega pronto.",
  },
  en: {
    meta: {
      title: "Sendo vs Respond.io vs Kapso",
      description:
        "How Sendo compares with Respond.io and Kapso: where the data lives, the pricing model and what you maintain yourself.",
    },
    title: "Sendo vs Respond.io vs Kapso",
    intro: "Sendo does the same job as Respond.io or Kapso, but you install it as your own code.",
    placeholder: "The full comparison is coming soon.",
  },
} satisfies Record<Lang, CompareDict>;
