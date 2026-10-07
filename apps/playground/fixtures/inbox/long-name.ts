import type { FixtureConversation } from "../types";

/** Exactly 60 characters: the list and thread header must truncate it. */
export const LONG_CONTACT_NAME = "María Fernanda de los Ángeles Castañeda Villagrán de Ordóñez";

export const longName: FixtureConversation = {
  key: "nombre-largo",
  contact: { phone: "+50255551001", profileName: LONG_CONTACT_NAME },
  status: "agent",
  messages: [
    { direction: "in", minutesAgo: 14, text: "Buenas tardes, ¿atienden los sábados?" },
    {
      direction: "out",
      sender: "agent",
      senderRef: "recepcion",
      minutesAgo: 13,
      text: "¡Hola! Sí, los sábados atendemos de 08:00 a 12:00.",
    },
    { direction: "in", minutesAgo: 3, text: "Perfecto, gracias" },
  ],
};
