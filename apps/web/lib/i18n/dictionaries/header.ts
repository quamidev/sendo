import type { Lang } from "../langs";

/** Site chrome: header labels plus the site-wide `<title>` and description. */
export interface HeaderDict {
  site: { title: string; titleTemplate: string; description: string };
  homeLabel: string;
  navLabel: string;
  nav: { docs: string; demo: string; compare: string; changelog: string; pricing: string };
  /** Shown next to Docs on `/es`: the docs are English only (AC-ST-13). */
  docsHint: string;
  /** The hint's tooltip and spoken text. */
  docsHintLabel: string;
  /** Mobile sheet entry for `/{lang}/demo`. */
  fullDemo: string;
  menu: { title: string; open: string; close: string };
  /** Version badge (AC-ST-13): `{version}` is e.g. `v0.1.0`. */
  version: { label: string };
  github: string;
  themeToggle: string;
  language: { label: string; names: Record<Lang, string> };
}

const names: Record<Lang, string> = { es: "Español", en: "English" };

export const header = {
  es: {
    site: {
      title: "Sendo — la bandeja de conversaciones que vive dentro de tu app",
      titleTemplate: "%s · Sendo",
      description:
        "WhatsApp con agentes de IA y personas que se turnan, instalado como tu propio código: un paquete npm con licencia MIT y componentes del registro shadcn para Next.js.",
    },
    homeLabel: "Sendo, inicio",
    navLabel: "Principal",
    nav: {
      docs: "Docs",
      demo: "Demo",
      compare: "Comparar",
      changelog: "Cambios",
      pricing: "Precios",
    },
    docsHint: "EN",
    docsHintLabel: "La documentación está en inglés",
    fullDemo: "Demo a pantalla completa",
    menu: { title: "Menú", open: "Abrir menú", close: "Cerrar menú" },
    version: { label: "@quami/sendo {version} en npm" },
    github: "GitHub",
    themeToggle: "Cambiar tema",
    language: { label: "Idioma", names },
  },
  en: {
    site: {
      title: "Sendo — the conversation inbox that lives inside your app",
      titleTemplate: "%s · Sendo",
      description:
        "WhatsApp with AI agents and people taking turns, installed as your own code: an MIT npm package and shadcn registry items for Next.js.",
    },
    homeLabel: "Sendo home",
    navLabel: "Main",
    nav: {
      docs: "Docs",
      demo: "Demo",
      compare: "Compare",
      changelog: "Changelog",
      pricing: "Pricing",
    },
    docsHint: "EN",
    docsHintLabel: "The docs are in English",
    fullDemo: "Full-screen demo",
    menu: { title: "Menu", open: "Open menu", close: "Close menu" },
    version: { label: "@quami/sendo {version} on npm" },
    github: "GitHub",
    themeToggle: "Toggle theme",
    language: { label: "Language", names },
  },
} satisfies Record<Lang, HeaderDict>;
