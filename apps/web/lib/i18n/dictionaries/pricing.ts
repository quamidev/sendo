import type { Lang } from "../langs";

/** Strings may use the inline markup of `rich()`: `` `code` ``, `**strong**`, `[label](/docs/x)`. */
export interface PricingPlanDict {
  name: string;
  price: string;
  priceNote: string;
  summary: string;
  points: string[];
  /** AC-CN-7: what Quami sees and keeps, rendered in the card at the same weight for both plans. */
  privacy: { title: string; points: string[] };
  cta: { href: string; label: string };
}

export interface PricingDict {
  meta: { title: string; description: string };
  title: string;
  intro: string;
  plansLabel: string;
  plans: { ownApp: PricingPlanDict; connect: PricingPlanDict };
  /** AC-ST-11: pages that promote coexistence link to `/docs/coexistence`. */
  coexistence: { heading: string; body: string };
  /**
   * AC-ST-12: link to Meta's rate card and explain the dimensions; never a Meta price figure
   * (`lib/content/no-meta-prices.test.ts`).
   */
  whoPaysMeta: {
    heading: string;
    body: string;
    dimensionsIntro: string;
    dimensions: string[];
    serviceChange: string;
  };
  billing: {
    title: string;
    /** AC-CN-4: the billing-readiness caveat Connect shows before a customer connects a number. */
    caveat: string;
    body: string;
  };
  privacy: { heading: string; points: string[] };
  sensitive: { heading: string; body: string };
  anchorLabel: string;
}

export const pricing = {
  es: {
    meta: {
      title: "Precios",
      description:
        "Sendo es gratis y de código abierto. Sendo Connect, con Quami como tu Tech Provider de Meta, es la única parte de pago. Meta cobra los mensajes al dueño de la cuenta de WhatsApp Business.",
    },
    title: "Precios",
    intro:
      "Sendo es gratis y de código abierto. La única parte de pago es **Sendo Connect**, para equipos que prefieren no hacer el papeleo de Meta. Quami nunca te cobra por mensajes.",
    plansLabel: "Planes",
    plans: {
      ownApp: {
        name: "Tu propia app de Meta",
        price: "Gratis",
        priceNote: "Licencia MIT",
        summary: "Eres tu propio Tech Provider de Meta. Todo corre en tus servidores.",
        points: [
          "El paquete, las migraciones y todos los componentes del registro",
          "La verificación del negocio y la revisión de la app en Meta corren por tu cuenta (de días a semanas)",
          "La opción correcta para apps con datos sensibles",
        ],
        privacy: {
          title: "Qué ve Quami",
          points: [
            "**Nada.** Meta envía los webhooks directo a tu app, y tu propia app de Meta es la que queda conectada a tus números.",
          ],
        },
        cta: { href: "/docs/meta-setup", label: "Guía de configuración de Meta" },
      },
      connect: {
        name: "Sendo Connect",
        price: "Precio próximamente",
        priceNote: "por número conectado, al mes",
        summary:
          "Quami es el Tech Provider, así que tus clientes pueden conectar números el mismo día.",
        points: [
          "Solo configuración: agrega `connect` a `createSendo`; el código es idéntico",
          "Embedded Signup con la app de Meta de Quami, sin papeleo para ti",
          "Webhooks reenviados por Quami, firmados con tu propio secreto",
          "Los envíos y tus datos quedan entre tu servidor y Meta",
        ],
        privacy: {
          title: "Qué ve y guarda Quami",
          points: [
            "Los webhooks pasan por el relay de Quami antes de llegar a tu app.",
            "El contenido de cada mensaje se **guarda cifrado solo mientras su entrega está pendiente**, y se borra al entregarse o a las 24 h. **Nunca se registra** en logs.",
            "Los metadatos de entrega (hora, proyecto, número, código de estado, intentos, latencia) se guardan **7 días**.",
            "**La app de Meta de Quami** es la que queda conectada a los números de tus clientes.",
          ],
        },
        cta: { href: "/docs/sendo-connect", label: "Cómo funciona Connect" },
      },
    },
    coexistence: {
      heading: "Sigue usando la app WhatsApp Business",
      body: "Las dos opciones admiten coexistencia: el dueño sigue respondiendo desde la app WhatsApp Business en su teléfono mientras el mismo número funciona en tu bandeja. Tiene límites reales (hay que abrir la app del teléfono al menos cada 13 días o la cuenta se desactiva), así que lee [los límites de la coexistencia](/docs/coexistence) antes de prometerla a un cliente.",
    },
    whoPaysMeta: {
      heading: "Quién le paga a Meta",
      body: "Meta cobra los mensajes de WhatsApp **directo al dueño de la cuenta de WhatsApp Business** (el edificio, la clínica, tu cliente), por mensaje entregado. Sendo no mueve dinero, y Quami solo cobra por Connect, nunca por mensajes. Aquí nunca copiamos las tarifas de Meta, porque cambian seguido: consulta el [tarifario oficial de Meta](https://developers.facebook.com/docs/whatsapp/pricing).",
      dimensionsIntro: "El precio de cada mensaje depende de:",
      dimensions: [
        "**La categoría**: marketing, utilidad, autenticación o servicio.",
        "**El código de país del destinatario**: Meta agrupa los países en mercados, y Guatemala entra en «Resto de América Latina».",
      ],
      serviceChange:
        "Meta anunció cambios en cómo cobra los mensajes de servicio. No afirmamos ninguna de las dos versiones: revisa la regla vigente en [la página de precios de Meta](https://developers.facebook.com/docs/whatsapp/pricing), y cómo funciona con Sendo en [Precios de Meta](/docs/meta-pricing).",
    },
    billing: {
      title: "Antes de que un cliente conecte un número",
      caveat: "Meta cobra los mensajes directo a tu cliente; necesita tarjeta en su cuenta.",
      body: "Como Tech Provider, Quami no tiene línea de crédito con Meta: cada cliente agrega su propia tarjeta en la configuración del negocio en Meta. Mientras no lo haga, los envíos fallan con el error 131042, y Sendo muestra “falta método de pago” en el número (`billingReady`).",
    },
    privacy: {
      heading: "Qué pasa por Quami",
      points: [
        "Con Connect, los webhooks **pasan por Quami en tránsito**: el relay los recibe de Meta y los reenvía a tu app, firmados con tu secreto.",
        "Connect guarda el contenido de un mensaje solo para entregarlo: **cifrado, mientras la entrega está pendiente**, y lo borra al entregarlo o cuando termina la ventana de reintentos de 24 horas. Nunca lo registra en logs. Los metadatos de entrega se guardan 7 días.",
        "El token de acceso del número se entrega a tu servidor una sola vez y Connect nunca lo guarda. Los mensajes y los contactos viven en tu base de datos. Detalles en [Sendo Connect](/docs/sendo-connect#privacy).",
      ],
    },
    sensitive: {
      heading: "Apps con datos sensibles",
      body: "Si tu app maneja datos sensibles, por ejemplo conversaciones clínicas en una app como MIDI Med, **usa tu propia app de Meta** para que ningún tercero quede en el camino de los mensajes. Es gratis y está igual de bien documentado: empieza con [la configuración de Meta](/docs/meta-setup) y [Embedded Signup](/docs/embedded-signup).",
    },
    anchorLabel: "Enlace a esta sección",
  },
  en: {
    meta: {
      title: "Pricing",
      description:
        "Sendo is free and open source. Sendo Connect, Quami as your Meta Tech Provider, is the only paid piece. Meta bills messages to the WhatsApp Business account owner.",
    },
    title: "Pricing",
    intro:
      "Sendo is free and open source. The only paid piece is **Sendo Connect**, for teams that would rather not do Meta’s paperwork. Quami never bills you for messages.",
    plansLabel: "Plans",
    plans: {
      ownApp: {
        name: "Your own Meta app",
        price: "Free",
        priceNote: "MIT license",
        summary: "You are your own Meta Tech Provider. Everything runs on your servers.",
        points: [
          "The package, the migrations and every registry component",
          "Meta’s business verification and app review are on you (days to weeks)",
          "The right choice for apps with sensitive data",
        ],
        privacy: {
          title: "What Quami sees",
          points: [
            "**Nothing.** Meta sends webhooks straight to your app, and your own Meta app is the one connected to your numbers.",
          ],
        },
        cta: { href: "/docs/meta-setup", label: "Meta setup guide" },
      },
      connect: {
        name: "Sendo Connect",
        price: "Price coming soon",
        priceNote: "per connected number, per month",
        summary: "Quami is the Tech Provider, so your customers can connect numbers the same day.",
        points: [
          "Configuration only: add `connect` to `createSendo`; the code is identical",
          "Embedded Signup through Quami’s Meta app, no paperwork for you",
          "Webhooks relayed through Quami, signed with your own secret",
          "Sending and your data stay between your server and Meta",
        ],
        privacy: {
          title: "What Quami sees and keeps",
          points: [
            "Webhooks pass through Quami’s relay on the way to your app.",
            "Each message body is **held encrypted only while its delivery is pending**, then deleted on success or after 24 h. Bodies are **never logged**.",
            "Delivery metadata (timestamp, project, number, status code, attempt count, latency) is kept for **7 days**.",
            "**Quami’s Meta app** is the one connected to your customers’ numbers.",
          ],
        },
        cta: { href: "/docs/sendo-connect", label: "How Connect works" },
      },
    },
    coexistence: {
      heading: "Keep the WhatsApp Business app",
      body: "Both options support coexistence: the owner keeps answering from the WhatsApp Business app on the phone while the same number works in your inbox. It has real limits (the phone app must be opened at least every 13 days, or the account is deactivated), so read [the coexistence limits](/docs/coexistence) before you promise it to a customer.",
    },
    whoPaysMeta: {
      heading: "Who pays Meta",
      body: "Meta bills the WhatsApp messages **directly to the owner of the WhatsApp Business account** (the building, the clinic, your customer), per delivered message. Sendo moves no money, and Quami bills only for Connect, never for messages. We never copy Meta’s rates here, because they change often: see [Meta’s official rate card](https://developers.facebook.com/docs/whatsapp/pricing).",
      dimensionsIntro: "The price of each message depends on:",
      dimensions: [
        "**The category**: marketing, utility, authentication or service.",
        "**The recipient’s country code**: Meta groups countries into markets, and Guatemala falls under “Rest of Latin America”.",
      ],
      serviceChange:
        "Meta has announced changes to how service messages are billed. We don’t claim either version: check the rule in force on [Meta’s pricing page](https://developers.facebook.com/docs/whatsapp/pricing), and how it works with Sendo in [Meta pricing](/docs/meta-pricing).",
    },
    billing: {
      title: "Before a customer connects a number",
      caveat: "Meta bills messages directly to your customer; they need a card on their account.",
      body: "As a Tech Provider, Quami has no credit line with Meta: each customer adds their own card in Meta Business Settings. Until they do, sends fail with error 131042, and Sendo shows “payment method missing” on the number (`billingReady`).",
    },
    privacy: {
      heading: "What passes through Quami",
      points: [
        "With Connect, webhooks **pass through Quami in transit**: the relay receives them from Meta and forwards them to your app, signed with your secret.",
        "Connect keeps a message body only to deliver it: **encrypted, while delivery is pending**, deleted on success or when the 24-hour retry window ends. Bodies are never logged. Delivery metadata is kept for 7 days.",
        "The number’s access token is returned to your server once and never stored by Connect. Messages and contacts live in your database. Details in [Sendo Connect](/docs/sendo-connect#privacy).",
      ],
    },
    sensitive: {
      heading: "Apps with sensitive data",
      body: "If your app handles sensitive data, for example clinical conversations in an app like MIDI Med, **use your own Meta app** so that no third party sits in the message path. It is free and documented just as well: start with [Meta setup](/docs/meta-setup) and [Embedded Signup](/docs/embedded-signup).",
    },
    anchorLabel: "Link to this section",
  },
} satisfies Record<Lang, PricingDict>;
