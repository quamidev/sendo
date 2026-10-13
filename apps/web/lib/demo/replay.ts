import { z } from "zod";
import { agentHandoff, deliverInbound, insertAgentReply, teamReply } from "./conversation";
import {
  DEMO_OPERATOR_ID,
  DEMO_TEXT_MAX_LENGTH,
  DEMO_TRANSCRIPT_MAX_TURNS,
  type DemoRequest,
  type DemoTurn,
} from "./protocol";
import { DEMO_VISITOR, type DemoWorld } from "./world";

const turnSchema = z.object({
  role: z.enum(["contact", "agent", "team", "handoff"]),
  text: z.string().max(2000),
  at: z.string().max(64),
});

const requestSchema = z.object({
  transcript: z.array(turnSchema).max(DEMO_TRANSCRIPT_MAX_TURNS),
  text: z.string().trim().min(1).max(DEMO_TEXT_MAX_LENGTH),
  from: z.enum(["contact", "team"]).optional(),
});

/** Oldest replayed message: the 24-hour window must still be open for team replies. */
const MAX_AGE_MS = 20 * 60 * 60 * 1000;

export type ParsedDemoRequest = Required<DemoRequest>;

/**
 * Validates the body and normalizes the transcript the browser sent (it is untrusted): leading
 * non-contact turns are dropped, empty texts skipped, times clamped to the last 20 hours and
 * made strictly increasing.
 */
export function parseDemoRequest(body: unknown, now: Date): ParsedDemoRequest | string {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return issue === undefined
      ? "Invalid request."
      : `${issue.path.join(".") || "body"}: ${issue.message}`;
  }
  const transcript: DemoTurn[] = [];
  const oldest = now.getTime() - MAX_AGE_MS;
  const newest = now.getTime() - 1000;
  let previous = oldest - 1;
  for (const turn of parsed.data.transcript) {
    const text = turn.text.trim();
    if (text === "" && turn.role !== "handoff") continue;
    if (transcript.length === 0 && turn.role !== "contact") continue;
    const parsedAt = Date.parse(turn.at);
    const clamped = Number.isNaN(parsedAt)
      ? previous + 1000
      : Math.min(Math.max(parsedAt, oldest), newest);
    const at = Math.max(clamped, previous + 1);
    previous = at;
    transcript.push({ role: turn.role, text, at: new Date(at).toISOString() });
  }
  if (parsed.data.from === "team" && transcript.length === 0) {
    return "transcript: a team reply needs the conversation first.";
  }
  return { transcript, text: parsed.data.text, from: parsed.data.from ?? "contact" };
}

/** Rebuilds the demo conversation from the transcript; returns its id (`null` when empty). */
export async function replayTranscript(
  world: DemoWorld,
  transcript: DemoTurn[],
): Promise<string | null> {
  let conversationId: string | null = null;
  for (const turn of transcript) {
    const at = new Date(turn.at);
    if (turn.role === "contact") {
      conversationId = (await deliverInbound(world, DEMO_VISITOR, turn.text, at)).id;
      continue;
    }
    if (conversationId === null) continue;
    if (turn.role === "agent") {
      const conversation = await world.adapter.conversations.get(conversationId);
      if (conversation !== null) await insertAgentReply(world, conversation, turn.text, at);
    } else if (turn.role === "team") {
      await teamReply(world, conversationId, DEMO_OPERATOR_ID, turn.text, at);
    } else {
      const conversation = await world.adapter.conversations.get(conversationId);
      if (conversation?.status === "agent") {
        await agentHandoff(world, conversationId, turn.text || "Pidió hablar con una persona.", at);
      }
    }
  }
  return conversationId;
}
