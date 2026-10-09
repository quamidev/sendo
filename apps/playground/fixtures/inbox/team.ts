import { FIXTURES_DEV_USER_ID } from "@/lib/playground-env";
import type { FixtureConversation, FixtureMessage } from "../types";
import { OTHER_OPERATOR_ID } from "./mixed";

// Team inbox edge cases (SND-3.5, mockup option A): drafts, pause, notes, tags, coexistence,
// attribution and a disconnected number. `break-ui` runs against these.

const HOUR = 60;

/** A second number of the playground tenant, disconnected after seeding (AC-IB-8). */
export const PLAYGROUND_DISCONNECTED_ACCOUNT = {
  label: "Mantenimiento",
  phoneNumberId: "100000000000099",
  wabaId: "200000000000001",
  displayPhone: "15550009999",
  tokenRef: "SENDO_TOKEN_MANTENIMIENTO",
} as const;

export const LONG_HANDOFF_REASON =
  "La contacto dice que le cobraron dos veces la cuota de mantenimiento de septiembre y octubre, que ya envió los comprobantes de transferencia por correo a administración hace una semana sin respuesta, y pide hablar con alguien que pueda revertir el cargo duplicado hoy mismo porque necesita el dinero para pagar la colegiatura de su hijo.";

export const TWELVE_TAGS = [
  { name: "cobranza", color: "amber" },
  { name: "mantenimiento", color: "blue" },
  { name: "reclamo", color: "red" },
  { name: "urgente", color: "red" },
  { name: "visita", color: "green" },
  { name: "mudanza", color: "violet" },
  { name: "parqueo", color: "teal" },
  { name: "mascotas", color: "orange" },
  { name: "seguridad", color: "gray" },
  { name: "áreas comunes", color: "pink" },
  { name: "contrato de arrendamiento", color: "violet" },
  { name: "vip", color: "amber" },
] as const;

function systemLine(
  minutesAgo: number,
  text: string,
  meta: { event?: string; by: string; kind?: "system" | "rule" },
): FixtureMessage {
  return {
    direction: "out",
    sender: "system",
    internal: true,
    minutesAgo,
    text,
    metadata: { kind: meta.kind ?? "system", event: meta.event ?? null, by: meta.by },
  };
}

function note(minutesAgo: number, text: string, by: string): FixtureMessage {
  return { direction: "out", sender: "human", senderRef: by, internal: true, minutesAgo, text };
}

function agent(minutesAgo: number, text: string, costCents = 0.21): FixtureMessage {
  return {
    direction: "out",
    sender: "agent",
    senderRef: "recepcion",
    minutesAgo,
    text,
    tokensIn: 1102,
    tokensOut: 64,
    costCents,
  };
}

/** The mockup's first row: `[#garita]` origin, rule handoff, a note, a phone-app echo. */
const garita: FixtureConversation = {
  key: "garita",
  contact: {
    phone: "+50255124433",
    profileName: "María José Castillo",
    appRef: "Apto 4B · Torre Vista",
  },
  status: "human",
  assignedTo: FIXTURES_DEV_USER_ID,
  queue: "Cobranza",
  source: "garita",
  tags: [{ name: "cobranza", color: "amber" }],
  handoffReason: "Pide dividir el saldo de octubre (Q 2,450.00) en dos pagos.",
  unreadCount: 2,
  messages: [
    systemLine(14, "Conversación iniciada desde el QR de la garita", {
      by: "system",
      event: "source",
    }),
    {
      direction: "in",
      minutesAgo: 13,
      text: "Hola buenas tardes, quería consultar mi saldo [#garita]",
      metadata: { source: "garita" },
    },
    agent(
      12.9,
      "¡Hola María José! El saldo pendiente del Apto 4B es de Q 2,450.00, correspondiente a la cuota de octubre. ¿Te ayudo con algo más?",
    ),
    {
      direction: "in",
      minutesAgo: 10,
      text: "Sí, es que este mes no me alcanza 😕 ¿Lo puedo pagar en dos partes?",
    },
    agent(
      9.5,
      "Entiendo. Te comunico con una persona del equipo de cobranza para ver opciones de pago.",
    ),
    systemLine(
      9,
      "El agente recepcion pasó la conversación a una persona: Pide dividir el saldo de octubre (Q 2,450.00) en dos pagos.",
      {
        by: "agent:recepcion",
        event: "handoff",
      },
    ),
    systemLine(8.9, "Asignada a Ana López por la regla «turno-cobranza»", {
      by: "rule:turno-cobranza",
      event: "assigned",
      kind: "rule",
    }),
    note(
      5,
      "Ya tuvo un plan de pagos en mayo y lo cumplió completo. Se le puede ofrecer de nuevo.",
      OTHER_OPERATOR_ID,
    ),
    {
      direction: "out",
      sender: "human",
      minutesAgo: 2,
      text: "María José, ya vi tu caso. Ahorita te escribe Ana para darte opciones 🙌",
      metadata: { origin: "business_app" },
    },
    { direction: "in", minutesAgo: 1, text: "Muchas gracias! quedo pendiente" },
  ],
};

/** A pending draft (Flow E) on a conversation the agent still handles. */
const draft: FixtureConversation = {
  key: "borrador",
  contact: {
    phone: "+50244209981",
    profileName: "Diego Hernández",
    appRef: "Apto 12A · Torre Vista",
  },
  status: "agent",
  queue: "Mantenimiento",
  tags: [{ name: "mantenimiento", color: "blue" }],
  messages: [
    {
      direction: "in",
      minutesAgo: 6,
      text: "Buenas, hay una fuga de agua en el baño, gotea desde el techo 😟",
    },
    agent(
      6,
      "¡Hola Diego! Qué pena. ¿Me confirmas si el agua cae cerca de algún tomacorriente o lámpara?",
    ),
    { direction: "in", minutesAgo: 4, text: "No, está sobre la ducha nada más" },
    {
      direction: "out",
      sender: "agent",
      senderRef: "recepcion",
      draft: true,
      minutesAgo: 3,
      text: "Gracias por avisar, Diego. Ya registré la fuga en el baño del 12A y programé al plomero para mañana entre 8:00 y 10:00. ¿Habrá alguien en el apartamento para recibirlo?",
      tokensIn: 1318,
      tokensOut: 52,
      costCents: 0.27,
    },
  ],
};

/** Agent paused by another operator; the window closes in about 1 h 20 min (amber). */
const paused: FixtureConversation = {
  key: "en-pausa",
  contact: {
    phone: "+50233017720",
    profileName: "Lucía Morales",
    appRef: "Apto 7C · Residencial Las Flores",
  },
  status: "agent",
  agentPaused: true,
  tags: [
    { name: "reclamo", color: "red" },
    { name: "urgente", color: "red" },
  ],
  messages: [
    {
      direction: "in",
      minutesAgo: 23 * HOUR,
      text: "Llevo 3 días sin agua caliente y nadie me responde en administración",
    },
    agent(
      23 * HOUR - 0.5,
      "Lamento la molestia, Lucía. ¿Ya intentaste reiniciar el calentador? 🙂",
    ),
    {
      direction: "in",
      minutesAgo: 23 * HOUR - 3,
      text: "Obvio que sí. Necesito que venga alguien hoy",
    },
    systemLine(23 * HOUR - 5, "Javier Ruiz pausó al agente", {
      by: OTHER_OPERATOR_ID,
      event: "agent_paused",
    }),
    { direction: "in", minutesAgo: 22 * HOUR + 40, text: "¿Hola?" },
  ],
};

/** A pending draft proposed before the conversation was handed to a person. */
const draftBeforeHandoff: FixtureConversation = {
  key: "borrador-traspaso",
  contact: { phone: "+50258701123", profileName: "Carlos Pérez", appRef: "Apto 2A · Torre Vista" },
  status: "human",
  assignedTo: OTHER_OPERATOR_ID,
  queue: "Visitas",
  handoffReason: "Pidió hablar con una persona",
  tags: [{ name: "visita", color: "green" }],
  messages: [
    {
      direction: "in",
      minutesAgo: 40,
      text: "¿Me pueden confirmar la visita del técnico de internet?",
    },
    {
      direction: "out",
      sender: "agent",
      senderRef: "recepcion",
      draft: true,
      minutesAgo: 39,
      text: "Hola Carlos, la visita del técnico está programada para mañana a las 9:00.",
      metadata: { handoffAfterDraft: true },
      tokensIn: 980,
      tokensOut: 31,
      costCents: 0.18,
    },
    { direction: "in", minutesAgo: 38, text: "Prefiero hablar con una persona, por favor" },
    systemLine(37.9, "Carlos pidió hablar con una persona", {
      by: "agent:recepcion",
      event: "handoff",
    }),
  ],
};

/** Twelve tags (any-match filter, row "+N", context panel wrap) and a long name. */
const twelveTags: FixtureConversation = {
  key: "doce-etiquetas",
  contact: {
    phone: "+48601234567",
    profileName: "Aleksandra Wiśniewska-Kowalczyk",
    appRef: "Local comercial 3 · Plaza Las Américas, nivel 2",
  },
  status: "agent",
  tags: [...TWELVE_TAGS],
  messages: [
    {
      direction: "in",
      minutesAgo: 70,
      text: "Dzień dobry 👋 ¿Tienen parqueo para visitas el fin de semana?",
    },
    agent(69, "¡Hola Aleksandra! Sí, hay 6 espacios para visitas en el sótano 1."),
  ],
};

/** The longest handoff reason the agent might give. */
const longHandoff: FixtureConversation = {
  key: "traspaso-largo",
  contact: { phone: "+50240115566", profileName: "Sofía Ramírez", appRef: "Apto 9D · Torre Vista" },
  status: "human",
  assignedTo: FIXTURES_DEV_USER_ID,
  queue: "Cobranza",
  handoffReason: LONG_HANDOFF_REASON,
  tags: [
    { name: "cobranza", color: "amber" },
    { name: "reclamo", color: "red" },
  ],
  messages: [
    {
      direction: "in",
      minutesAgo: 30,
      text: "Me cobraron dos veces y necesito que lo arreglen hoy",
    },
    agent(29, "Lo siento mucho, Sofía. Te paso con una persona del equipo de cobranza."),
    systemLine(
      28.9,
      `El agente recepcion pasó la conversación a una persona: ${LONG_HANDOFF_REASON}`,
      {
        by: "agent:recepcion",
        event: "handoff",
      },
    ),
  ],
};

/** Mostly notes: the team discusses before answering. */
const notes: FixtureConversation = {
  key: "notas",
  contact: { phone: "+50251110000", profileName: "Jo", appRef: "Apto 1A · Torre Vista" },
  status: "human",
  assignedTo: OTHER_OPERATOR_ID,
  queue: null,
  messages: [
    { direction: "in", minutesAgo: 120, text: "Quiero cancelar mi contrato" },
    note(118, "Ojo: tiene un depósito pendiente de devolver.", OTHER_OPERATOR_ID),
    note(
      115,
      "Revisé el contrato: la cláusula 7 pide 60 días de aviso. Le ofrezco 30 si entrega las llaves antes del 15.",
      FIXTURES_DEV_USER_ID,
    ),
    note(
      110,
      "De acuerdo. https://administracion.torre-vista.example.com/contratos/2024/apartamento-1a/anexos/clausula-7-aviso-previo.pdf",
      OTHER_OPERATOR_ID,
    ),
    systemLine(100, "Javier Ruiz tomó la conversación", {
      by: OTHER_OPERATOR_ID,
      event: "assigned",
    }),
  ],
};

/** On the disconnected number: readable, no composer (AC-IB-8). */
const disconnected: FixtureConversation = {
  key: "desconectado",
  account: "disconnected",
  contact: { phone: "+50255557788", profileName: "Rosa Méndez" },
  status: "human",
  assignedTo: FIXTURES_DEV_USER_ID,
  handoffReason: "Pidió hablar con una persona",
  messages: [
    { direction: "in", minutesAgo: 3 * HOUR, text: "¿Ya vino el técnico del elevador?" },
    {
      direction: "out",
      sender: "human",
      senderRef: FIXTURES_DEV_USER_ID,
      minutesAgo: 3 * HOUR - 5,
      text: "Todavía no, Rosa. Te aviso apenas llegue.",
    },
    { direction: "in", minutesAgo: 20, text: "¿Alguna novedad?" },
  ],
};

/** Chat history imported from the WhatsApp Business app (coexistence). */
const imported: FixtureConversation = {
  key: "importado",
  contact: { phone: "+50255550193", profileName: null },
  status: "agent",
  messages: [
    {
      direction: "in",
      minutesAgo: 6 * 24 * HOUR,
      text: "Hola, vi el anuncio del apartamento de 2 habitaciones, ¿sigue disponible?",
      metadata: { imported: true },
    },
    {
      direction: "out",
      sender: "human",
      minutesAgo: 6 * 24 * HOUR - 30,
      text: "¡Hola! Sí, el 3C sigue disponible. ¿Quieres agendar una visita?",
      metadata: { imported: true, origin: "business_app" },
    },
    { direction: "in", minutesAgo: 50, text: "Sí, el sábado en la mañana" },
    agent(
      49,
      "Listo, te agendé el sábado a las 10:00. Te esperamos en la recepción de Torre Vista.",
    ),
  ],
};

export const teamConversations: FixtureConversation[] = [
  garita,
  draft,
  paused,
  draftBeforeHandoff,
  twelveTags,
  longHandoff,
  notes,
  disconnected,
  imported,
];
