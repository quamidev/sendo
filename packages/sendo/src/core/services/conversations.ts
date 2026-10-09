import type { ConversationPatch, GetOpenOrCreateResult } from "../../adapters/types";
import { RecordNotFoundError } from "../../errors/errors";
import type { Account, Contact, Conversation, WindowStatus } from "../../types/entities";
import type { ConversationStatus } from "../../types/enums";
import { windowExpiresAt, windowStatus } from "../../utils/window";
import type { SendoContext } from "../context";

export interface EnsureConversationInput {
  account: Account;
  contact: Contact;
  /** An inbound message at `at`: advances the window and activity, increments unread. */
  inbound?: { at: Date };
}

export interface ByOption {
  /** Who made the change: `"system"` (default), an agent name or a user id. */
  by?: string;
}

export interface HandoffOptions extends ByOption {
  reason: string;
  /** Passed to `resolveHandoffTargets` (e.g. a team or role). */
  to?: string;
  /** Overrides `config.handoffMessage`; `null` sends nothing. */
  message?: string | null;
}

export interface HandoffResult {
  conversation: Conversation;
  assignees: string[];
}

export interface ConversationsService {
  /**
   * `getOpenOrCreate`; a reopen emits `conversation.status` (closed → agent, by "system").
   * An inbound sets `awaitingReplySince` when it is null.
   */
  ensure(input: EnsureConversationInput): Promise<GetOpenOrCreateResult>;
  /** Throws `RecordNotFoundError`. */
  require(id: string): Promise<Conversation>;
  /**
   * 1. status `human` + `handoffReason`; 2. `resolveHandoffTargets` (exactly one → `assignedTo`);
   * 3. the handoff message as sender "system" (send failures are logged); 4. `handoff` event.
   */
  handoff(id: string, opts: HandoffOptions): Promise<HandoffResult>;
  /** Status `agent`, clears `assignedTo` and `handoffReason`. */
  returnToAgent(id: string, opts?: ByOption): Promise<Conversation>;
  close(id: string, opts?: ByOption): Promise<Conversation>;
  /** Sets `assignedTo`; assigning a user also moves the conversation to `human`. `null` unassigns. */
  assign(id: string, userId: string | null, opts?: ByOption): Promise<Conversation>;
  windowStatus(id: string): Promise<WindowStatus>;
}

const SYSTEM = "system";

export function createConversationsService(ctx: SendoContext): ConversationsService {
  const { adapter, emitter } = ctx;

  async function requireConversation(id: string): Promise<Conversation> {
    const conversation = await adapter.conversations.get(id);
    if (!conversation) throw new RecordNotFoundError({ entity: "conversation", id });
    return conversation;
  }

  /**
   * Adds the derived columns a change implies: `everHuman` the first time the status
   * becomes `human`, `assignedAt` whenever `assignedTo` changes (cleared on unassign).
   */
  function withBookkeeping(current: Conversation, patch: ConversationPatch): ConversationPatch {
    const out: ConversationPatch = { ...patch };
    if (patch.status === "human" && !current.everHuman) out.everHuman = true;
    if (patch.assignedTo !== undefined && patch.assignedTo !== current.assignedTo) {
      out.assignedAt = patch.assignedTo === null ? null : new Date();
    }
    return out;
  }

  function update(current: Conversation, patch: ConversationPatch): Promise<Conversation> {
    return adapter.conversations.update(current.id, withBookkeeping(current, patch));
  }

  async function changeStatus(
    conversation: Conversation,
    to: ConversationStatus,
    patch: ConversationPatch,
    by: string,
  ): Promise<Conversation> {
    const updated = await update(conversation, { ...patch, status: to });
    if (conversation.status !== to) {
      await emitter.emit("conversation.status", {
        conversation: updated,
        from: conversation.status,
        to,
        by,
      });
    }
    return updated;
  }

  async function participants(
    conversation: Conversation,
  ): Promise<{ account: Account; contact: Contact }> {
    const [account, contact] = await Promise.all([
      adapter.accounts.getById(conversation.accountId),
      adapter.contacts.get(conversation.contactId),
    ]);
    if (!account) throw new RecordNotFoundError({ entity: "account", id: conversation.accountId });
    if (!contact) throw new RecordNotFoundError({ entity: "contact", id: conversation.contactId });
    return { account, contact };
  }

  return {
    async ensure({ account, contact, inbound }) {
      const result = await adapter.conversations.getOpenOrCreate({
        contactId: contact.id,
        accountId: account.id,
        tenantId: account.tenantId,
      });
      let conversation = result.conversation;
      if (inbound !== undefined) {
        const { at } = inbound;
        const patch: ConversationPatch = { incrementUnread: 1 };
        if (at.getTime() > conversation.lastActivityAt.getTime()) patch.lastActivityAt = at;
        if (conversation.awaitingReplySince === null) patch.awaitingReplySince = at;
        if (conversation.lastInboundAt === null || at > conversation.lastInboundAt) {
          patch.lastInboundAt = at;
          patch.windowExpiresAt = windowExpiresAt(at);
        }
        conversation = await adapter.conversations.update(conversation.id, patch);
      }
      if (result.reopened) {
        await emitter.emit("conversation.status", {
          conversation,
          from: "closed",
          to: "agent",
          by: SYSTEM,
        });
      }
      return { ...result, conversation };
    },

    require: requireConversation,

    async handoff(id, opts) {
      const by = opts.by ?? SYSTEM;
      const current = await requireConversation(id);
      const { account, contact } = await participants(current);
      let conversation = await changeStatus(current, "human", { handoffReason: opts.reason }, by);

      let assignees: string[] = [];
      const resolveTargets = ctx.config.resolveHandoffTargets;
      if (resolveTargets !== null) {
        try {
          assignees = [...(await resolveTargets({ to: opts.to, account, conversation, contact }))];
        } catch (error) {
          ctx.logger.error("[sendo] resolveHandoffTargets failed", error);
        }
      }
      const [only] = assignees;
      if (assignees.length === 1 && only !== undefined) {
        conversation = await update(conversation, { assignedTo: only });
      }

      const text = opts.message === undefined ? ctx.config.handoffMessage : opts.message;
      if (text !== null) {
        try {
          await ctx.services.messages.send(
            { account, contact, conversation, sender: "system", senderRef: null },
            { kind: "text", body: text },
          );
          conversation = await requireConversation(id);
        } catch (error) {
          ctx.logger.warn("[sendo] handoff message was not sent", error);
        }
      }

      await emitter.emit("handoff", {
        conversation,
        contact,
        account,
        reason: opts.reason,
        assignees,
      });
      return { conversation, assignees };
    },

    async returnToAgent(id, opts = {}) {
      const current = await requireConversation(id);
      return changeStatus(
        current,
        "agent",
        { assignedTo: null, handoffReason: null },
        opts.by ?? SYSTEM,
      );
    },

    async close(id, opts = {}) {
      const current = await requireConversation(id);
      return changeStatus(current, "closed", {}, opts.by ?? SYSTEM);
    },

    async assign(id, userId, opts = {}) {
      const current = await requireConversation(id);
      if (userId === null) return update(current, { assignedTo: null });
      return changeStatus(current, "human", { assignedTo: userId }, opts.by ?? SYSTEM);
    },

    async windowStatus(id) {
      const conversation = await requireConversation(id);
      return windowStatus(conversation.lastInboundAt);
    },
  };
}
