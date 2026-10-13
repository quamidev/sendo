import type { Lang } from "../langs";

/** Site footer copy. Not rendered by SNL-4.1 (the home must fit one screen, AC-ST-6). */
export interface FooterDict {
  tagline: string;
  license: string;
  docsNote: string;
  links: { docs: string; changelog: string; pricing: string; compare: string; github: string };
  madeBy: string;
}

export const footer = {
  es: {
    tagline: "La bandeja de conversaciones que vive dentro de tu app.",
    license: "Código abierto, licencia MIT.",
    docsNote: "La documentación técnica está en inglés.",
    links: {
      docs: "Docs",
      changelog: "Cambios",
      pricing: "Precios",
      compare: "Comparar",
      github: "GitHub",
    },
    madeBy: "Hecho por Quami.",
  },
  en: {
    tagline: "The conversation inbox that lives inside your app.",
    license: "Open source, MIT license.",
    docsNote: "The technical docs are in English.",
    links: {
      docs: "Docs",
      changelog: "Changelog",
      pricing: "Pricing",
      compare: "Compare",
      github: "GitHub",
    },
    madeBy: "Built by Quami.",
  },
} satisfies Record<Lang, FooterDict>;
