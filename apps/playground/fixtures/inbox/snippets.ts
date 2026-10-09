// Snippet catalog for fixtures mode (SND-3.6 break-ui): 50 visible to the dev user, one with a
// variable nobody resolves ({{fecha_limite}}), the longest shortcut and body the package
// accepts, one scoped to the disconnected number, and another operator's personal snippet the
// dev user must never see.
import { FIXTURES_DEV_USER_ID } from "@/lib/playground-env";
import { OTHER_OPERATOR_ID } from "./mixed";

export interface FixtureSnippet {
  shortcut: string;
  body: string;
  /** Default `tenant`. */
  visibility?: "tenant" | "personal";
  /** Personal snippets: the owner (default the dev user). */
  owner?: string;
  /** Only on the disconnected number. */
  disconnectedOnly?: boolean;
}

/** `{{fecha_limite}}` is never resolved: the composer blocks sending until it is filled in. */
export const UNRESOLVED_SNIPPET = "plan-pagos";
/** 32 characters, the shortcut limit. */
export const LONGEST_SHORTCUT = "recordatorio-cuota-mantenimiento";

const LONG_BODY = [
  "Hola {{nombre}}, te escribimos de la administración de Torre Vista.",
  "Te recordamos que la asamblea ordinaria de propietarios será el sábado a las 10:00 en el salón de usos múltiples del nivel 2.",
  "En la agenda: aprobación del presupuesto 2027, el cambio de empresa de seguridad, el plan de impermeabilización de la terraza y la propuesta para ampliar el horario de la piscina los fines de semana.",
  "Si no puedes asistir, puedes enviar una carta poder firmada a un vecino o a la administración antes del viernes a las 17:00.",
  "Cualquier duda, respóndenos por aquí o llama al {{telefono_administracion}}. Atentamente, {{agente}}.",
].join(" ");

const TOPICS: [string, string][] = [
  ["agua-corte", "Mañana habrá corte de agua de 9:00 a 13:00 por mantenimiento de la cisterna."],
  ["agua-restablecida", "El servicio de agua ya está restablecido. Gracias por tu paciencia."],
  ["luz-areas", "La luz de las áreas comunes se revisará el jueves por la tarde."],
  [
    "elevador",
    "El elevador de la Torre B está en mantenimiento; volverá a funcionar hoy a las 18:00.",
  ],
  ["piscina-horario", "La piscina abre de martes a domingo de 7:00 a 20:00."],
  ["gimnasio", "El gimnasio está abierto todos los días de 5:00 a 22:00 con tu tarjeta de acceso."],
  ["salon-reserva", "Para reservar el salón de usos múltiples escríbenos la fecha y el horario."],
  ["salon-deposito", "La reserva del salón requiere un depósito de Q 300.00 reembolsable."],
  ["parqueo-visitas", "Tus visitas pueden usar los 6 espacios del sótano 1 por hasta 4 horas."],
  ["parqueo-tarjeta", "La tarjeta de parqueo adicional cuesta Q 75.00 al mes."],
  ["mascotas", "Las mascotas deben ir con correa en las áreas comunes."],
  ["basura", "La recolección de basura es lunes, miércoles y viernes a las 7:00."],
  ["reciclaje", "El punto de reciclaje está junto a la garita, a la izquierda del portón."],
  [
    "mudanza-aviso",
    "Las mudanzas se programan de lunes a sábado de 8:00 a 17:00, con 48 horas de aviso.",
  ],
  [
    "mudanza-elevador",
    "Durante la mudanza protegemos el elevador de servicio; avísanos la hora exacta.",
  ],
  ["paquete", "Tienes un paquete en la garita. Puedes recogerlo con tu DPI."],
  [
    "visita-registro",
    "Para registrar una visita envíanos su nombre completo y la hora de llegada.",
  ],
  ["seguridad", "Si ves algo fuera de lo común, avisa a la garita al instante."],
  ["ruido", "Recordamos que el horario de silencio es de 22:00 a 7:00."],
  [
    "fumigacion",
    "El viernes fumigamos las áreas comunes; mantén cerradas las ventanas de 9:00 a 11:00.",
  ],
  ["jardin", "El jardinero pasa los martes; si necesitas algo en tu jardín, avísanos."],
  [
    "llaves",
    "Las copias de llaves se solicitan en la administración con 24 horas de anticipación.",
  ],
  ["reglamento", "Puedes consultar el reglamento interno en el portal de residentes."],
  ["portal-acceso", "Para entrar al portal usa tu correo y la contraseña que te enviamos."],
  ["factura", "Tu factura del mes ya está disponible en el portal de residentes."],
  ["pago-recibido", "¡Gracias, {{nombre}}! Recibimos tu pago y ya se aplicó a tu cuenta."],
  [
    "pago-transferencia",
    "Puedes pagar por transferencia a la cuenta 01-2345678-9 del Banco Industrial.",
  ],
  ["pago-tarjeta", "También aceptamos pago con tarjeta en la administración, de 8:00 a 17:00."],
  [
    "mantenimiento-ticket",
    "Registramos tu solicitud de mantenimiento; te avisamos cuando tengamos fecha.",
  ],
  ["plomero", "El plomero llega mañana entre 8:00 y 10:00. ¿Alguien estará en el apartamento?"],
  ["electricista", "El electricista puede pasar el jueves por la mañana. ¿Te funciona?"],
  [
    "seguimiento",
    "{{nombre}}, ¿se resolvió lo que nos reportaste? Queremos confirmar que todo está bien.",
  ],
  ["encuesta", "¿Nos ayudas con una encuesta de 2 minutos sobre la atención? 🙏"],
  [
    "bienvenida",
    "¡Bienvenido a Torre Vista, {{nombre}}! Soy {{agente}} y te ayudo con lo que necesites.",
  ],
  ["contacto-telefono", "Tenemos registrado tu número {{telefono}}. ¿Es correcto?"],
  ["feriado", "Por el feriado, la administración atiende solo de 8:00 a 12:00."],
];

/** Every snippet seeded for the playground tenant. */
export const FIXTURE_SNIPPETS: FixtureSnippet[] = [
  {
    shortcut: "saldo",
    body: "Hola {{nombre}}, tu saldo pendiente es de {{saldo}}. Puedes pagarlo en línea o en la administración del edificio.",
  },
  {
    shortcut: UNRESOLVED_SNIPPET,
    body: "{{nombre}}, podemos dividir tu saldo de {{saldo}} en dos pagos: el primero antes del {{fecha_limite}} y el segundo a fin de mes. ¿Te parece bien?",
  },
  {
    shortcut: "horario",
    body: "Nuestro horario de atención es de lunes a viernes de 8:00 a 17:00 y sábados de 8:00 a 12:00. Los días feriados atendemos solo por aquí.",
  },
  { shortcut: LONGEST_SHORTCUT, body: LONG_BODY },
  {
    shortcut: "gracias",
    body: "¡Con gusto, {{nombre}}! Cualquier otra cosa, aquí estamos.",
    visibility: "personal",
  },
  {
    shortcut: "firma",
    body: "Saludos,\n{{agente}}\nAdministración Torre Vista",
    visibility: "personal",
  },
  {
    shortcut: "llamar",
    body: "¿Te puedo llamar en 5 minutos al {{telefono}}?",
    visibility: "personal",
  },
  {
    shortcut: "garita-norte",
    body: "Este número es de la garita norte; para pagos escribe al número principal.",
    disconnectedOnly: true,
  },
  {
    shortcut: "javier-privado",
    body: "Nota personal de Javier: no la debe ver nadie más.",
    visibility: "personal",
    owner: OTHER_OPERATOR_ID,
  },
  ...TOPICS.map(([shortcut, body]) => ({ shortcut, body })),
  ...[
    "Hola",
    "Buenos días",
    "Buenas tardes",
    "Un momento, por favor",
    "Ya lo reviso",
    "Te confirmo en breve",
  ].map((text, index) => ({
    shortcut: `rapida-${String(index + 1)}`,
    body: `${text}, {{nombre}}.`,
  })),
];

/** Balances of the linked residents (stands in for the app's billing table). */
const BALANCES: Record<string, string> = {
  "Apto 4B · Torre Vista": "Q 2,450.00",
  "Apto 12A · Torre Vista": "Q 0.00",
  "Apto 7C · Residencial Las Flores": "Q 640.00",
};

/**
 * The playground's `resolveSnippetVariables`: `saldo` for linked residents with a known
 * balance and the office phone. `fecha_limite` is never resolved on purpose.
 */
export function fixtureSnippetVariables(contact: {
  appRef: string | null;
}): Record<string, string> {
  const saldo = contact.appRef === null ? undefined : BALANCES[contact.appRef];
  return {
    telefono_administracion: "+502 2233 4455",
    ...(saldo !== undefined && { saldo }),
  };
}

/** The dev user sees tenant snippets plus their own personal ones. */
export function visibleToDevUser(snippet: FixtureSnippet): boolean {
  return (
    snippet.visibility !== "personal" ||
    (snippet.owner ?? FIXTURES_DEV_USER_ID) === FIXTURES_DEV_USER_ID
  );
}
