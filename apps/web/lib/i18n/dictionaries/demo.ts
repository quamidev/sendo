import type { DemoFallbackReason } from "../../demo/protocol";
import type { Lang } from "../langs";

/**
 * The live demo: `/[lang]/demo` page chrome, the visitor's chat, the inbox frame and the copy the
 * demo server writes into the conversation (greeting fallback, handoff). `intro` takes
 * `{sessionLimit}`, `{ipLimit}` and `{maxTokens}`; `chat.remainingMany` takes `{count}`;
 * `chat.fallbackNotes.session_limit` takes `{limit}`; `agent.fallbackText` takes `{url}`
 * (see `interpolate()`).
 */
export interface DemoDict {
  meta: { title: string; description: string };
  title: string;
  intro: string;
  installLink: string;
  chat: {
    /** `aria-label` of the chat section. */
    label: string;
    /** The building's WhatsApp number as the visitor sees it. */
    contactName: string;
    contactStatus: string;
    typing: string;
    reset: string;
    messagesLabel: string;
    /** Empty state, above the suggestions. */
    emptyIntro: string;
    suggestions: string[];
    inputLabel: string;
    placeholder: string;
    send: string;
    /** Line above the handoff message. */
    handoffLine: string;
    /** Label of a step-in reply sent from the inbox. */
    teamLabel: string;
    remainingOne: string;
    remainingMany: string;
    /** Shown under the composer when the scripted fallback answered ("demo limit reached"). */
    fallbackNotes: Record<DemoFallbackReason, string>;
    errors: { server: string; offline: string; notSaved: string };
  };
  inbox: {
    /** `title` of the inbox iframe. */
    frameTitle: string;
    /** Toast when the visitor tries an action the demo doesn't allow. */
    readOnly: string;
  };
  /** Names the demo world stores, so the inbox shows them in the page language. */
  world: {
    visitorName: string;
    visitorUnit: string;
    operatorName: string;
    agentName: string;
    numberLabel: string;
  };
  /** What the demo server writes into the conversation. */
  agent: {
    /** The scripted reply (no model, or a limit reached). */
    fallbackText: string;
    handoffMessage: string;
    /** Handoff reason when a replayed handoff turn has none. */
    handoffReason: string;
  };
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
    chat: {
      label: "Chat de WhatsApp de la demo",
      contactName: "Torre Vista · Administración",
      contactStatus: "Cuenta de empresa · demo",
      typing: "escribiendo…",
      reset: "Empezar de nuevo",
      messagesLabel: "Mensajes",
      emptyIntro:
        "Escribe como residente del Apto 3C. Un agente con un modelo real responde, y la bandeja muestra la misma conversación como la ve el equipo.",
      suggestions: ["¿Cuánto debo este mes?", "Quiero hablar con una persona", "¿Qué es Sendo?"],
      inputLabel: "Mensaje",
      placeholder: "Escribe un mensaje",
      send: "Enviar",
      handoffLine: "La IA pasó la conversación a una persona",
      teamLabel: "Equipo · desde la bandeja",
      remainingOne: "Te queda 1 mensaje en esta sesión.",
      remainingMany: "Te quedan {count} mensajes en esta sesión.",
      fallbackNotes: {
        no_model: "Respuesta de guion: este servidor no tiene un modelo configurado.",
        session_limit:
          "Límite de la demo alcanzado: usaste los {limit} mensajes de esta sesión. Las respuestas ahora son de guion.",
        ip_limit: "Límite de la demo alcanzado para tu red hoy. Las respuestas ahora son de guion.",
        budget:
          "Límite de la demo alcanzado: se agotó el presupuesto del mes. Las respuestas ahora son de guion.",
        daily_cap: "Límite de la demo alcanzado por hoy. Las respuestas ahora son de guion.",
      },
      errors: {
        server: "La demo no respondió. Intenta de nuevo.",
        offline: "Sin conexión con la demo. Intenta de nuevo.",
        notSaved: "La respuesta no quedó guardada.",
      },
    },
    inbox: {
      frameTitle: "Bandeja de Sendo (demo)",
      readOnly:
        "En la demo solo puedes responder en tu conversación. Instala Sendo para tomar, cerrar, etiquetar o pausar.",
    },
    world: {
      visitorName: "Tú (visitante)",
      visitorUnit: "Apto 3C · Torre Vista",
      operatorName: "Tú",
      agentName: "Asistente IA",
      numberLabel: "Administración",
    },
    agent: {
      fallbackText: "El demo descansa un momento; mira el código en {url}",
      handoffMessage:
        "Te comunico con una persona del equipo de administración; te escribirán por aquí.",
      handoffReason: "Pidió hablar con una persona.",
    },
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
    chat: {
      label: "Demo WhatsApp chat",
      contactName: "Torre Vista · Management",
      contactStatus: "Business account · demo",
      typing: "typing…",
      reset: "Start over",
      messagesLabel: "Messages",
      emptyIntro:
        "Write as the resident of Apt 3C. An agent with a real model replies, and the inbox shows the same conversation the way the team sees it.",
      suggestions: [
        "How much do I owe this month?",
        "I want to talk to a person",
        "What is Sendo?",
      ],
      inputLabel: "Message",
      placeholder: "Type a message",
      send: "Send",
      handoffLine: "The AI handed the conversation to a person",
      teamLabel: "Team · from the inbox",
      remainingOne: "1 message left in this session.",
      remainingMany: "{count} messages left in this session.",
      fallbackNotes: {
        no_model: "Scripted reply: this server has no model configured.",
        session_limit:
          "Demo limit reached: you used the {limit} messages of this session. Replies are scripted now.",
        ip_limit: "Demo limit reached for your network today. Replies are scripted now.",
        budget: "Demo limit reached: this month’s model budget is spent. Replies are scripted now.",
        daily_cap: "Demo limit reached for today. Replies are scripted now.",
      },
      errors: {
        server: "The demo didn’t answer. Try again.",
        offline: "Can’t reach the demo. Try again.",
        notSaved: "The reply wasn’t saved.",
      },
    },
    inbox: {
      frameTitle: "Sendo inbox (demo)",
      readOnly:
        "In the demo you can only reply in your own conversation. Install Sendo to take, close, tag or pause.",
    },
    world: {
      visitorName: "You (visitor)",
      visitorUnit: "Apt 3C · Torre Vista",
      operatorName: "You",
      agentName: "AI assistant",
      numberLabel: "Management",
    },
    agent: {
      fallbackText: "The demo is taking a short break; see the code at {url}",
      handoffMessage:
        "I’m connecting you with someone from the management team; they’ll reply here.",
      handoffReason: "Asked to talk to a person.",
    },
  },
} satisfies Record<Lang, DemoDict>;
