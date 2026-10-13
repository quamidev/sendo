import type { Lang } from "../langs";

/**
 * Home page copy. STUB from SNL-4.1: the keys the current page needs. SNL-4.4/4.5 own this file
 * and reshape it for the new layout. Strings may use the inline markup of `rich()`.
 */
export interface HomeDict {
  meta: { description: string };
  eyebrow: string;
  headline: string;
  lede: string;
  unofficial: { question: string; answer: string };
  installLabel: string;
  installNotes: { package: string; registry: string };
  quickstart: string;
  docs: string;
  fullDemo: string;
  timeNote: string;
  demo: { lead: string; body: string };
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
    eyebrow: "@quami/sendo · código abierto (MIT) · WhatsApp Cloud API · Next.js",
    headline: "La bandeja de conversaciones que vive dentro de tu app.",
    lede: "Sendo hace el trabajo de Respond.io o Kapso, WhatsApp con agentes de IA y personas que se turnan, pero lo instalas como tu propio código. Los mensajes viven en tu base de datos, cada contacto es un usuario que tu app ya tiene, y la bandeja es una pantalla más de tu app.",
    unofficial: {
      question: "¿Por qué no una API no oficial de WhatsApp?",
      answer:
        "Automatizan WhatsApp Web contra los términos de Meta, y los números terminan bloqueados. Tampoco pueden enviar plantillas aprobadas, así que no pueden iniciar una conversación fuera de la ventana de 24 horas, y los recordatorios y la administración de propiedades dependen justo de eso.",
    },
    installLabel: "Instalación",
    installNotes: {
      package: "El paquete: webhook, envíos, agentes, bandeja",
      registry: "Tu código: la ruta del webhook y el esquema, del registro @sendo",
    },
    quickstart: "Guía rápida",
    docs: "Docs",
    fullDemo: "Demo en pantalla completa",
    timeNote:
      "Con una app de Meta lista, la primera respuesta del agente en tu propio número toma menos de una hora. Desde cero, la verificación del negocio y la revisión de Meta pueden tardar días o semanas.",
    demo: {
      lead: "Demo en vivo.",
      body: "Escribe como residente en el chat. A su lado está la `inbox` real con datos de ejemplo y el adaptador en memoria, mostrando tu conversación como la ve el equipo.",
    },
  },
  en: {
    meta: {
      description:
        "WhatsApp with AI agents and people taking turns, installed as your own code: an MIT npm package and shadcn registry items for Next.js.",
    },
    eyebrow: "@quami/sendo · open source (MIT) · WhatsApp Cloud API · Next.js",
    headline: "The conversation inbox that lives inside your app.",
    lede: "Sendo does the job of Respond.io or Kapso, WhatsApp with AI agents and people taking turns, but you install it as your own code. Messages live in your database, every contact is a user your app already has, and the inbox is one more screen of your app.",
    unofficial: {
      question: "Why not an unofficial WhatsApp API?",
      answer:
        "They automate WhatsApp Web against Meta’s terms, and numbers get banned. They also can’t send approved templates, so they can’t start a conversation outside the 24-hour window, and reminders and property management depend on exactly that.",
    },
    installLabel: "Install",
    installNotes: {
      package: "The package: webhook, sending, agents, inbox",
      registry: "Your code: the webhook route and the schema, from the @sendo registry",
    },
    quickstart: "Quickstart",
    docs: "Docs",
    fullDemo: "Full-screen demo",
    timeNote:
      "With a Meta app ready, the first agent reply on your own number takes under an hour. From zero, Meta’s business verification and review can take days or weeks.",
    demo: {
      lead: "Live demo.",
      body: "Write as a resident in the chat. Next to it is the real `inbox` on fixtures and the memory adapter, showing your conversation as the team sees it.",
    },
  },
} satisfies Record<Lang, HomeDict>;
