import { FIXTURES_DEV_USER_ID } from "@/lib/playground-env";
import type { FixtureConversation } from "../types";

/** Another operator, for "Asignadas a mí" filtering. */
export const OTHER_OPERATOR_ID = "operador-2";

const mine: FixtureConversation = {
  key: "humano-mio",
  contact: { phone: "+50255551006", profileName: "Lucía Gómez" },
  status: "human",
  assignedTo: FIXTURES_DEV_USER_ID,
  handoffReason: "Está molesta por un cobro",
  messages: [
    { direction: "in", minutesAgo: 35, text: "Me cobraron dos veces la consulta 😡" },
    {
      direction: "out",
      sender: "agent",
      senderRef: "recepcion",
      minutesAgo: 34,
      text: "Te comunico con una persona del equipo.",
    },
    {
      direction: "out",
      sender: "human",
      senderRef: FIXTURES_DEV_USER_ID,
      minutesAgo: 30,
      text: "Hola Lucía, ya estoy revisando tu caso.",
      status: "delivered",
    },
    { direction: "in", minutesAgo: 2, text: "Gracias, quedo atenta" },
  ],
};

const other: FixtureConversation = {
  key: "humano-otro",
  contact: { phone: "+50255551007", profileName: "Pedro Ajú" },
  status: "human",
  assignedTo: OTHER_OPERATOR_ID,
  handoffReason: "Pidió hablar con una persona",
  messages: [
    { direction: "in", minutesAgo: 50, text: "¿Me puede llamar alguien?" },
    {
      direction: "out",
      sender: "human",
      senderRef: OTHER_OPERATOR_ID,
      minutesAgo: 45,
      text: "Claro, en 10 minutos te llamamos.",
      status: "sent",
    },
  ],
};

const unassigned: FixtureConversation = {
  key: "humano-sin-asignar",
  contact: { phone: "+50255551008", profileName: null },
  status: "human",
  assignedTo: null,
  handoffReason: "El agente no supo responder",
  messages: [
    { direction: "in", minutesAgo: 6, text: "¿Hacen exámenes de laboratorio a domicilio?" },
  ],
};

const closed: FixtureConversation = {
  key: "cerrada",
  contact: { phone: "+50255551009", profileName: "Rosa Tzul" },
  status: "closed",
  assignedTo: null,
  messages: [
    { direction: "in", minutesAgo: 60 * 50, text: "Gracias por la atención" },
    {
      direction: "out",
      sender: "human",
      senderRef: FIXTURES_DEV_USER_ID,
      minutesAgo: 60 * 50 - 2,
      text: "¡A la orden! Que tengas buen día.",
    },
  ],
};

const statuses: FixtureConversation = {
  key: "estados",
  contact: { phone: "+50255551010", profileName: "Diego Pac" },
  status: "agent",
  messages: [
    { direction: "in", minutesAgo: 25, text: "Hola" },
    {
      direction: "out",
      sender: "agent",
      senderRef: "recepcion",
      minutesAgo: 24,
      text: "Leído",
      status: "read",
    },
    {
      direction: "out",
      sender: "agent",
      senderRef: "recepcion",
      minutesAgo: 23,
      text: "Entregado",
      status: "delivered",
    },
    {
      direction: "out",
      sender: "agent",
      senderRef: "recepcion",
      minutesAgo: 22,
      text: "Enviado",
      status: "sent",
    },
    {
      direction: "out",
      sender: "system",
      minutesAgo: 21,
      text: "Pendiente (aún sin confirmar por Meta)",
      status: "pending",
    },
  ],
};

export const mixedConversations: FixtureConversation[] = [
  mine,
  other,
  unassigned,
  closed,
  statuses,
];
