import type { Lang } from "../langs";

/**
 * Site footer copy (`components/site/site-footer.tsx`, on the content pages). The home fills one
 * screen (AC-ST-6), so it shows only the legal links (`legal`), in its own footer line.
 */
export interface FooterDict {
  tagline: string;
  license: string;
  docsNote: string;
  groups: { product: string; legal: string };
  links: { docs: string; changelog: string; pricing: string; compare: string; github: string };
  legal: { privacy: string; terms: string; dataDeletion: string };
  madeBy: string;
}

export const footer = {
  es: {
    tagline: "La bandeja de conversaciones que vive dentro de tu app.",
    license: "Código abierto, licencia MIT.",
    docsNote: "La documentación técnica está en inglés.",
    groups: { product: "Producto", legal: "Legal" },
    links: {
      docs: "Docs",
      changelog: "Cambios",
      pricing: "Precios",
      compare: "Comparar",
      github: "GitHub",
    },
    legal: {
      privacy: "Privacidad",
      terms: "Términos",
      dataDeletion: "Eliminación de datos",
    },
    madeBy: "Hecho por Quami.",
  },
  en: {
    tagline: "The conversation inbox that lives inside your app.",
    license: "Open source, MIT license.",
    docsNote: "The technical docs are in English.",
    groups: { product: "Product", legal: "Legal" },
    links: {
      docs: "Docs",
      changelog: "Changelog",
      pricing: "Pricing",
      compare: "Compare",
      github: "GitHub",
    },
    legal: {
      privacy: "Privacy",
      terms: "Terms",
      dataDeletion: "Data deletion",
    },
    madeBy: "Built by Quami.",
  },
} satisfies Record<Lang, FooterDict>;
