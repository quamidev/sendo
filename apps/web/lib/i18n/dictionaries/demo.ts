import type { Lang } from "../langs";

/**
 * `/[lang]/demo` page chrome. STUB from SNL-4.1: SNL-4.3 owns this file and adds the demo chat UI
 * copy. `intro` takes `{sessionLimit}`, `{ipLimit}` and `{maxTokens}` (see `interpolate()`).
 */
export interface DemoDict {
  meta: { title: string; description: string };
  title: string;
  intro: string;
  installLink: string;
}

export const demo = {
  es: {
    meta: {
      title: "Demo en vivo",
      description:
        "Escríbele a un agente de IA en un número de WhatsApp de prueba y mira la misma conversación en la bandeja real de Sendo.",
    },
    title: "Demo en vivo",
    intro:
      "El chat es un residente de un edificio de prueba que escribe por WhatsApp; un agente con un modelo real responde y puede consultar el saldo del apartamento en la app o pasarte con una persona. La bandeja es la `inbox` real: abre tu conversación y responde desde ahí. Nada se guarda: tu navegador conserva la conversación y cada mensaje la reconstruye en un Sendo nuevo en memoria con un Meta simulado. Límites: {sessionLimit} mensajes por sesión, {ipLimit} por red al día, {maxTokens} tokens de salida por respuesta.",
    installLink: "Instálalo en tu app",
  },
  en: {
    meta: {
      title: "Live demo",
      description:
        "Write to an AI agent on a demo WhatsApp number and watch the same conversation in the real Sendo inbox.",
    },
    title: "Live demo",
    intro:
      "The chat is a resident of a demo building writing on WhatsApp; an agent with a real model answers and can check the apartment’s balance in the app or hand you to a person. The inbox is the real `inbox`: open your conversation and reply from it. Nothing is stored: your browser keeps the conversation and every message rebuilds it on a fresh in-memory Sendo with a fake Meta. Limits: {sessionLimit} messages per session, {ipLimit} per network per day, {maxTokens} output tokens per reply.",
    installLink: "Install it in your app",
  },
} satisfies Record<Lang, DemoDict>;
