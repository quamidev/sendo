import type { Lang } from "../langs";

/** The products compared, in column order. */
export const COMPARE_PRODUCTS = ["sendo", "respondIo", "kapso"] as const;
export type CompareProduct = (typeof COMPARE_PRODUCTS)[number];

/** The dimensions compared (product spec §2.5), in row order. */
export const COMPARE_ROWS = [
  "data",
  "pricing",
  "agents",
  "handoff",
  "templates",
  "coexistence",
  "lockIn",
  "maintain",
] as const;
export type CompareRow = (typeof COMPARE_ROWS)[number];

/**
 * `/[lang]/compare` (AC-ST-10). Strings may use the inline markup of `rich()`.
 *
 * Competitor cells stay general and verifiable: only what Respond.io's and Kapso's public pages
 * said as of Oct 2026, each phrased "per their public site" (or docs / help center), never a
 * figure or a price. Re-check them against those pages before changing a cell.
 */
export interface CompareDict {
  meta: { title: string; description: string };
  title: string;
  intro: string;
  /** Shown above the table: the date and the source of every competitor claim. */
  asOf: string;
  table: {
    caption: string;
    dimension: string;
    products: Record<CompareProduct, string>;
  };
  rows: Record<CompareRow, { label: string } & Record<CompareProduct, string>>;
  fit: {
    heading: string;
    sendo: { title: string; points: string[] };
    others: { title: string; points: string[] };
  };
  migrate: { heading: string; body: string };
  disclaimer: string;
  anchorLabel: string;
}

export const compare = {
  es: {
    meta: {
      title: "Sendo vs Respond.io vs Kapso",
      description:
        "En qué se parece y en qué se diferencia Sendo de Respond.io y Kapso: dónde viven los datos, el modelo de precios, agentes de IA, plantillas, coexistencia y lo que mantienes tú.",
    },
    title: "Sendo vs Respond.io vs Kapso",
    intro:
      "Sendo hace el mismo trabajo que Respond.io o Kapso, pero se instala como tu propio código: la bandeja es una pantalla de tu app y las conversaciones viven en tu base de datos.",
    asOf: "Datos de Respond.io y Kapso a octubre de 2026, tomados solo de sus páginas públicas. Pueden haber cambiado; revisa sus sitios antes de decidir.",
    table: {
      caption: "Sendo, Respond.io y Kapso, punto por punto (a octubre de 2026)",
      dimension: "Tema",
      products: { sendo: "Sendo", respondIo: "Respond.io", kapso: "Kapso" },
    },
    rows: {
      data: {
        label: "Dónde viven los datos",
        sendo:
          "En tu propia base de datos Postgres, dentro de tu app. Los webhooks llegan de Meta a tu servidor (o pasan en tránsito por el relay de [Sendo Connect](/docs/sendo-connect#privacy)).",
        respondIo: "En su plataforma alojada, según su sitio público.",
        kapso:
          "En su plataforma alojada; tu app la usa con su API, webhooks y SDKs, según su sitio público.",
      },
      pricing: {
        label: "Modelo de precios",
        sendo:
          "Gratis, licencia MIT. **Sendo Connect** (opcional) se cobra por número conectado. Meta cobra los mensajes directo al dueño de la cuenta ([Precios de Meta](/docs/meta-pricing)).",
        respondIo:
          "Suscripción mensual por plan, según contactos activos al mes y usuarios; las tarifas de WhatsApp de Meta van aparte, según su sitio público.",
        kapso:
          "Plan gratuito y planes mensuales con mensajes y números incluidos; las tarifas de Meta van aparte, según su sitio público.",
      },
      agents: {
        label: "Agentes de IA",
        sendo:
          "`sendo.agent` con el modelo y el proveedor que elijas; herramientas, borradores y límites en tu código ([Agentes y modelos](/docs/agents-and-models)).",
        respondIo: "Agentes de IA incluidos en algunos planes, según su sitio público.",
        kapso: "Agentes de IA y flujos incluidos, según su sitio público.",
      },
      handoff: {
        label: "Paso a una persona",
        sendo:
          "Bandeja de equipo dentro de tu app: traspaso, asignación, notas y borradores; la IA se pausa cuando una persona interviene ([Bandeja de equipo](/docs/team-inbox)).",
        respondIo: "Bandejas de equipo en su app web y móvil, según su sitio público.",
        kapso: "Bandeja y traspaso a personas, según su sitio público.",
      },
      templates: {
        label: "Plantillas",
        sendo:
          "Se crean en el WhatsApp Manager de Meta, se sincronizan a tu base de datos y se envían desde la bandeja y los [envíos masivos](/docs/broadcasts).",
        respondIo: "Se gestionan y se envían desde su plataforma, según su sitio público.",
        kapso: "Incluidas entre las funciones de su API, según su sitio público.",
      },
      coexistence: {
        label: "Coexistencia con la app WhatsApp Business",
        sendo:
          "Sí: guarda lo que el dueño envía desde el teléfono, pausa la IA donde el dueño respondió e importa el historial si quieres. Tiene límites: [léelos antes](/docs/coexistence).",
        respondIo: "Disponible, según su centro de ayuda.",
        kapso: "Disponible como tipo de conexión, según su documentación.",
      },
      lockIn: {
        label: "Dependencia del proveedor",
        sendo:
          "Baja: el código queda en tu repositorio (MIT) y los datos en tu base de datos. Tu número sigue en tu cuenta de WhatsApp Business.",
        respondIo:
          "Tus conversaciones viven en su plataforma; salir implica exportarlas y mover el número.",
        kapso:
          "Tus mensajes pasan por su plataforma; salir implica cambiar tu integración y mover el número.",
      },
      maintain: {
        label: "Lo que mantienes tú",
        sendo:
          "Tu app, su base de datos y su hosting, las actualizaciones del paquete y tu propia app de Meta (o Sendo Connect).",
        respondIo: "La configuración y las integraciones; ellos operan la plataforma.",
        kapso: "Tu integración con su API; ellos operan la plataforma.",
      },
    },
    fit: {
      heading: "Cuál te conviene",
      sendo: {
        title: "Sendo, si…",
        points: [
          "Ya tienes una app y quieres que WhatsApp sea una pantalla más de ella.",
          "Quieres las conversaciones en tu base de datos, por ejemplo por datos sensibles.",
          "Tu equipo prefiere escribir código a configurar una plataforma.",
        ],
      },
      others: {
        title: "Respond.io o Kapso, si…",
        points: [
          "No quieres operar servidores ni base de datos.",
          "Necesitas varios canales listos desde el primer día sin escribir código.",
          "Prefieres que otro equipo mantenga la bandeja y la infraestructura.",
        ],
      },
    },
    migrate: {
      heading: "Migrar desde Respond.io o Kapso",
      body: "Migrar es sobre todo mover el número de WhatsApp; los contactos y los flujos se importan. La guía paso a paso está en [Migrar desde Respond.io o Kapso](/docs/migrating-from-respond-io-kapso).",
    },
    disclaimer:
      "Respond.io y Kapso son marcas de sus dueños. Esta página no está afiliada a ellos; si algo cambió, avísanos en GitHub.",
    anchorLabel: "Enlace a esta sección",
  },
  en: {
    meta: {
      title: "Sendo vs Respond.io vs Kapso",
      description:
        "How Sendo compares with Respond.io and Kapso: where the data lives, the pricing model, AI agents, templates, coexistence and what you maintain yourself.",
    },
    title: "Sendo vs Respond.io vs Kapso",
    intro:
      "Sendo does the same job as Respond.io or Kapso, but you install it as your own code: the inbox is a screen of your app and the conversations live in your database.",
    asOf: "Respond.io and Kapso details as of Oct 2026, taken only from their public pages. They may have changed; check their sites before you decide.",
    table: {
      caption: "Sendo, Respond.io and Kapso, point by point (as of Oct 2026)",
      dimension: "Topic",
      products: { sendo: "Sendo", respondIo: "Respond.io", kapso: "Kapso" },
    },
    rows: {
      data: {
        label: "Where data lives",
        sendo:
          "In your own Postgres database, inside your app. Webhooks go from Meta to your server (or pass in transit through the [Sendo Connect](/docs/sendo-connect#privacy) relay).",
        respondIo: "On their hosted platform, per their public site.",
        kapso:
          "On their hosted platform; your app reaches it through their API, webhooks and SDKs, per their public site.",
      },
      pricing: {
        label: "Pricing model",
        sendo:
          "Free, MIT license. **Sendo Connect** (optional) is billed per connected number. Meta bills messages directly to the account owner ([Meta pricing](/docs/meta-pricing)).",
        respondIo:
          "Monthly subscription by plan, based on monthly active contacts and users; Meta’s WhatsApp fees are separate, per their public site.",
        kapso:
          "A free tier and monthly plans with included messages and numbers; Meta’s fees are separate, per their public site.",
      },
      agents: {
        label: "AI agents",
        sendo:
          "`sendo.agent` with the model and provider you choose; tools, drafts and limits in your code ([Agents and models](/docs/agents-and-models)).",
        respondIo: "AI agents included on some plans, per their public site.",
        kapso: "AI agents and workflows included, per their public site.",
      },
      handoff: {
        label: "Human handoff",
        sendo:
          "A team inbox inside your app: handoff, assignment, notes and drafts; the AI pauses when a person steps in ([Team inbox](/docs/team-inbox)).",
        respondIo: "Team inboxes in their web and mobile apps, per their public site.",
        kapso: "Inbox and human handoff, per their public site.",
      },
      templates: {
        label: "Templates",
        sendo:
          "Created in Meta’s WhatsApp Manager, synced to your database and sent from the inbox and [broadcasts](/docs/broadcasts).",
        respondIo: "Managed and sent from their platform, per their public site.",
        kapso: "Listed among their API features, per their public site.",
      },
      coexistence: {
        label: "Coexistence with the WhatsApp Business app",
        sendo:
          "Yes: stores what the owner sends from the phone, pauses the AI where the owner replied and imports history if you want. It has limits: [read them first](/docs/coexistence).",
        respondIo: "Offered, per their help center.",
        kapso: "Offered as a connection type, per their docs.",
      },
      lockIn: {
        label: "Lock-in",
        sendo:
          "Low: the code sits in your repository (MIT) and the data in your database. Your number stays on your WhatsApp Business account.",
        respondIo:
          "Your conversations live on their platform; leaving means exporting them and moving the number.",
        kapso:
          "Your messages flow through their platform; leaving means changing your integration and moving the number.",
      },
      maintain: {
        label: "What you maintain yourself",
        sendo:
          "Your app, its database and hosting, package updates, and your own Meta app (or Sendo Connect).",
        respondIo: "Configuration and integrations; they run the platform.",
        kapso: "Your integration with their API; they run the platform.",
      },
    },
    fit: {
      heading: "Which one fits",
      sendo: {
        title: "Sendo, if…",
        points: [
          "You already have an app and want WhatsApp to be one more screen of it.",
          "You want the conversations in your database, for example because the data is sensitive.",
          "Your team would rather write code than configure a platform.",
        ],
      },
      others: {
        title: "Respond.io or Kapso, if…",
        points: [
          "You don’t want to run servers or a database.",
          "You need several channels ready on day one without writing code.",
          "You would rather have another team maintain the inbox and the infrastructure.",
        ],
      },
    },
    migrate: {
      heading: "Migrating from Respond.io or Kapso",
      body: "Migrating is mostly about moving the WhatsApp number; contacts and workflows are imported. The step-by-step guide is in [Migrating from Respond.io or Kapso](/docs/migrating-from-respond-io-kapso).",
    },
    disclaimer:
      "Respond.io and Kapso are trademarks of their owners. This page is not affiliated with them; if something changed, tell us on GitHub.",
    anchorLabel: "Link to this section",
  },
} satisfies Record<Lang, CompareDict>;
