import type { TagColor } from "@quami/sendo";
import {
  agentHandoff,
  deliverInbound,
  insertAgentReply,
  teamNote,
  teamReply,
  type DemoContact,
} from "./conversation";
import type { DemoWorld } from "./world";

// The other conversations of the demo inbox (the landing and /demo): a few residents of the
// building, each showing one thing the team inbox does. Times are relative to the render.

type FixtureStep =
  | { kind: "in"; minutesAgo: number; text: string }
  | { kind: "agent"; minutesAgo: number; text: string }
  | { kind: "team"; minutesAgo: number; by: string; text: string }
  | { kind: "note"; minutesAgo: number; by: string; text: string }
  | { kind: "handoff"; minutesAgo: number; reason: string }
  | { kind: "draft"; text: string };

interface FixtureConversation {
  key: string;
  contact: DemoContact & { appRef: string | null };
  steps: FixtureStep[];
  tags?: { name: string; color: TagColor }[];
  assignedTo?: string;
  agentPaused?: boolean;
  close?: boolean;
  /** Unread inbound messages shown in the list. Default 0. */
  unread?: number;
}

const USAGE = { tokensIn: 1180, tokensOut: 72, costCents: 0.15 };

export const DEMO_FIXTURES: FixtureConversation[] = [
  {
    key: "cobro-doble",
    contact: {
      waId: "50255124433",
      profileName: "María José Castillo",
      appRef: "Apto 4B · Torre Vista",
    },
    tags: [{ name: "cobranza", color: "amber" }],
    assignedTo: "ana",
    unread: 1,
    steps: [
      { kind: "in", minutesAgo: 96, text: "Buenas, me cobraron dos veces la cuota de octubre 😟" },
      {
        kind: "agent",
        minutesAgo: 95,
        text: "Hola, María José. Veo dos cargos de Q 1,100.00 el 1 de octubre. Te paso con administración para revertir uno.",
      },
      {
        kind: "handoff",
        minutesAgo: 95,
        reason: "Cobro doble de la cuota de octubre; pide revertir un cargo.",
      },
      {
        kind: "note",
        minutesAgo: 60,
        by: "ana",
        text: "Pedí al banco el estado de cuenta; reviso hoy antes de las 5.",
      },
      { kind: "in", minutesAgo: 14, text: "¿Me confirman hoy? Necesito ese dinero esta semana." },
    ],
  },
  {
    key: "fuga",
    contact: {
      waId: "50255230981",
      profileName: "Luis Hernández",
      appRef: "Apto 7A · Torre Vista",
    },
    tags: [{ name: "mantenimiento", color: "blue" }],
    steps: [
      {
        kind: "in",
        minutesAgo: 42,
        text: "Hola, hay una fuga debajo del lavamanos del baño [#garita]",
      },
      {
        kind: "agent",
        minutesAgo: 41,
        text: "Gracias, Luis. Registré el reporte #1042: mantenimiento pasa mañana entre 9:00 y 11:00. ¿Te funciona?",
      },
      { kind: "in", minutesAgo: 39, text: "Sí, perfecto. Gracias" },
      {
        kind: "agent",
        minutesAgo: 39,
        text: "Listo, quedó confirmado. Si empeora, escríbeme y aviso de inmediato.",
      },
    ],
  },
  {
    key: "salon",
    contact: {
      waId: "50255871204",
      profileName: "Sofía Ramírez",
      appRef: "Apto 12C · Torre Vista",
    },
    tags: [{ name: "reservas", color: "green" }],
    unread: 1,
    steps: [
      { kind: "in", minutesAgo: 8, text: "¿Está libre el salón social el sábado 18 en la tarde?" },
      {
        kind: "draft",
        text: "Hola, Sofía. El salón social está libre el sábado 18 de 14:00 a 20:00. ¿Lo reservo a tu nombre?",
      },
    ],
  },
  {
    key: "contrato",
    contact: { waId: "50255619377", profileName: "Andrea López", appRef: "Apto 2B · Torre Vista" },
    assignedTo: "luis",
    agentPaused: true,
    tags: [{ name: "contrato", color: "violet" }],
    steps: [
      {
        kind: "in",
        minutesAgo: 190,
        text: "Necesito una copia firmada de mi contrato de arrendamiento",
      },
      {
        kind: "team",
        minutesAgo: 170,
        by: "luis",
        text: "Hola, Andrea. Te la envío por correo hoy en la tarde.",
      },
      { kind: "in", minutesAgo: 168, text: "¡Gracias!" },
    ],
  },
  {
    key: "piscina",
    contact: { waId: "50255408812", profileName: "Carlos Méndez", appRef: null },
    close: true,
    steps: [
      { kind: "in", minutesAgo: 300, text: "¿Cuál es el horario de la piscina?" },
      {
        kind: "agent",
        minutesAgo: 299,
        text: "Hola, Carlos. La piscina abre todos los días de 7:00 a 21:00; los lunes cierra hasta las 12:00 por limpieza.",
      },
    ],
  },
];

function minutesAgo(base: Date, minutes: number): Date {
  return new Date(base.getTime() - minutes * 60_000);
}

/** Seeds every fixture conversation; returns fixture key → conversation id. */
export async function seedDemoFixtures(
  world: DemoWorld,
  base = new Date(),
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  const tagIds = new Map<string, string>();
  for (const fixture of DEMO_FIXTURES) {
    let conversationId: string | null = null;
    for (const step of fixture.steps) {
      if (step.kind === "in") {
        const conversation = await deliverInbound(
          world,
          fixture.contact,
          step.text,
          minutesAgo(base, step.minutesAgo),
        );
        conversationId = conversation.id;
        if (fixture.contact.appRef !== null) {
          await world.adapter.contacts.setAppRef(conversation.contactId, fixture.contact.appRef);
        }
        continue;
      }
      if (conversationId === null) throw new Error(`fixture ${fixture.key} must start with "in"`);
      const at = step.kind === "draft" ? base : minutesAgo(base, step.minutesAgo);
      if (step.kind === "agent") {
        const conversation = await world.adapter.conversations.get(conversationId);
        if (conversation === null) throw new Error(`fixture ${fixture.key} lost its conversation`);
        await insertAgentReply(world, conversation, step.text, at, USAGE);
      } else if (step.kind === "team") {
        await teamReply(world, conversationId, step.by, step.text, at);
      } else if (step.kind === "note") {
        await teamNote(world, conversationId, step.by, step.text, at);
      } else if (step.kind === "handoff") {
        await agentHandoff(world, conversationId, step.reason, at);
      } else {
        world.clock.set(minutesAgo(base, 7));
        await world.adapter.messages.insertOutbound({
          tenantId: world.account.tenantId,
          conversationId,
          type: "text",
          content: { body: step.text },
          text: step.text,
          sender: "agent",
          senderRef: "torre-vista",
          draft: true,
          ...USAGE,
        });
        world.clock.set(null);
      }
    }
    if (conversationId === null) continue;
    ids[fixture.key] = conversationId;

    for (const tag of fixture.tags ?? []) {
      let tagId = tagIds.get(tag.name);
      if (tagId === undefined) {
        tagId = (await world.adapter.tags.upsert({ tenantId: world.account.tenantId, ...tag })).id;
        tagIds.set(tag.name, tagId);
      }
      await world.adapter.tags.addToConversation(conversationId, tagId);
    }
    await world.adapter.conversations.update(conversationId, { unreadCount: fixture.unread ?? 0 });
    if (fixture.assignedTo !== undefined) {
      await world.adapter.conversations.update(conversationId, { assignedTo: fixture.assignedTo });
    }
    if (fixture.agentPaused === true) {
      await world.adapter.conversations.update(conversationId, {
        agentPaused: true,
        status: "human",
      });
    }
    if (fixture.close === true) {
      world.clock.set(minutesAgo(base, 290));
      await world.sendo.conversations.close(conversationId, { by: "ana" });
      world.clock.set(null);
    }
  }
  // An unused tag, so the catalog has more than the conversations show.
  await world.adapter.tags.upsert({
    tenantId: world.account.tenantId,
    name: "urgente",
    color: "red",
  });
  return ids;
}
