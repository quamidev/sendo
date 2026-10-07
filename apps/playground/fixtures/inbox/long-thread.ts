import type { FixtureConversation, FixtureMessage } from "../types";

export const LONG_THREAD_LENGTH = 500;

const QUESTIONS = [
  "¿Tienen espacio esta semana?",
  "¿Cuánto cuesta la consulta?",
  "¿Aceptan seguro médico?",
  "¿Dónde están ubicados?",
  "Ok, gracias",
];
const ANSWERS = [
  "Sí, tenemos espacio el jueves a las 10:00.",
  "La consulta general cuesta Q250.",
  "Trabajamos con la mayoría de aseguradoras.",
  "Estamos en la 6a avenida 10-20, zona 10.",
  "¡Con gusto!",
];

/** 500 messages, alternating contact and agent, one per minute up to 2 minutes ago. */
function buildMessages(): FixtureMessage[] {
  return Array.from({ length: LONG_THREAD_LENGTH }, (_, index): FixtureMessage => {
    const minutesAgo = LONG_THREAD_LENGTH - index + 1;
    const turn = Math.floor(index / 2) % QUESTIONS.length;
    const label = `#${String(index + 1)}`;
    if (index % 2 === 0) {
      return { direction: "in", minutesAgo, text: `${QUESTIONS[turn] ?? ""} (${label})` };
    }
    return {
      direction: "out",
      sender: "agent",
      senderRef: "recepcion",
      minutesAgo,
      text: `${ANSWERS[turn] ?? ""} (${label})`,
      status: index >= LONG_THREAD_LENGTH - 2 ? "delivered" : "read",
    };
  });
}

export const longThread: FixtureConversation = {
  key: "hilo-500",
  contact: { phone: "+50255551002", profileName: "Carlos Méndez" },
  status: "agent",
  messages: buildMessages(),
};
