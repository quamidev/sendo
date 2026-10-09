import {
  agentTool,
  createSendo,
  type Account,
  type Actor,
  type AgentDefinition,
  type Sendo,
} from "@quami/sendo";
import { memoryAdapter, type MemoryAdapter } from "@quami/sendo/adapters/memory";
import { z } from "zod";

type DemoModel = AgentDefinition["model"];
import {
  createFakeMetaTransport,
  DEMO_DISPLAY_PHONE,
  DEMO_PHONE_NUMBER_ID,
  DEMO_WABA_ID,
} from "./fake-meta";
import {
  DEMO_FALLBACK_TEXT,
  DEMO_HANDOFF_MESSAGE,
  DEMO_OPERATOR_ID,
  DEMO_TENANT_ID,
} from "./protocol";

// One throwaway Sendo per request (or per render): memory adapter, fake Meta, the building's
// WhatsApp number and its agent. Nothing outlives the call.

/** The visitor, writing as a resident of the demo building. */
export const DEMO_VISITOR = {
  waId: "50255550123",
  phone: "+50255550123",
  profileName: "Tú (visitante)",
  appRef: "Apto 3C · Torre Vista",
} as const;

export const DEMO_AGENT_NAME = "torre-vista";

/** People of the demo team (`resolveUsers`, assignees, note authors). */
export const DEMO_TEAM: Record<string, string> = {
  [DEMO_OPERATOR_ID]: "Tú",
  ana: "Ana Gómez",
  luis: "Luis Pérez",
};

export const DEMO_AGENT_NAMES: Record<string, string> = { [DEMO_AGENT_NAME]: "Asistente IA" };

/** USD per million tokens, used for `costCents` when the provider reports no cost. Deliberately high. */
const DEFAULT_PRICING = { inputPerMTok: 1, outputPerMTok: 5 };

/** Apartment balances the agent's tool reads: "the agent checks a balance by calling the app's own code". */
const BALANCES: Record<string, { saldo: string; vence: string; detalle: string[] }> = {
  [DEMO_VISITOR.appRef]: {
    saldo: "Q 1,250.00",
    vence: "15 de octubre",
    detalle: ["Cuota de mantenimiento de octubre: Q 1,100.00", "Parqueo de visitas: Q 150.00"],
  },
};

const consultarSaldo = agentTool({
  description: "Consulta el saldo pendiente del apartamento vinculado al contacto en la app.",
  input: z.object({}),
  run: ({ contact }) => {
    const balance = contact.appRef === null ? undefined : BALANCES[contact.appRef];
    return Promise.resolve(
      balance === undefined
        ? { vinculado: false }
        : { vinculado: true, apartamento: contact.appRef, ...balance },
    );
  },
});

function agentDefinition(model: DemoModel): AgentDefinition {
  return {
    name: DEMO_AGENT_NAME,
    model,
    instructions:
      "Eres el asistente de WhatsApp de la administración del edificio Torre Vista. Esta conversación es la " +
      "demo pública de Sendo (sendo.dev): quien escribe es un visitante que prueba el producto como si fuera " +
      "residente. Responde en el idioma del contacto, en máximo tres oraciones cortas y con tono amable. " +
      "El contacto ya está vinculado a su apartamento en la app: usa consultar_saldo cuando pregunte por su " +
      "saldo, cuotas o pagos. Si pide hablar con una persona, está molesto o pide algo que no puedes resolver " +
      "(reservas, reparaciones, cambios de contrato), transfiere a una persona. Si pregunta qué es Sendo, dilo en una oración: una bandeja de conversaciones de " +
      "WhatsApp con agentes de IA y personas que se instala dentro de la app del desarrollador. No hables de " +
      "otros temas y no escribas código.",
    tools: { consultar_saldo: consultarSaldo },
    handoff: {
      when: "el contacto pide una persona, está molesto o pide algo que no puedes resolver",
      to: "administracion",
      message: DEMO_HANDOFF_MESSAGE,
    },
    pricing: DEFAULT_PRICING,
    historyLimit: 20,
    maxStepsPerTurn: 3,
    maxMessagesPerMinutePerContact: 30,
    fallbackMessage: DEMO_FALLBACK_TEXT,
    timezone: "America/Guatemala",
  };
}

/** Movable clock for `memoryAdapter({ now })`: pinned while seeding or replaying, real time otherwise. */
export interface DemoClock {
  now(): Date;
  set(at: Date | null): void;
}

function createClock(): DemoClock {
  let pinned: Date | null = null;
  return {
    now: () => (pinned === null ? new Date() : new Date(pinned)),
    set: (at) => {
      pinned = at;
    },
  };
}

export interface DemoWorld {
  sendo: Sendo;
  adapter: MemoryAdapter;
  clock: DemoClock;
  account: Account;
  /** The visitor as an admin of the demo tenant (sees cost per turn). */
  actor: Actor;
  /** Registers the agent; replies only to messages delivered afterwards. */
  startAgent(model: DemoModel): void;
}

const quietLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: (...args: unknown[]) => {
    console.warn(...args);
  },
  error: (...args: unknown[]) => {
    console.error(...args);
  },
};

export async function createDemoWorld(): Promise<DemoWorld> {
  const clock = createClock();
  const adapter = memoryAdapter({ now: clock.now });
  const sendo = createSendo({
    adapter,
    transport: createFakeMetaTransport(),
    logger: quietLogger,
    handoffMessage: null,
    linkContact: ({ phone }) => (phone === DEMO_VISITOR.phone ? DEMO_VISITOR.appRef : null),
    resolveRole: ({ userId, tenantId }) =>
      Promise.resolve(
        tenantId === DEMO_TENANT_ID && userId in DEMO_TEAM ? { role: "admin" as const } : null,
      ),
    resolveUsers: (ids) =>
      Promise.resolve(
        ids.flatMap((id) => {
          const name = DEMO_TEAM[id];
          return name === undefined ? [] : [{ id, name }];
        }),
      ),
    resolveAssignees: () => Promise.resolve(["ana", "luis", DEMO_OPERATOR_ID]),
  });

  clock.set(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const account = await adapter.accounts.insert({
    tenantId: DEMO_TENANT_ID,
    channel: "whatsapp",
    label: "Administración",
    phoneNumberId: DEMO_PHONE_NUMBER_ID,
    wabaId: DEMO_WABA_ID,
    displayPhone: DEMO_DISPLAY_PHONE,
    tokenRef: "SENDO_DEMO_TOKEN",
    isDefault: true,
    billingReady: true,
  });
  clock.set(null);

  const actor = await sendo.actor(DEMO_OPERATOR_ID, DEMO_TENANT_ID);
  return {
    sendo,
    adapter,
    clock,
    account,
    actor,
    startAgent: (model) => {
      sendo.agent(agentDefinition(model));
    },
  };
}
