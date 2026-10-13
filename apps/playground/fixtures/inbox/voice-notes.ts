import type { FixtureConversation, FixtureMessage } from "../types";

const VOICE = { mimeType: "audio/ogg", downloadStatus: "done", sizeBytes: 48_213 } as const;

function voice(minutesAgo: number, n: number, text: string | null, transcription: object) {
  return {
    direction: "in",
    minutesAgo,
    type: "audio",
    text,
    content: { mediaId: `30000000000880${String(n)}`, mimeType: "audio/ogg", voice: true },
    metadata: { transcription },
    media: VOICE,
  } satisfies FixtureMessage;
}

function agent(minutesAgo: number, text: string, cost: Partial<FixtureMessage> = {}) {
  return {
    direction: "out",
    sender: "agent",
    senderRef: "recepcion",
    minutesAgo,
    text,
    ...cost,
  } as FixtureMessage;
}

/**
 * SND-4.10 break-ui: voice notes transcribed, timed out and over 25 MB; agent turns with a known
 * cost, an unknown cost ("—") and a large one (admins see them on hover; "Costo del agente").
 */
export const voiceNotes: FixtureConversation = {
  key: "notas-de-voz",
  contact: { phone: "+50255551011", profileName: "Marta Choc" },
  status: "agent",
  messages: [
    voice(
      14,
      1,
      "Hola, buenas tardes. Quería saber si tienen cita disponible para el jueves en la mañana, de preferencia antes de las diez porque después trabajo.",
      { model: "whisper-1", ms: 1840 },
    ),
    agent(13, "¡Hola Marta! El jueves tenemos espacio a las 8:30 y a las 9:15. ¿Cuál prefieres?", {
      tokensIn: 1102,
      tokensOut: 64,
      costCents: 0.24,
    }),
    voice(11, 2, null, { model: "whisper-1", ms: 30_000, error: "timeout" }),
    agent(10, "Disculpa, no pude escuchar tu nota de voz. ¿Me lo escribes?", {
      tokensIn: 1240,
      tokensOut: 31,
    }),
    voice(8, 3, null, { model: "whisper-1", ms: 2, error: "too_large" }),
    agent(7, "Recibí un audio muy largo. ¿Me cuentas en un mensaje corto qué necesitas?", {
      tokensIn: 1_234_567,
      tokensOut: 98_765,
      costCents: 1234.56,
    }),
  ],
};
