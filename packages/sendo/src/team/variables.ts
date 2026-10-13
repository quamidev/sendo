import type { SendoContext } from "../core/context";
import type { Account, Contact, Conversation } from "../types/entities";
import type { Actor } from "./permissions";

/** Always available in snippets: the contact's name and phone, the sending user's name. */
export const BUILT_IN_SNIPPET_VARIABLES = ["nombre", "telefono", "agente"] as const;

export interface SnippetValuesInput {
  actor: Actor;
  contact: Contact;
  conversation: Conversation;
  account: Account;
  /** The variables the snippet uses; nothing is resolved when empty. */
  names: readonly string[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function agentName(ctx: Pick<SendoContext, "team" | "logger">, userId: string) {
  const resolveUsers = ctx.team.resolveUsers;
  if (!resolveUsers) return null;
  try {
    const users = await resolveUsers([userId]);
    return users.find((u) => u.id === userId)?.name ?? null;
  } catch (error) {
    ctx.logger.warn(
      `[sendo] resolveUsers failed; {{agente}} stays unresolved: ${errorText(error)}`,
    );
    return null;
  }
}

/**
 * Values for a snippet's variables: the built-ins (`nombre`, `telefono`, `agente` via
 * `resolveUsers`) with the app's `resolveSnippetVariables` merged over them. A failing app
 * hook is logged and leaves its variables unresolved (they still block sending in the UI).
 */
export async function resolveSnippetValues(
  ctx: Pick<SendoContext, "team" | "logger">,
  input: SnippetValuesInput,
): Promise<Record<string, string>> {
  if (input.names.length === 0) return {};
  const values: Record<string, string> = {};
  if (input.contact.profileName) values.nombre = input.contact.profileName;
  if (input.contact.phone) values.telefono = input.contact.phone;
  if (input.names.includes("agente")) {
    const name = await agentName(ctx, input.actor.userId);
    if (name) values.agente = name;
  }

  const resolveApp = ctx.team.resolveSnippetVariables;
  if (!resolveApp) return values;
  try {
    const app: unknown = await resolveApp({
      contact: input.contact,
      conversation: input.conversation,
      account: input.account,
    });
    if (app !== null && typeof app === "object") {
      for (const [name, value] of Object.entries(app as Record<string, unknown>)) {
        if (typeof value === "string") values[name] = value;
      }
    }
  } catch (error) {
    ctx.logger.warn(
      `[sendo] resolveSnippetVariables failed; app variables stay unresolved: ${errorText(error)}`,
    );
  }
  return values;
}
