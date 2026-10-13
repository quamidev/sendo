import type { SendoContext } from "../core/context";
import {
  AccountNotFoundError,
  ConstraintViolationError,
  PayloadValidationError,
  RecordNotFoundError,
} from "../errors/errors";
import type { Snippet } from "../types/entities";
import { SNIPPET_VISIBILITIES, type SnippetVisibility } from "../types/enums";
import { assertCan, assertCanSeeConversation, requireActor, type Actor } from "./permissions";
import {
  SNIPPET_BODY_MAX_LENGTH,
  SNIPPET_SHORTCUT,
  fillSnippetVariables,
  findSnippetVariables,
  type FilledSnippet,
} from "./snippet-text";
import { resolveSnippetValues } from "./variables";

export interface SnippetsListOptions {
  actor: Actor;
  /** Only snippets usable on this account (every-account snippets plus this account's). */
  accountId?: string;
}

/**
 * Creates a snippet (no `id`) or edits one the actor can see. `tenant` snippets (the default)
 * need `snippets.manage_tenant`; anyone manages their own `personal` snippets.
 */
export interface SnippetInput {
  id?: string;
  /** `^[a-z0-9_-]{1,32}$`, without the leading `/`. Unique per tenant and owner. */
  shortcut: string;
  /** Text with `{{variables}}`; 1–4096 characters. */
  body: string;
  /** Omitted: `tenant` on create, unchanged on edit. */
  visibility?: SnippetVisibility;
  /** An account of the actor's tenant, or `null` for every account. Omitted: unchanged (`null` on create). */
  accountId?: string | null;
}

/** `sendo.snippets`. Every method is scoped to the actor's tenant. */
export interface SnippetsApi {
  /** Tenant snippets plus the actor's personal ones, sorted by shortcut. */
  list(o: SnippetsListOptions): Promise<Snippet[]>;
  /** Unknown, another tenant's, or someone else's personal snippet → `RecordNotFoundError`. */
  get(id: string, o: { actor: Actor }): Promise<Snippet>;
  /**
   * Taken shortcut → `ConstraintViolationError` (`sendo_snippets_shortcut_key`); invalid
   * input → `PayloadValidationError`; foreign account → `AccountNotFoundError`.
   */
  upsert(input: SnippetInput, o: { actor: Actor }): Promise<Snippet>;
  delete(id: string, o: { actor: Actor }): Promise<void>;
  /**
   * The snippet body for a conversation the actor can see: built-ins (`nombre`, `telefono`,
   * `agente`) and the app's `resolveSnippetVariables` filled in; variables without a value
   * stay as `{{name}}` and are listed in `unresolved`.
   */
  render(snippetId: string, o: { actor: Actor; conversationId: string }): Promise<FilledSnippet>;
}

function canSeeSnippet(actor: Actor, snippet: Snippet): boolean {
  return (
    snippet.tenantId === actor.tenantId &&
    (snippet.visibility === "tenant" || snippet.ownerUserId === actor.userId)
  );
}

function assertCanManage(actor: Actor, visibility: SnippetVisibility): void {
  if (visibility === "tenant") assertCan(actor, "snippets.manage_tenant");
}

function validShortcut(value: unknown): string {
  if (typeof value !== "string" || !SNIPPET_SHORTCUT.test(value)) {
    throw new PayloadValidationError({
      field: "shortcut",
      message:
        "use 1–32 lowercase letters, digits, `_` or `-`, without the leading `/` (for example `saludo`).",
      limit: 32,
    });
  }
  return value;
}

function validBody(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PayloadValidationError({ field: "body", message: "write the snippet text." });
  }
  if (value.length > SNIPPET_BODY_MAX_LENGTH) {
    throw new PayloadValidationError({
      field: "body",
      message: `shorten the text to ${String(SNIPPET_BODY_MAX_LENGTH)} characters or fewer.`,
      limit: SNIPPET_BODY_MAX_LENGTH,
    });
  }
  return value;
}

function validVisibility(value: unknown): SnippetVisibility {
  if (!(SNIPPET_VISIBILITIES as readonly unknown[]).includes(value)) {
    throw new PayloadValidationError({
      field: "visibility",
      message: 'use "tenant" (whole team) or "personal" (only you).',
    });
  }
  return value as SnippetVisibility;
}

export function createSnippets(ctx: SendoContext): SnippetsApi {
  const { adapter } = ctx;

  async function requireSnippet(id: string, actor: Actor): Promise<Snippet> {
    const snippet = await adapter.snippets.get(id);
    if (!snippet || !canSeeSnippet(actor, snippet)) {
      throw new RecordNotFoundError({ entity: "snippet", id });
    }
    return snippet;
  }

  async function validAccountId(accountId: string | null, actor: Actor): Promise<string | null> {
    if (accountId === null) return null;
    const account = await adapter.accounts.getById(accountId);
    if (!account || account.tenantId !== actor.tenantId) {
      throw new AccountNotFoundError({ account: accountId, tenantId: actor.tenantId });
    }
    return account.id;
  }

  return {
    async list({ actor, accountId }) {
      requireActor(actor);
      await ctx.ready();
      const scoped = accountId === undefined ? undefined : await validAccountId(accountId, actor);
      return adapter.snippets.list({
        tenantId: actor.tenantId,
        userId: actor.userId,
        accountId: scoped ?? undefined,
      });
    },

    async get(id, { actor }) {
      requireActor(actor);
      await ctx.ready();
      return requireSnippet(id, actor);
    },

    async upsert(input, { actor }) {
      requireActor(actor);
      await ctx.ready();
      const existing = input.id === undefined ? null : await requireSnippet(input.id, actor);
      const visibility =
        input.visibility === undefined
          ? (existing?.visibility ?? "tenant")
          : validVisibility(input.visibility);
      if (existing) assertCanManage(actor, existing.visibility);
      assertCanManage(actor, visibility);
      const shortcut = validShortcut(input.shortcut);
      const body = validBody(input.body);
      const accountId =
        input.accountId === undefined ? undefined : await validAccountId(input.accountId, actor);
      try {
        return await adapter.snippets.upsert({
          ...(existing ? { id: existing.id } : {}),
          tenantId: actor.tenantId,
          accountId,
          shortcut,
          body,
          visibility,
          ownerUserId: visibility === "personal" ? actor.userId : null,
          by: actor.userId,
        });
      } catch (error) {
        if (
          error instanceof ConstraintViolationError &&
          error.constraint === "sendo_snippets_shortcut_key"
        ) {
          const scope =
            visibility === "personal" ? "one of your personal snippets" : "another team snippet";
          throw new ConstraintViolationError(
            {
              constraint: error.constraint,
              message: `The shortcut "/${shortcut}" is already used by ${scope}. Choose a different shortcut or edit the existing snippet.`,
            },
            { cause: error },
          );
        }
        throw error;
      }
    },

    async delete(id, { actor }) {
      requireActor(actor);
      await ctx.ready();
      const snippet = await requireSnippet(id, actor);
      assertCanManage(actor, snippet.visibility);
      await adapter.snippets.delete(snippet.id);
    },

    async render(snippetId, { actor, conversationId }) {
      requireActor(actor);
      await ctx.ready();
      const conversation = await adapter.conversations.get(conversationId);
      if (!conversation)
        throw new RecordNotFoundError({ entity: "conversation", id: conversationId });
      assertCanSeeConversation(actor, conversation);
      const snippet = await requireSnippet(snippetId, actor);
      const names = findSnippetVariables(snippet.body);
      if (names.length === 0) return { text: snippet.body, unresolved: [] };
      const [contact, account] = await Promise.all([
        adapter.contacts.get(conversation.contactId),
        adapter.accounts.getById(conversation.accountId),
      ]);
      if (!contact)
        throw new RecordNotFoundError({ entity: "contact", id: conversation.contactId });
      if (!account)
        throw new RecordNotFoundError({ entity: "account", id: conversation.accountId });
      const values = await resolveSnippetValues(ctx, {
        actor,
        contact,
        conversation,
        account,
        names,
      });
      return fillSnippetVariables(snippet.body, values);
    },
  };
}

/** `SENDO_MODULES` entry. */
export function installSnippets(ctx: SendoContext): void {
  ctx.slots.snippets = createSnippets(ctx);
}
