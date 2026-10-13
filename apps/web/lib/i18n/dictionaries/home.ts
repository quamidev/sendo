import type { Lang } from "../langs";

/**
 * Home page copy ("Your app stage", `home-option-b.html`; SNL-4.4 desktop, SNL-4.5 adds the mobile
 * keys). Strings may use the inline markup of `rich()`. The stage strings (`steps`, `host`,
 * `composerPrompt`) are read on the client by `components/site/stage-steps.tsx`,
 * `components/demo/host-app-frame.tsx` and `components/demo/demo-experience.tsx`; `mobile` by
 * `components/demo/mobile-demo.tsx`, `components/site/mobile-install-tabs.tsx` and the page.
 */
export interface HomeDict {
  meta: { description: string };
  /** The headline, split so the accent phrase renders in WhatsApp green. */
  headline: { lead: string; accent: string; tail: string };
  lede: string;
  install: {
    /** `aria-label` of the install row. */
    label: string;
    /** Short label next to each command. */
    notes: { package: string; registry: string };
    copy: { copy: string; copied: string; failed: string };
  };
  quickstart: string;
  /** The live demo stage. */
  stage: {
    /** `aria-label` of the stage section. */
    label: string;
    /** The step strip: 1 → 2 → 3, driven by the demo conversation's stage. */
    steps: [string, string, string];
    /** Composer placeholder while it pulses, until the first message. */
    composerPrompt: string;
  };
  /** The sample host app around the real inbox. */
  host: {
    /** `aria-label` of the frame. */
    label: string;
    brand: string;
    nav: { residents: string; payments: string; bookings: string; inbox: string; settings: string };
    /** Shown next to the inbox entry: the screen is Sendo's. */
    inboxBadge: string;
    /** The sidebar note; `@sendo/inbox` is code. */
    note: string;
  };
  /** Below `md` ("Two-view toggle", `home-mobile-option-a.html`). */
  mobile: {
    /** Small mono line over the headline. */
    eyebrow: string;
    /** Over the demo's segmented control. */
    tryIt: string;
    /** The segmented control: **Resident's phone | Team inbox**; `label` is its `aria-label`. */
    toggle: { label: string; phone: string; inbox: string };
    /** Suggestion chips over the composer until the first message (sent as typed). */
    chips: [string, string, string];
    /** Screen-reader text of the Team inbox badge; `{count}` is the number of updates. */
    unread: string;
    /** The tabbed install box; the commands are `INSTALL_COMMANDS`. */
    install: { label: string; tabs: [string, string] };
    docs: string;
    /** The compare link card. */
    compare: { title: string; detail: string };
    /** The note under it; `@sendo/inbox` is code. */
    biggerScreen: string;
  };
  footer: {
    timeNote: string;
    compare: string;
    unofficial: {
      question: string;
      answer: string;
      /** Link at the end of the answer, to the docs. */
      link: string;
    };
  };
}

/** Code: identical in both languages (and checked by `[CC-REG-NAMES]`). */
export const INSTALL_COMMANDS = {
  package: "pnpm add @quami/sendo ai zod",
  registry: "npx shadcn add @sendo/webhook @sendo/schema",
} as const;

export const home = {
  es: {
    meta: {
      description:
        "WhatsApp con agentes de IA y personas que se turnan, instalado como tu propio código: un paquete npm con licencia MIT y componentes del registro shadcn para Next.js.",
    },
    headline: { lead: "WhatsApp con IA, como ", accent: "una pantalla más", tail: " de tu app." },
    lede: "El trabajo de Respond.io o Kapso, instalado como tu propio código. Los mensajes viven en tu base de datos y cada contacto es un usuario que ya tienes.",
    install: {
      label: "Instalación",
      notes: { package: "paquete", registry: "tu código" },
      copy: { copy: "Copiar comando", copied: "Copiado", failed: "No se pudo copiar" },
    },
    quickstart: "Guía rápida",
    stage: {
      label: "Demo en vivo",
      steps: [
        "Escribe como residente en el teléfono",
        "El agente contesta por WhatsApp",
        "Tu equipo lo ve en tu app y puede tomar el control",
      ],
      composerPrompt: "Pregunta por la piscina…",
    },
    host: {
      label: "Ejemplo de tu app con la bandeja de Sendo",
      brand: "Torre Vista",
      nav: {
        residents: "Residentes",
        payments: "Cobros",
        bookings: "Reservas",
        inbox: "Bandeja",
        settings: "Ajustes",
      },
      inboxBadge: "sendo",
      note: "Tu app. La bandeja es `@sendo/inbox`, copiada a tu proyecto.",
    },
    mobile: {
      eyebrow: "@quami/sendo · MIT · WhatsApp Cloud API",
      tryIt: "Pruébalo: escribe como residente",
      toggle: {
        label: "Vista de la demo",
        phone: "Teléfono del residente",
        inbox: "Bandeja del equipo",
      },
      chips: ["¿Horario de la piscina?", "Me cobraron doble", "Hablar con alguien"],
      unread: "{count} sin leer en la bandeja del equipo",
      install: { label: "Instalación", tabs: ["1 · Paquete", "2 · Tu código"] },
      docs: "Docs",
      compare: { title: "vs Respond.io y Kapso", detail: "Qué cambia y cómo migrar" },
      biggerScreen:
        "La demo completa con dos paneles necesita una pantalla más grande. En el teléfono ves un panel a la vez, igual que tu equipo con `@sendo/inbox`.",
    },
    footer: {
      timeNote: "Con una app de Meta lista: menos de una hora a la primera respuesta.",
      compare: "Comparar con Respond.io y Kapso",
      unofficial: {
        question: "¿Por qué no una API no oficial?",
        answer:
          "Automatizan WhatsApp Web contra los términos de Meta, y los números terminan bloqueados. Tampoco pueden enviar plantillas aprobadas, así que no pueden iniciar una conversación fuera de la ventana de 24 horas, y los recordatorios y la administración de propiedades dependen justo de eso.",
        link: "Sendo usa la API oficial: configúrala",
      },
    },
  },
  en: {
    meta: {
      description:
        "WhatsApp with AI agents and people taking turns, installed as your own code: an MIT npm package and shadcn registry items for Next.js.",
    },
    headline: { lead: "WhatsApp with AI, as ", accent: "one more screen", tail: " of your app." },
    lede: "The job of Respond.io or Kapso, installed as your own code. Messages live in your database and every contact is a user you already have.",
    install: {
      label: "Install",
      notes: { package: "package", registry: "your code" },
      copy: { copy: "Copy command", copied: "Copied", failed: "Copy failed" },
    },
    quickstart: "Quickstart",
    stage: {
      label: "Live demo",
      steps: [
        "Write as a resident on the phone",
        "The agent replies on WhatsApp",
        "Your team sees it in your app and can take over",
      ],
      composerPrompt: "Ask about the pool…",
    },
    host: {
      label: "Sample app with the Sendo inbox",
      brand: "Torre Vista",
      nav: {
        residents: "Residents",
        payments: "Payments",
        bookings: "Bookings",
        inbox: "Inbox",
        settings: "Settings",
      },
      inboxBadge: "sendo",
      note: "Your app. The inbox is `@sendo/inbox`, copied into your project.",
    },
    mobile: {
      eyebrow: "@quami/sendo · MIT · WhatsApp Cloud API",
      tryIt: "Try it: write as a resident",
      toggle: { label: "Demo view", phone: "Resident's phone", inbox: "Team inbox" },
      chips: ["Pool hours?", "I was charged twice", "Talk to someone"],
      unread: "{count} unread in the team inbox",
      install: { label: "Install", tabs: ["1 · Package", "2 · Your code"] },
      docs: "Docs",
      compare: { title: "vs Respond.io & Kapso", detail: "What changes and how to migrate" },
      biggerScreen:
        "The full two-panel demo needs a bigger screen. On a phone you see one panel at a time, just like your team does with `@sendo/inbox`.",
    },
    footer: {
      timeNote: "With a Meta app ready: under an hour to the first reply.",
      compare: "Compare with Respond.io & Kapso",
      unofficial: {
        question: "Why not an unofficial API?",
        answer:
          "They automate WhatsApp Web against Meta’s terms, and numbers get banned. They also can’t send approved templates, so they can’t start a conversation outside the 24-hour window, and reminders and property management depend on exactly that.",
        link: "Sendo uses the official API: set it up",
      },
    },
  },
} satisfies Record<Lang, HomeDict>;
