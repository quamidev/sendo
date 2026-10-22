import type { Lang } from "../langs";
import type { LegalPageDict } from "./legal";

/**
 * `/[lang]/data-deletion`: the "User data deletion" instructions URL of the Quami Connect Meta
 * app. Retention facts: `content/docs/sendo-connect.mdx#privacy`.
 */
export const dataDeletion = {
  es: {
    meta: {
      title: "Eliminación de datos",
      description:
        "Cómo pedirle a {shortName} ({brand}) que borre tus datos: cuentas de Sendo Connect, personas que escribieron por WhatsApp a un negocio que usa Connect, y la demo.",
    },
    title: "Eliminación de datos",
    intro:
      "Cómo pedirle a {shortName} («{brand}») que borre tus datos personales, ya sea que tengas una cuenta de Sendo Connect o que le hayas escrito por WhatsApp a un negocio que usa Sendo Connect.",
    sections: [
      {
        id: "como-pedirlo",
        heading: "Cómo pedir que borremos tus datos",
        blocks: [
          [
            "Escribe a [{email}](mailto:{email}) con el asunto «Solicitud de eliminación de datos».",
            "Envíalo desde el correo de tu cuenta de Connect. Si no tienes cuenta, indícanos el número de teléfono o el correo al que se refieren los datos.",
            "Dinos qué quieres borrar: toda tu cuenta, proyectos o números concretos, o los datos sobre ti.",
          ],
          "Antes de actuar podemos pedirte que confirmes la solicitud desde ese correo o ese número, para que nadie pueda borrar los datos de otra persona. Completamos la eliminación dentro de **30 días** y te avisamos por correo cuando está hecha.",
        ],
      },
      {
        id: "cuentas-de-connect",
        heading: "Cuentas de Sendo Connect",
        blocks: [
          "Al borrar una cuenta de Connect eliminamos:",
          [
            "tu correo y tus datos de inicio de sesión;",
            "tus proyectos, los hash de tus API keys, tus secretos de firma y tus URL de webhook;",
            "los registros de tus números conectados (y dejamos de reenviar y cobrar esos números);",
            "los metadatos de entrega, que de todos modos vencen solos a los 7 días;",
            "cualquier webhook que siga pendiente de entrega.",
          ],
          "Guardamos los registros de facturación (facturas e historial de pagos) el tiempo que exija la ley tributaria y contable de {country}; Recurrente conserva tus datos de pago según su propia política.",
          "Para borrar solo algunos proyectos o números, indícalos en tu correo. También puedes desconectar un número desde tu app con `sendo.accounts.disconnect`, que detiene su reenvío y su cobro. Antes de cerrar la cuenta, desconecta tus números o pásalos a tu propia app de Meta: con la cuenta cerrada, sus webhooks dejan de reenviarse.",
          "Borrar tu cuenta de Connect no borra nada de la base de datos de tu propia app: Sendo guarda ahí tus mensajes y contactos, bajo tu control.",
        ],
      },
      {
        id: "whatsapp",
        heading: "Si le escribiste por WhatsApp a un negocio que usa Sendo Connect",
        blocks: [
          [
            "**No guardamos tus mensajes.** Connect guarda el contenido de un webhook cifrado solo hasta entregarlo a la app del negocio, como máximo 24 horas, y nunca lo registra en logs. Los metadatos de entrega (hora, número, estado, intentos, latencia) no incluyen el contenido y se borran a los 7 días.",
            "**Tu conversación la guarda el negocio** al que le escribiste, en sus propios sistemas. Para que la borre, contacta directamente a ese negocio: es quien decide qué conserva.",
            "**Si no sabes cómo contactarlo**, o quieres que confirmemos que no tenemos nada tuyo, escribe a [{email}](mailto:{email}) con tu número de teléfono y el nombre o el número del negocio. Lo revisaremos, borraremos lo que encontremos dentro de 30 días y, cuando podamos identificar al negocio, le haremos llegar tu solicitud.",
          ],
        ],
      },
      {
        id: "facebook",
        heading: "Si conectaste tu cuenta de WhatsApp Business con Facebook",
        blocks: [
          "Cuando un negocio conecta su cuenta de WhatsApp Business con la app de Meta de {brand} (Quami Connect), el inicio de sesión de Facebook solo sirve para autorizar esa conexión. {brand} no guarda tu perfil de Facebook ni el token de acceso del negocio; solo los identificadores de la cuenta de WhatsApp Business y del número conectado, como parte del proyecto del cliente.",
          "Para quitar el acceso de la app, en Facebook ve a Configuración y privacidad → Configuración → Integraciones comerciales y elimina Quami Connect. Después escríbenos a [{email}](mailto:{email}) para que borremos los registros relacionados, como se explica arriba.",
        ],
      },
      {
        id: "demo",
        heading: "La demo",
        blocks: [
          "Las conversaciones de la demo solo quedan en la pestaña de tu navegador: ciérrala para borrarlas. Los contadores por dirección IP vencen solos a los 2 días.",
        ],
      },
      {
        id: "contacto",
        heading: "Contacto",
        blocks: [
          "Solicitudes de eliminación y preguntas: [{email}](mailto:{email}) o al [{phone}]({phoneUri}). Más detalles en la [política de privacidad](/es/privacy).",
        ],
      },
    ],
  },
  en: {
    meta: {
      title: "Data deletion",
      description:
        "How to ask {shortName} ({brand}) to delete your data: Sendo Connect accounts, people who wrote on WhatsApp to a business that uses Connect, and the demo.",
    },
    title: "Data deletion",
    intro:
      "How to ask {shortName} (“{brand}”) to delete your personal data, whether you have a Sendo Connect account or wrote on WhatsApp to a business that uses Sendo Connect.",
    sections: [
      {
        id: "how-to-request",
        heading: "How to request deletion",
        blocks: [
          [
            "Email [{email}](mailto:{email}) with the subject “Data deletion request”.",
            "Send it from your Connect account’s email address. If you have no account, tell us the phone number or email address the data relates to.",
            "Say what you want deleted: your whole account, specific projects or numbers, or the data about you.",
          ],
          "Before acting we may ask you to confirm the request from that address or number, so nobody can delete someone else’s data. We complete the deletion within **30 days** and email you when it is done.",
        ],
      },
      {
        id: "connect-accounts",
        heading: "Sendo Connect accounts",
        blocks: [
          "Deleting a Connect account removes:",
          [
            "your email address and sign-in data;",
            "your projects, API key hashes, signing secrets and webhook URLs;",
            "the records of your connected numbers (and we stop relaying and billing them);",
            "delivery metadata, which expires on its own after 7 days anyway;",
            "any webhook still pending delivery.",
          ],
          "We keep billing records (invoices and payment history) for as long as tax and accounting law in {country} requires; Recurrente keeps your payment data under its own policy.",
          "To delete only some projects or numbers, name them in your email. You can also disconnect a number from your app with `sendo.accounts.disconnect`, which stops relaying and billing it. Before closing the account, disconnect your numbers or move them to your own Meta app: once the account is closed, their webhooks are no longer relayed.",
          "Deleting your Connect account deletes nothing in your own app’s database: Sendo stores your messages and contacts there, under your control.",
        ],
      },
      {
        id: "whatsapp",
        heading: "If you wrote on WhatsApp to a business that uses Sendo Connect",
        blocks: [
          [
            "**We don’t keep your messages.** Connect holds a webhook’s content encrypted only until it is delivered to the business’s app, at most 24 hours, and never logs it. Delivery metadata (time, number, status, attempts, latency) holds no content and is deleted after 7 days.",
            "**Your conversation is kept by the business** you wrote to, in its own systems. To have it deleted, contact that business directly: it decides what it keeps.",
            "**If you don’t know how to reach it**, or want us to confirm we hold nothing about you, email [{email}](mailto:{email}) with your phone number and the business’s name or number. We will check, delete anything we find within 30 days and, when we can identify the business, pass your request on to it.",
          ],
        ],
      },
      {
        id: "facebook",
        heading: "If you connected your WhatsApp Business account with Facebook",
        blocks: [
          "When a business connects its WhatsApp Business account through {brand}’s Meta app (Quami Connect), Facebook Login is used only to authorize that connection. {brand} doesn’t store your Facebook profile or the business access token; only the IDs of the WhatsApp Business account and of the connected number, as part of the customer’s project.",
          "To remove the app’s access, in Facebook go to Settings & privacy → Settings → Business integrations and remove Quami Connect. Then email [{email}](mailto:{email}) so we delete the related records, as described above.",
        ],
      },
      {
        id: "demo",
        heading: "The live demo",
        blocks: [
          "Demo conversations stay only in your browser tab: close it to delete them. The per-IP counters expire on their own after 2 days.",
        ],
      },
      {
        id: "contact",
        heading: "Contact",
        blocks: [
          "Deletion requests and questions: [{email}](mailto:{email}) or [{phone}]({phoneUri}). More details in the [privacy policy](/en/privacy).",
        ],
      },
    ],
  },
} satisfies Record<Lang, LegalPageDict>;
