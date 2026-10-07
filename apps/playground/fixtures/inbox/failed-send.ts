import { FIXTURES_DEV_USER_ID } from "@/lib/playground-env";
import type { FixtureConversation } from "../types";

/** A human reply Meta rejected: the 24-hour window had closed (error 131047). */
export const failedSend: FixtureConversation = {
  key: "envio-fallido",
  contact: { phone: "+50255551004", profileName: "Sofía Ramírez" },
  status: "human",
  assignedTo: FIXTURES_DEV_USER_ID,
  handoffReason: "Pidió hablar con una persona",
  messages: [
    { direction: "in", minutesAgo: 60 * 30, text: "Quiero hablar con alguien de la clínica" },
    {
      direction: "out",
      sender: "agent",
      senderRef: "recepcion",
      minutesAgo: 60 * 30 - 1,
      text: "Te comunico con una persona del equipo.",
    },
    {
      direction: "out",
      sender: "human",
      senderRef: FIXTURES_DEV_USER_ID,
      minutesAgo: 20,
      text: "Hola Sofía, ¿en qué te puedo ayudar?",
      status: "failed",
      error: {
        code: 131047,
        title: "Re-engagement message",
        message:
          "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
        fbtraceId: "AbCdEfGhIjK",
      },
    },
  ],
};
