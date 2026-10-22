import type { Lang } from "../langs";
import type { LegalPageDict } from "./legal";

/** `/[lang]/privacy`. Facts: `content/docs/sendo-connect.mdx#privacy`, `lib/demo/{handler,limits}.ts`. */
export const privacy = {
  es: {
    meta: {
      title: "Política de privacidad",
      description:
        "Qué datos personales trata {shortName} ({brand}) en sendo.quami.dev y en Sendo Connect, para qué, cuánto tiempo los guarda y cómo ejercer tus derechos.",
    },
    title: "Política de privacidad",
    intro:
      "Esta política explica qué datos personales recopila {shortName} («{brand}», «nosotros») a través del sitio de Sendo y del servicio Sendo Connect, para qué los usamos, cuánto tiempo los guardamos, con quién los compartimos y cómo puedes ejercer tus derechos.",
    sections: [
      {
        id: "quienes-somos",
        heading: "Quiénes somos",
        blocks: [
          "{shortName} es una empresa de {country}. Publicamos Sendo, una librería de código abierto para WhatsApp, y operamos Sendo Connect, un servicio opcional de pago. {shortName} es responsable de los datos personales que describe esta política, salvo donde decimos que actuamos por cuenta de un cliente.",
          "Para cualquier consulta sobre privacidad escríbenos a [{email}](mailto:{email}).",
        ],
      },
      {
        id: "alcance",
        heading: "Qué cubre esta política",
        blocks: [
          [
            "**El sitio** sendo.quami.dev: las páginas informativas, la documentación, la demo y el registro de componentes.",
            "**Sendo Connect**: el relay de webhooks (connect.sendo.quami.dev) y el panel de clientes (app.sendo.quami.dev).",
          ],
          "**El paquete de código abierto y el registro** (`@quami/sendo` y los componentes que copias a tu proyecto) corren dentro de tu propia app, en tus servidores y con tu propia base de datos. Los mensajes, contactos y tokens que manejan nunca llegan a {brand}. De esos datos eres responsable tú, no {brand}, y tú informas a tus usuarios cómo los usas.",
        ],
      },
      {
        id: "mensajes-de-connect",
        heading: "Mensajes reenviados por Sendo Connect",
        blocks: [
          "Cuando un negocio usa Sendo Connect, Meta envía los webhooks de WhatsApp de sus números al relay de {brand}, que los reenvía a la app de ese negocio. Con ese contenido, {brand} actúa **por cuenta del negocio** (nuestro cliente), que decide para qué y cómo se tratan los datos de sus usuarios finales y responde por ellos.",
          "Si le escribiste por WhatsApp a un negocio que usa Sendo, se aplica a tus mensajes la política de privacidad de ese negocio. En [Eliminación de datos](/es/data-deletion) explicamos cómo contactarlo o contactarnos.",
        ],
      },
      {
        id: "datos",
        heading: "Qué datos recopilamos",
        blocks: [
          "**Cuentas del panel de Connect.** Tu correo electrónico (inicias sesión con un código de un solo uso que te enviamos por correo), los proyectos que creas, tus API keys (guardadas solo como hash), tus secretos de firma (guardados en una bóveda cifrada), la URL de webhook que registras y los números de WhatsApp conectados a cada proyecto.",
          "**Facturación.** Tu plan, tus facturas y el estado de tus pagos. Los pagos los procesa Recurrente: los datos de tu tarjeta se ingresan y se guardan en Recurrente, nunca en {brand}.",
          "**Webhooks reenviados.** El contenido de cada webhook que Meta envía para un número conectado (puede incluir el texto de los mensajes, referencias a archivos, números de teléfono y nombres de perfil de quienes escriben al negocio) se **guarda cifrado solo mientras su entrega está pendiente**, y se borra al entregarse o cuando termina la ventana de reintentos de 24 horas. **Nunca se registra en logs.** De cada entrega guardamos metadatos: hora, proyecto, número, código de estado, cantidad de intentos y latencia.",
          "**Tokens de acceso de WhatsApp.** Cuando un cliente conecta un número con Embedded Signup, el token de acceso del negocio que emite Meta se entrega una sola vez al servidor del cliente y Connect **nunca lo guarda**.",
          "**La demo.** Lo que escribes en la demo se envía a nuestro servidor y se guarda en el almacenamiento de sesión de tu navegador, que se borra al cerrar la pestaña. Cuando la demo usa un modelo de IA, la conversación se envía a un proveedor de modelos a través de Vercel AI Gateway para generar la respuesta. El servidor no guarda la conversación. Para limitar abusos y costos cuenta los mensajes por dirección IP y por día en un almacén Redis; esos contadores vencen a los 2 días. No escribas datos personales en la demo.",
          "**Visitas al sitio.** Nuestro proveedor de hosting (Vercel) procesa datos técnicos de cada solicitud, como la dirección IP, el navegador y la URL pedida, para servir el sitio y protegerlo. El sitio guarda una sola cookie, `sendo-lang`, y solo cuando eliges un idioma, para recordarlo durante un año; el tema claro u oscuro que eliges queda en el almacenamiento local de tu navegador. No usamos analítica, publicidad ni scripts de rastreo de terceros.",
          "**Correos que nos envías.** Si nos escribes, guardamos tu mensaje y tu dirección para responderte y dejar constancia de la solicitud.",
        ],
      },
      {
        id: "finalidades",
        heading: "Para qué los usamos y con qué base",
        blocks: [
          [
            "Para prestar Sendo Connect (inicio de sesión, proyectos, reenvío de webhooks a la URL que registraste, conexión de números): porque es necesario para cumplir nuestro contrato contigo.",
            "Para cobrar Connect y llevar la contabilidad: por el contrato y por obligaciones legales.",
            "Para mantener el servicio seguro y funcionando (metadatos de entrega, límites de la demo, investigación de fallas): por nuestro interés legítimo en operar un servicio confiable y seguro.",
            "Para reenviar los mensajes de los usuarios finales: por instrucción del cliente, que debe tener su propia base legal frente a sus usuarios.",
            "Para responder tus solicitudes: porque nos las pides y por nuestro interés legítimo en atenderlas.",
          ],
          "No vendemos datos personales, no los usamos para publicidad y no usamos los mensajes reenviados para entrenar modelos de IA.",
        ],
      },
      {
        id: "conservacion",
        heading: "Cuánto tiempo los guardamos",
        blocks: [
          [
            "Contenido de los webhooks reenviados: hasta entregarse, como máximo 24 horas.",
            "Metadatos de entrega: 7 días.",
            "Tokens de acceso de WhatsApp: no se guardan.",
            "Datos de la cuenta del panel (correo, proyectos, números, API keys, secretos): mientras la cuenta esté abierta; se borran dentro de los 30 días siguientes a que la cierres o nos pidas borrarlos.",
            "Registros de facturación: el tiempo que exija la ley tributaria y contable de {country}.",
            "Contadores de la demo: 2 días (el total mensual de gasto, que no contiene datos personales, 40 días). Las conversaciones de la demo solo quedan en la pestaña de tu navegador.",
            "Registros técnicos del hosting: un período corto, según la configuración de retención de Vercel.",
            "Correos que nos envías: mientras haga falta para atender tu solicitud y dejar constancia de ella.",
          ],
        ],
      },
      {
        id: "con-quien-compartimos",
        heading: "Con quién los compartimos",
        blocks: [
          "Solo compartimos datos personales con los proveedores que operan el servicio por nosotros, bajo sus condiciones de tratamiento de datos, y con autoridades cuando la ley lo exige:",
          [
            "**Vercel** (Estados Unidos): hosting del sitio, del relay y del panel, y el AI Gateway que usa la demo.",
            "**Supabase** (Estados Unidos): base de datos y autenticación de las cuentas de Connect.",
            "**Resend** (Estados Unidos): envío de los códigos de inicio de sesión y de los correos del servicio.",
            "**Recurrente** ({country}): procesamiento de pagos y datos de tarjeta.",
            "**Meta** (WhatsApp Business Platform): entrega los webhooks que reenviamos y emite los tokens durante Embedded Signup. A WhatsApp se le aplican los términos y la política de privacidad de Meta.",
            "**El proveedor de modelos de IA** que use la demo, a través de Vercel AI Gateway: solo la conversación de la demo.",
          ],
        ],
      },
      {
        id: "transferencias",
        heading: "Transferencias internacionales",
        blocks: [
          "La mayoría de nuestros proveedores están en Estados Unidos o guardan datos allí, así que tus datos pueden tratarse fuera de tu país. Elegimos proveedores con prácticas de seguridad reconocidas y nos apoyamos en sus garantías contractuales, como las cláusulas contractuales tipo cuando aplican.",
        ],
      },
      {
        id: "seguridad",
        heading: "Seguridad",
        blocks: [
          "El contenido de los webhooks se guarda cifrado mientras espera su entrega, las API keys se guardan como hash y los secretos de firma en una bóveda cifrada. Todo el tráfico usa HTTPS, cada webhook reenviado va firmado con el secreto propio del cliente y el acceso a los sistemas de producción se limita a quienes operan el servicio. Ningún sistema es perfectamente seguro: si una brecha afecta tus datos, te avisaremos a ti y a las autoridades como lo exija la ley.",
        ],
      },
      {
        id: "derechos",
        heading: "Tus derechos",
        blocks: [
          "Puedes pedirnos acceder a tus datos personales, corregirlos, borrarlos o recibir una copia, oponerte a un uso o pedir que lo limitemos, y retirar tu consentimiento cuando nos basemos en él. Escríbenos a [{email}](mailto:{email}) desde el correo de tu cuenta (o dinos cómo identificarte). Respondemos dentro de 30 días.",
          "Si tus datos son mensajes que le enviaste a un negocio que usa Sendo Connect, contacta primero a ese negocio: es quien controla esos datos. También puedes presentar un reclamo ante la autoridad de protección de datos de tu país, si existe.",
        ],
      },
      {
        id: "menores",
        heading: "Menores de edad",
        blocks: [
          "Sendo y Sendo Connect son servicios para empresas y desarrolladores. No están dirigidos a menores de 13 años (o de la edad mínima de tu país) y no recopilamos sus datos a sabiendas. Si crees que un menor nos dio datos personales, escríbenos y los borraremos.",
        ],
      },
      {
        id: "cambios",
        heading: "Cambios a esta política",
        blocks: [
          "Publicaremos cualquier cambio aquí y actualizaremos la fecha de arriba. Si un cambio afecta de forma importante a los clientes de Connect, también les avisaremos por correo antes de que entre en vigor.",
        ],
      },
      {
        id: "contacto",
        heading: "Contacto",
        blocks: [
          "Preguntas sobre esta política o sobre tus datos: [{email}](mailto:{email}) o al [{phone}]({phoneUri}). {shortName}, {country}.",
        ],
      },
    ],
  },
  en: {
    meta: {
      title: "Privacy policy",
      description:
        "What personal data {shortName} ({brand}) handles on sendo.quami.dev and in Sendo Connect, why, how long it is kept and how to exercise your rights.",
    },
    title: "Privacy policy",
    intro:
      "This policy explains what personal data {shortName} (“{brand}”, “we”) collects through the Sendo website and the Sendo Connect service, why we use it, how long we keep it, who we share it with and how you can exercise your rights.",
    sections: [
      {
        id: "who-we-are",
        heading: "Who we are",
        blocks: [
          "{shortName} is a company based in {country}. We publish Sendo, an open-source WhatsApp library, and run Sendo Connect, an optional paid service. {shortName} is responsible for the personal data described in this policy, except where we say we act on behalf of a customer.",
          "For any privacy question, write to [{email}](mailto:{email}).",
        ],
      },
      {
        id: "scope",
        heading: "What this policy covers",
        blocks: [
          [
            "**The website** sendo.quami.dev: the marketing pages, the docs, the live demo and the component registry.",
            "**Sendo Connect**: the webhook relay (connect.sendo.quami.dev) and the customer panel (app.sendo.quami.dev).",
          ],
          "**The open-source package and registry** (`@quami/sendo` and the components you copy into your project) run inside your own app, on your servers and with your own database. The messages, contacts and tokens they handle never reach {brand}. You, not {brand}, are responsible for that data and for telling your users how you use it.",
        ],
      },
      {
        id: "connect-messages",
        heading: "Messages relayed by Sendo Connect",
        blocks: [
          "When a business uses Sendo Connect, Meta sends the WhatsApp webhooks for its numbers to {brand}’s relay, which forwards them to that business’s app. For that content, {brand} acts **on behalf of the business** (our customer), which decides why and how its end users’ data is processed and is responsible for it towards them.",
          "If you wrote on WhatsApp to a business that uses Sendo, that business’s privacy policy applies to your messages. [Data deletion](/en/data-deletion) explains how to reach it or us.",
        ],
      },
      {
        id: "data",
        heading: "What data we collect",
        blocks: [
          "**Connect panel accounts.** Your email address (you sign in with a one-time code we email to you), the projects you create, your API keys (stored only as hashes), your signing secrets (stored in an encrypted vault), the webhook URL you register and the WhatsApp numbers connected to each project.",
          "**Billing.** Your plan, invoices and payment status. Payments are processed by Recurrente: your card details are entered on and held by Recurrente, never by {brand}.",
          "**Relayed webhooks.** The body of each webhook Meta sends for a connected number (it can include message text, media references, phone numbers and profile names of the people writing to the business) is **held encrypted only while its delivery is pending**, and deleted on success or when the 24-hour retry window ends. **Bodies are never logged.** For each delivery we keep metadata: timestamp, project, number, status code, attempt count and latency.",
          "**WhatsApp access tokens.** When a customer connects a number through Embedded Signup, the business access token Meta issues is returned once to the customer’s server and is **never stored** by Connect.",
          "**The live demo.** What you type in the demo is sent to our server and kept in your browser’s session storage, which is cleared when you close the tab. When the demo uses an AI model, the conversation is sent to a model provider through Vercel AI Gateway to generate the reply. The server keeps no transcript. To limit abuse and cost it counts messages per IP address per day in a Redis store; those counters expire after 2 days. Please don’t type personal information into the demo.",
          "**Website visits.** Our hosting provider (Vercel) processes technical request data, such as IP address, browser and requested URL, to serve and protect the site. The site sets one cookie, `sendo-lang`, only when you choose a language, to remember it for a year; the light or dark theme you pick stays in your browser’s local storage. We use no analytics, advertising or third-party tracking scripts.",
          "**Email you send us.** If you write to us, we keep your message and address to answer you and to keep a record of the request.",
        ],
      },
      {
        id: "purposes",
        heading: "Why we use it, and on what basis",
        blocks: [
          [
            "To provide Sendo Connect (sign-in, projects, relaying webhooks to the URL you registered, connecting numbers): it is necessary to perform our contract with you.",
            "To bill for Connect and keep accounting records: the contract and our legal obligations.",
            "To keep the service secure and working (delivery metadata, demo limits, investigating failures): our legitimate interest in running a reliable, safe service.",
            "To relay end users’ messages: on the customer’s instructions; the customer needs its own legal basis towards its users.",
            "To answer your requests: because you ask, and our legitimate interest in handling them.",
          ],
          "We don’t sell personal data, don’t use it for advertising and don’t use relayed messages to train AI models.",
        ],
      },
      {
        id: "retention",
        heading: "How long we keep it",
        blocks: [
          [
            "Relayed webhook bodies: until delivered, at most 24 hours.",
            "Delivery metadata: 7 days.",
            "WhatsApp access tokens: not stored.",
            "Panel account data (email, projects, numbers, API keys, secrets): while the account is open; deleted within 30 days after you close it or ask us to delete it.",
            "Billing records: as long as tax and accounting law in {country} requires.",
            "Demo counters: 2 days (the monthly spend total, which holds no personal data, 40 days). Demo conversations stay only in your browser tab.",
            "Hosting request logs: a short period, under Vercel’s retention settings.",
            "Email you send us: as long as needed to handle your request and keep a record of it.",
          ],
        ],
      },
      {
        id: "sharing",
        heading: "Who we share it with",
        blocks: [
          "We share personal data only with the providers that run the service for us, under their data processing terms, and with authorities when the law requires it:",
          [
            "**Vercel** (United States): hosting for the website, the relay and the panel, and the AI Gateway used by the demo.",
            "**Supabase** (United States): database and authentication for Connect accounts.",
            "**Resend** (United States): sending sign-in codes and service emails.",
            "**Recurrente** ({country}): payment processing and card data.",
            "**Meta** (WhatsApp Business Platform): delivers the webhooks we relay and issues the tokens during Embedded Signup. Meta’s own terms and privacy policy apply to WhatsApp.",
            "**The AI model provider** used by the demo, through Vercel AI Gateway: only the demo conversation.",
          ],
        ],
      },
      {
        id: "transfers",
        heading: "International transfers",
        blocks: [
          "Most of our providers are based in, or store data in, the United States, so your data may be processed outside your country. We choose providers with recognised security practices and rely on their contractual safeguards, such as standard contractual clauses where they apply.",
        ],
      },
      {
        id: "security",
        heading: "Security",
        blocks: [
          "Webhook bodies are encrypted while they wait for delivery, API keys are stored as hashes and signing secrets in an encrypted vault. All traffic uses HTTPS, every relayed webhook is signed with the customer’s own secret, and access to production systems is limited to the people who run the service. No system is perfectly secure: if a breach affects your data, we will notify you and the authorities as the law requires.",
        ],
      },
      {
        id: "rights",
        heading: "Your rights",
        blocks: [
          "You can ask us to access, correct, delete or give you a copy of your personal data, to object to or restrict a use of it, and to withdraw consent where we rely on it. Write to [{email}](mailto:{email}) from your account’s email address (or tell us how to identify you). We answer within 30 days.",
          "If your data is messages you sent to a business that uses Sendo Connect, contact that business first: it controls that data. You can also complain to the data protection authority in your country, where one exists.",
        ],
      },
      {
        id: "children",
        heading: "Children",
        blocks: [
          "Sendo and Sendo Connect are services for businesses and developers. They are not directed to children under 13 (or the minimum age in your country), and we don’t knowingly collect their data. If you believe a child has given us personal data, write to us and we will delete it.",
        ],
      },
      {
        id: "changes",
        heading: "Changes to this policy",
        blocks: [
          "We will post any change here and update the date at the top. If a change materially affects Connect customers, we will also email them before it takes effect.",
        ],
      },
      {
        id: "contact",
        heading: "Contact",
        blocks: [
          "Questions about this policy or your data: [{email}](mailto:{email}) or [{phone}]({phoneUri}). {shortName}, {country}.",
        ],
      },
    ],
  },
} satisfies Record<Lang, LegalPageDict>;
