import type { Lang } from "../langs";
import type { LegalPageDict } from "./legal";

/** `/[lang]/terms`. Billing and suspension: `content/docs/sendo-connect.mdx#suspension`. */
export const terms = {
  es: {
    meta: {
      title: "Términos del servicio",
      description:
        "Las condiciones para usar el sitio de Sendo y el servicio de pago Sendo Connect de {shortName} ({brand}): cuentas, uso aceptable, cobros, responsabilidad y ley aplicable.",
    },
    title: "Términos del servicio",
    intro:
      "Estos términos regulan el uso del sitio de Sendo y de Sendo Connect, que presta {shortName} («{brand}», «nosotros»). Al crear una cuenta de Connect o usar el servicio los aceptas, en nombre propio o de la organización que representas.",
    sections: [
      {
        id: "servicios",
        heading: "Qué ofrecemos",
        blocks: [
          [
            "**Sendo** es la librería de código abierto `@quami/sendo` y el registro de componentes que se sirve desde sendo.quami.dev. Es gratis. Tu uso de su código se rige por la [licencia MIT](https://github.com/quamidev/sendo/blob/main/LICENSE), incluida su ausencia de garantías; estos términos no la modifican.",
            "**Sendo Connect** es un servicio opcional de pago en el que {brand} actúa como Tech Provider de Meta para tu app: tus clientes conectan sus números de WhatsApp a través de la app de Meta de {brand} (Embedded Signup), y el relay reenvía sus webhooks a la URL que registras, firmados con tu propio secreto. Los envíos siguen saliendo directo de tu servidor a Meta.",
            "El sitio, la documentación y la demo se ofrecen tal cual, para ayudarte a evaluar y usar Sendo.",
          ],
        ],
      },
      {
        id: "cuentas",
        heading: "Cuentas",
        blocks: [
          "Para usar Connect necesitas una cuenta en el panel (app.sendo.quami.dev), abierta con un correo que controles. Eres responsable de tus API keys y secretos de firma, de todo lo que se haga con ellos y de mantener al día el correo de tu cuenta. Si crees que una key o un secreto quedó expuesto, rótalo en el panel y avísanos de inmediato a [{email}](mailto:{email}).",
        ],
      },
      {
        id: "uso-aceptable",
        heading: "Uso aceptable",
        blocks: [
          "Debes usar Connect, y asegurarte de que tus clientes lo usen, cumpliendo:",
          [
            "la [Política de WhatsApp Business](https://business.whatsapp.com/policy), la [Política de Comercio](https://www.facebook.com/policies_center/commerce) de Meta y los demás términos de Meta para WhatsApp Business Platform;",
            "las leyes que se aplican a ti y a tus clientes, incluidas las de privacidad, protección al consumidor y contra el spam.",
          ],
          "En particular, no puedes:",
          [
            "enviar spam o mensajes no solicitados, ni escribir a personas que no aceptaron recibir mensajes del negocio;",
            "usar Connect para productos o servicios que prohíbe la Política de Comercio de Meta, ni con fines ilegales, fraudulentos o engañosos;",
            "enviar malware, ni intentar romper, saturar, sondear o evadir la seguridad del relay, del panel o de los proyectos de otros clientes.",
          ],
          "Respondes por el uso que tus clientes hagan de los números conectados a tu proyecto. Podemos suspender un proyecto o un número que incumpla estas reglas o que Meta señale, y te diremos por qué salvo que la ley o Meta lo impidan.",
        ],
      },
      {
        id: "datos",
        heading: "Datos y privacidad",
        blocks: [
          "Los datos de tu app se quedan en tu base de datos. Con los webhooks que reenvía Connect actuamos por tu cuenta, como describe la [política de privacidad](/es/privacy): su contenido se guarda cifrado solo hasta entregarse (como máximo 24 horas), nunca se registra en logs, y los metadatos de entrega se guardan 7 días. Tú informas a tus usuarios finales y cuentas con una base legal para tratar sus mensajes. Si tu app maneja datos sensibles, como información de salud, usa tu propia app de Meta en vez de Connect.",
        ],
      },
      {
        id: "cobros",
        heading: "Precios y cobros",
        blocks: [
          [
            "Connect se cobra por número conectado, al mes, al precio que muestran la [página de precios](/es/pricing) y el panel cuando te suscribes. Sendo es gratis, y {brand} nunca cobra por mensajes.",
            "Meta cobra el costo de los mensajes de WhatsApp directo al dueño de cada cuenta de WhatsApp Business, no a través de {brand}.",
            "Los pagos los procesa Recurrente, bajo sus propias condiciones.",
            "Al crear tu cuenta empieza una prueba gratis de 14 días, sin tarjeta. Si al terminar no has agregado un método de pago, la cuenta entra en el período de gracia de 7 días descrito abajo y después se suspende.",
            "Si un pago falla, tienes un período de gracia de 7 días, con avisos por correo y en el panel. Después, el proyecto se suspende: el relay sigue guardando los webhooks durante su ventana de 24 horas pero no los entrega, y las llamadas a la API de Connect (alta y desconexión de números) se rechazan. Al pagar, la suspensión se levanta de inmediato y se entrega lo que siga dentro de su ventana de 24 horas; los webhooks más antiguos se pierden.",
            "Desconectar un número (desde tu app o en el panel) detiene su reenvío y su cobro. Lo ya pagado no se reembolsa, salvo que la ley lo exija.",
            "Podemos cambiar los precios avisándote por correo con al menos 30 días de anticipación; el cambio se aplica desde el siguiente período de cobro posterior al aviso.",
          ],
        ],
      },
      {
        id: "disponibilidad",
        heading: "Disponibilidad y cambios del servicio",
        blocks: [
          "Trabajamos para que Connect esté disponible y entregue cada webhook, con reintentos durante 24 horas, pero no garantizamos un servicio sin interrupciones. Connect depende de la plataforma de Meta, y Meta puede cambiarla o restringirla, o suspender números o apps, por su cuenta. Podemos cambiar funciones; cuando razonablemente podamos, avisaremos antes de quitar algo de lo que dependes.",
        ],
      },
      {
        id: "garantias",
        heading: "Sin garantías",
        blocks: [
          "En la medida en que la ley lo permita, el sitio, la demo y Connect se ofrecen «tal cual» y «según disponibilidad», sin garantías de ningún tipo, expresas o implícitas, incluidas las de idoneidad para un fin determinado y de no infracción.",
        ],
      },
      {
        id: "responsabilidad",
        heading: "Límite de responsabilidad",
        blocks: [
          "En la medida en que la ley lo permita, {shortName} no responde por daños indirectos, incidentales, especiales o consecuentes, ni por pérdida de ganancias, ingresos, datos o negocio, derivados del uso del sitio o de Connect. Nuestra responsabilidad total por cualquier reclamo relacionado con Connect se limita a lo que nos pagaste por Connect en los 12 meses anteriores al hecho que lo originó. Nada de esto limita la responsabilidad que la ley no permite limitar.",
        ],
      },
      {
        id: "terminacion",
        heading: "Terminación",
        blocks: [
          "Puedes dejar de usar Connect y cerrar tu cuenta cuando quieras: desconecta tus números y escríbenos a [{email}](mailto:{email}) (ver [Eliminación de datos](/es/data-deletion)). Podemos suspender o cerrar una cuenta que incumpla estos términos, que no pague después del período de gracia, o cuando Meta o la ley lo exijan. Al cerrarse una cuenta dejamos de reenviar sus webhooks y borramos sus datos como describe la política de privacidad. Las cláusulas que por su naturaleza deben seguir vigentes (montos adeudados, sin garantías, límite de responsabilidad, ley aplicable) siguen vigentes.",
        ],
      },
      {
        id: "ley-aplicable",
        heading: "Ley aplicable",
        blocks: [
          "Estos términos se rigen por las leyes de la República de {country}. Cualquier controversia se someterá a los tribunales competentes de {country}, salvo que la ley de tu lugar de residencia como consumidor te dé derecho a demandar en otro lugar.",
        ],
      },
      {
        id: "cambios",
        heading: "Cambios a estos términos",
        blocks: [
          "Podemos actualizar estos términos. Publicaremos la nueva versión aquí con una fecha nueva y, si el cambio es importante para los clientes de Connect, se lo avisaremos por correo al menos 30 días antes de que se aplique. Si sigues usando Connect después, aceptas la nueva versión.",
        ],
      },
      {
        id: "contacto",
        heading: "Contacto",
        blocks: [
          "Preguntas sobre estos términos: [{email}](mailto:{email}) o al [{phone}]({phoneUri}). {shortName}, {country}.",
        ],
      },
    ],
  },
  en: {
    meta: {
      title: "Terms of service",
      description:
        "The terms for using the Sendo website and the paid Sendo Connect service from {shortName} ({brand}): accounts, acceptable use, billing, liability and governing law.",
    },
    title: "Terms of service",
    intro:
      "These terms govern your use of the Sendo website and of Sendo Connect, provided by {shortName} (“{brand}”, “we”). By creating a Connect account or using the service you accept them, for yourself or for the organization you represent.",
    sections: [
      {
        id: "services",
        heading: "What we provide",
        blocks: [
          [
            "**Sendo** is the open-source library `@quami/sendo` and the component registry served from sendo.quami.dev. It is free. The [MIT license](https://github.com/quamidev/sendo/blob/main/LICENSE) governs your use of its code, including its absence of warranty; these terms don’t change it.",
            "**Sendo Connect** is an optional paid service in which {brand} acts as the Meta Tech Provider for your app: your customers connect their WhatsApp numbers through {brand}’s Meta app (Embedded Signup), and the relay forwards their webhooks to the URL you register, signed with your own secret. Sending still goes directly from your server to Meta.",
            "The website, the docs and the live demo are provided as they are, to help you evaluate and use Sendo.",
          ],
        ],
      },
      {
        id: "accounts",
        heading: "Accounts",
        blocks: [
          "To use Connect you need an account in the panel (app.sendo.quami.dev), opened with an email address you control. You are responsible for your API keys and signing secrets, for everything done with them and for keeping your account’s email address current. If you think a key or secret was exposed, rotate it in the panel and tell us at once at [{email}](mailto:{email}).",
        ],
      },
      {
        id: "acceptable-use",
        heading: "Acceptable use",
        blocks: [
          "You must use Connect, and make sure your customers use it, in compliance with:",
          [
            "the [WhatsApp Business Policy](https://business.whatsapp.com/policy), Meta’s [Commerce Policy](https://www.facebook.com/policies_center/commerce) and Meta’s other terms for the WhatsApp Business Platform;",
            "the laws that apply to you and your customers, including privacy, consumer protection and anti-spam laws.",
          ],
          "In particular, you must not:",
          [
            "send spam or unsolicited messages, or message people who have not agreed to hear from the business;",
            "use Connect for products or services that Meta’s Commerce Policy prohibits, or for illegal, fraudulent or deceptive purposes;",
            "send malware, or try to break, overload, probe or bypass the security of the relay, the panel or other customers’ projects.",
          ],
          "You are responsible for your customers’ use of the numbers connected to your project. We may suspend a project or number that breaks these rules or that Meta flags, and will tell you why unless the law or Meta prevents it.",
        ],
      },
      {
        id: "data",
        heading: "Data and privacy",
        blocks: [
          "Your app’s data stays in your database. For webhooks relayed by Connect we act on your behalf, as described in the [privacy policy](/en/privacy): bodies are held encrypted only until delivered (at most 24 hours), never logged, and delivery metadata is kept for 7 days. You are responsible for informing your end users and having a legal basis to process their messages. If your app handles sensitive data, such as health information, use your own Meta app instead of Connect.",
        ],
      },
      {
        id: "fees",
        heading: "Fees and billing",
        blocks: [
          [
            "Connect is billed per connected number per month, at the price shown on the [pricing page](/en/pricing) and in the panel when you subscribe. Sendo itself is free, and {brand} never charges for messages.",
            "Meta bills WhatsApp message costs directly to the owner of each WhatsApp Business account, not through {brand}.",
            "Payments are processed by Recurrente, under its own terms.",
            "Creating your account starts a free 14-day trial, no card required. If no payment method has been added when it ends, the account enters the 7-day grace period described below and is then suspended.",
            "If a payment fails, you get a 7-day grace period, with warnings by email and in the panel. After it, the project is suspended: the relay keeps queuing webhooks for their 24-hour window but doesn’t deliver them, and Connect API calls (number signup and disconnect) are refused. Paying lifts the suspension immediately and anything still inside its 24-hour window is delivered; older webhooks are lost.",
            "Disconnecting a number (from your app or in the panel) stops relaying and billing it. Fees already paid are not refunded, except where the law requires.",
            "We may change prices with at least 30 days’ notice by email; the change applies from your first billing period after the notice.",
          ],
        ],
      },
      {
        id: "availability",
        heading: "Availability and changes to the service",
        blocks: [
          "We work to keep Connect available and to deliver every webhook, retrying for 24 hours, but we don’t guarantee uninterrupted service. Connect depends on Meta’s platform, and Meta may change or restrict it, or suspend numbers or apps, on its own. We may change features; when we reasonably can, we will give notice before removing something you rely on.",
        ],
      },
      {
        id: "warranty",
        heading: "No warranty",
        blocks: [
          "To the extent the law allows, the website, the demo and Connect are provided “as is” and “as available”, without warranties of any kind, express or implied, including fitness for a particular purpose and non-infringement.",
        ],
      },
      {
        id: "liability",
        heading: "Limitation of liability",
        blocks: [
          "To the extent the law allows, {shortName} is not liable for indirect, incidental, special or consequential damages, or for lost profits, revenue, data or business, arising from the use of the website or Connect. Our total liability for any claim related to Connect is limited to the fees you paid us for Connect in the 12 months before the event that caused it. Nothing here limits liability that the law does not allow to be limited.",
        ],
      },
      {
        id: "termination",
        heading: "Termination",
        blocks: [
          "You can stop using Connect and close your account at any time: disconnect your numbers and write to [{email}](mailto:{email}) (see [Data deletion](/en/data-deletion)). We may suspend or close an account that breaks these terms, doesn’t pay after the grace period, or when Meta or the law requires it. When an account closes, we stop relaying its webhooks and delete its data as described in the privacy policy. Clauses that by their nature should survive (amounts owed, no warranty, limitation of liability, governing law) survive termination.",
        ],
      },
      {
        id: "governing-law",
        heading: "Governing law",
        blocks: [
          "These terms are governed by the laws of the Republic of {country}. Any dispute will be submitted to the competent courts of {country}, unless the law where you live as a consumer gives you the right to sue elsewhere.",
        ],
      },
      {
        id: "changes",
        heading: "Changes to these terms",
        blocks: [
          "We may update these terms. We will post the new version here with a new date and, if the change matters to Connect customers, email them at least 30 days before it applies. If you keep using Connect after that, you accept the new version.",
        ],
      },
      {
        id: "contact",
        heading: "Contact",
        blocks: [
          "Questions about these terms: [{email}](mailto:{email}) or [{phone}]({phoneUri}). {shortName}, {country}.",
        ],
      },
    ],
  },
} satisfies Record<Lang, LegalPageDict>;
