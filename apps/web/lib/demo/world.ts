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
import type { Lang } from "@/lib/i18n/langs";
import { demoCopy } from "./copy";
import {
  createFakeMetaTransport,
  DEMO_DISPLAY_PHONE,
  DEMO_PHONE_NUMBER_ID,
  DEMO_WABA_ID,
} from "./fake-meta";
import { DEMO_AGENT_NAME, DEMO_OPERATOR_ID, DEMO_TENANT_ID } from "./protocol";

type DemoModel = AgentDefinition["model"];

// One throwaway Sendo per request (or per render): memory adapter, fake Meta, the building's
// WhatsApp number and its agent, with names and built-in messages in the page language.
// Nothing outlives the call.

/** The visitor, writing as a resident of the demo building (names follow the page language). */
export interface DemoVisitor {
  waId: string;
  phone: string;
  profileName: string;
  appRef: string;
}

/** People of the demo team besides the visitor (`resolveUsers`, assignees, note authors). */
const TEAM: Record<string, string> = { ana: "Ana Gómez", luis: "Luis Pérez" };

/** USD per million tokens, used for `costCents` when the provider reports no cost. Deliberately high. */
const DEFAULT_PRICING = { inputPerMTok: 1, outputPerMTok: 5 };

/** The visitor's apartment balance the agent's tool reads: "the agent checks a balance by calling the app's own code". */
const BALANCE: Record<Lang, { balance: string; dueDate: string; items: string[] }> = {
  es: {
    balance: "Q 1,250.00",
    dueDate: "15 de octubre",
    items: ["Cuota de mantenimiento de octubre: Q 1,100.00", "Parqueo de visitas: Q 150.00"],
  },
  en: {
    balance: "Q 1,250.00",
    dueDate: "October 15",
    items: ["October maintenance fee: Q 1,100.00", "Visitor parking: Q 150.00"],
  },
};

const LANGUAGE_NAMES: Record<Lang, string> = { es: "Spanish", en: "English" };

function balanceTool(lang: Lang, visitor: DemoVisitor) {
  return agentTool({
    description: "Looks up the pending balance of the apartment linked to the contact in the app.",
    input: z.object({}),
    run: ({ contact }) =>
      Promise.resolve(
        contact.appRef === visitor.appRef
          ? { linked: true, apartment: contact.appRef, ...BALANCE[lang] }
          : { linked: false },
      ),
  });
}

function agentDefinition(model: DemoModel, lang: Lang, visitor: DemoVisitor): AgentDefinition {
  const copy = demoCopy(lang);
  const language = LANGUAGE_NAMES[lang];
  return {
    name: DEMO_AGENT_NAME,
    model,
    instructions:
      "You are the WhatsApp assistant of the management office of the Torre Vista building. This " +
      "conversation is Sendo's public demo (sendo.quami.dev): the person writing is a visitor trying the " +
      "product as if they were a resident. " +
      `Language: the visitor opened the demo on the ${language} page, so greet them in ${language}; ` +
      "after that, reply in whatever language the visitor writes in. " +
      "Answer in at most three short sentences, in a friendly tone. The contact is already linked to " +
      "their apartment in the app: use consultar_saldo when they ask about their balance, fees or " +
      "payments. If they ask for a person, are upset, or ask for something you can't resolve " +
      "(bookings, repairs, lease changes), hand the conversation to a person. If they ask what Sendo " +
      "is, say it in one sentence: a WhatsApp conversation inbox with AI agents and people that " +
      "installs inside the developer's app. Don't talk about other topics and don't write code.",
    tools: { consultar_saldo: balanceTool(lang, visitor) },
    handoff: {
      when: "the contact asks for a person, is upset, or asks for something you can't resolve",
      to: "administracion",
      message: copy.handoffMessage,
    },
    pricing: DEFAULT_PRICING,
    historyLimit: 20,
    maxStepsPerTurn: 3,
    maxMessagesPerMinutePerContact: 30,
    fallbackMessage: copy.fallbackText,
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
  lang: Lang;
  /** The visitor's contact, with its name and apartment in `lang`. */
  visitor: DemoVisitor;
  /** User id → name of everyone on the demo team, the visitor included. */
  team: Record<string, string>;
  /** Copy the demo writes into conversations (handoff message, fallback reply, labels). */
  copy: ReturnType<typeof demoCopy>;
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

/** A fresh demo world whose names, agent greeting and built-in messages follow `lang`. */
export async function createDemoWorld(lang: Lang): Promise<DemoWorld> {
  const copy = demoCopy(lang);
  const visitor: DemoVisitor = {
    waId: "50255550123",
    phone: "+50255550123",
    profileName: copy.visitorName,
    appRef: copy.visitorUnit,
  };
  const team: Record<string, string> = { [DEMO_OPERATOR_ID]: copy.operatorName, ...TEAM };
  const clock = createClock();
  const adapter = memoryAdapter({ now: clock.now });
  const sendo = createSendo({
    locale: lang,
    adapter,
    transport: createFakeMetaTransport(),
    logger: quietLogger,
    handoffMessage: null,
    linkContact: ({ phone }) => (phone === visitor.phone ? visitor.appRef : null),
    resolveRole: ({ userId, tenantId }) =>
      Promise.resolve(
        tenantId === DEMO_TENANT_ID && userId in team ? { role: "admin" as const } : null,
      ),
    resolveUsers: (ids) =>
      Promise.resolve(
        ids.flatMap((id) => {
          const name = team[id];
          return name === undefined ? [] : [{ id, name }];
        }),
      ),
    resolveAssignees: () => Promise.resolve(["ana", "luis", DEMO_OPERATOR_ID]),
  });

  clock.set(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const account = await adapter.accounts.insert({
    tenantId: DEMO_TENANT_ID,
    channel: "whatsapp",
    label: copy.numberLabel,
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
    lang,
    visitor,
    team,
    copy,
    sendo,
    adapter,
    clock,
    account,
    actor,
    startAgent: (model) => {
      sendo.agent(agentDefinition(model, lang, visitor));
    },
  };
}
