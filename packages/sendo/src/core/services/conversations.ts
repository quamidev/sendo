import type { ConversationPatch, GetOpenOrCreateResult } from "../../adapters/types";
import { RecordNotFoundError } from "../../errors/errors";
import { resolveAssigneeIds } from "../../team/config";
import type { Account, Contact, Conversation, WindowStatus } from "../../types/entities";
import type { ConversationStatus } from "../../types/enums";
import { windowExpiresAt, windowStatus } from "../../utils/window";
import type { SendoContext } from "../context";
import { SYSTEM_LINE_EVENTS, type SystemEventName, type SystemLineParams } from "../messages";

export interface EnsureConversationInput {
  account: Account;
  contact: Contact;
  /** An inbound message at `at`: advances the window and activity, increments unread. */
  inbound?: { at: Date };
}

export interface ByOption {
  /**
   * Who made the change: `"system"` (default), `"agent:<name>"`, `"rule:<key>"` or a user id.
   * Changes by `rule:*` insert no system line (the rules engine writes its own).
   */
  by?: string;
}

export interface HandoffOptions extends ByOption {
  reason: string;
  /** Queue (or team/role for `resolveHandoffTargets`) the conversation goes to. */
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
   * 1. status `human` + `handoffReason` and a system line; 2. `resolveAssignees` (falling back
   * to `resolveHandoffTargets`): exactly one → `assignedTo`; 3. `rulesHooks.onEnterHuman` when
   * the status changed; 4. the handoff message as sender "system" (send failures are logged);
   * 5. `handoff` event. A pending draft is flagged `metadata.handoffAfterDraft`.
   */
  handoff(id: string, opts: HandoffOptions): Promise<HandoffResult>;
  /** Status `agent`, clears `assignedTo` and `handoffReason`. */
  returnToAgent(id: string, opts?: ByOption): Promise<Conversation>;
  close(id: string, opts?: ByOption): Promise<Conversation>;
  /**
   * Sets `assignedTo` (emits `conversation.assigned`); assigning a user also moves the
   * conversation to `human` (calling `rulesHooks.onEnterHuman`). `null` unassigns.
   */
  assign(id: string, userId: string | null, opts?: ByOption): Promise<Conversation>;
  /**
   * Pauses or resumes the agent on one conversation. On a change: a system line (a resume line
   * carries `metadata.agentResumeFrom`, the newest inbound message id, so the agent does not
   * answer what arrived during the pause) and `conversation.agent_paused`.
   */
  pauseAgent(id: string, paused: boolean, opts?: ByOption): Promise<Conversation>;
  windowStatus(id: string): Promise<WindowStatus>;
}

const SYSTEM = "system";
/** Messages scanned for pending drafts and the newest inbound message. */
const RECENT_MESSAGES = 50;

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

  /** Writes the patch; a changed `assignedTo` emits `conversation.assigned`. */
  async function update(
    current: Conversation,
    patch: ConversationPatch,
    by: string,
  ): Promise<Conversation> {
    const updated = await adapter.conversations.update(current.id, withBookkeeping(current, patch));
    if (updated.assignedTo !== current.assignedTo) {
      await emitter.emit("conversation.assigned", {
        conversation: updated,
        from: current.assignedTo,
        to: updated.assignedTo,
        by,
      });
    }
    return updated;
  }

  async function changeStatus(
    conversation: Conversation,
    to: ConversationStatus,
    patch: ConversationPatch,
    by: string,
  ): Promise<Conversation> {
    const updated = await update(conversation, { ...patch, status: to }, by);
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

  async function userName(id: string): Promise<string> {
    const resolveUsers = ctx.team.resolveUsers;
    if (resolveUsers === null) return id;
    try {
      const found = (await resolveUsers([id])).find((user) => user.id === id);
      return found?.name.trim() ? found.name : id;
    } catch (error) {
      ctx.logger.warn("[sendo] resolveUsers failed", error);
      return id;
    }
  }

  /** The subject of a system line sentence; a user actor's name is also kept as `byName`. */
  async function actor(by: string): Promise<{ subject: string; params: SystemLineParams }> {
    if (by === SYSTEM) return { subject: "Sendo", params: {} };
    if (by === "business_app") return { subject: "The WhatsApp Business app", params: {} };
    if (by.startsWith("agent:")) {
      return { subject: `The agent ${by.slice("agent:".length)}`, params: {} };
    }
    if (by.startsWith("rule:"))
      return { subject: `Rule «${by.slice("rule:".length)}»`, params: {} };
    const name = await userName(by);
    return { subject: name, params: { byName: name } };
  }

  async function insertLine(
    conversation: Conversation,
    by: string,
    event: SystemEventName,
    params: SystemLineParams,
  ): Promise<void> {
    const { subject, params: actorParams } = await actor(by);
    await ctx.services.messages.insertSystemLine(conversation, {
      by,
      event,
      subject,
      params: { ...actorParams, ...params },
    });
  }

  /** Inserts a system line unless a rule made the change (the rules engine writes its own). */
  async function systemLine(
    conversation: Conversation,
    by: string,
    event: SystemEventName,
    params: () => Promise<SystemLineParams> | SystemLineParams = () => ({}),
  ): Promise<void> {
    if (by.startsWith("rule:")) return;
    try {
      await insertLine(conversation, by, event, await params());
    } catch (error) {
      ctx.logger.warn(`[sendo] could not store the "${event}" system line`, error);
    }
  }

  async function assignmentLine(
    conversation: Conversation,
    userId: string | null,
    by: string,
  ): Promise<void> {
    if (userId === null) {
      await systemLine(conversation, by, SYSTEM_LINE_EVENTS.unassigned);
      return;
    }
    await systemLine(conversation, by, SYSTEM_LINE_EVENTS.assigned, async () => ({
      assignedTo: userId,
      assignedToName: await userName(userId),
    }));
  }

  async function recentMessages(conversationId: string) {
    return adapter.messages.history(conversationId, RECENT_MESSAGES);
  }

  /** The draft stays for review; the inbox labels it "propuesto antes del traspaso". */
  async function flagDraftsBeforeHandoff(conversationId: string): Promise<void> {
    try {
      for (const message of await recentMessages(conversationId)) {
        if (message.draft) {
          await adapter.messages.updateMetadata(message.id, { handoffAfterDraft: true });
        }
      }
    } catch (error) {
      ctx.logger.warn("[sendo] could not flag the pending draft", error);
    }
  }

  /** Bookkeeping for a transition into `human`: draft label, then the rules hook. */
  async function enteredHuman(
    conversation: Conversation,
    account: Account | null,
    by: string,
  ): Promise<Conversation> {
    await flagDraftsBeforeHandoff(conversation.id);
    try {
      const owner = account ?? (await participants(conversation)).account;
      return await ctx.rulesHooks.onEnterHuman({ account: owner, conversation, by });
    } catch (error) {
      ctx.logger.error(`[sendo] rules onEnterHuman failed for ${conversation.id}`, error);
      return conversation;
    }
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
      try {
        assignees = [
          ...(await resolveAssigneeIds(ctx.team, ctx.config.resolveHandoffTargets, {
            tenantId: conversation.tenantId,
            queue: opts.to ?? conversation.queue,
            account,
            conversation,
            contact,
          })),
        ];
      } catch (error) {
        ctx.logger.error("[sendo] resolving the handoff assignees failed", error);
      }
      const [only] = assignees;
      const assignOnly = assignees.length === 1 && only !== undefined;
      if (assignOnly) conversation = await update(conversation, { assignedTo: only }, by);

      await systemLine(conversation, by, SYSTEM_LINE_EVENTS.handoff, async () => ({
        reason: opts.reason,
        ...(assignOnly && { assignedTo: only, assignedToName: await userName(only) }),
      }));
      if (current.status !== "human") conversation = await enteredHuman(conversation, account, by);

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
      const by = opts.by ?? SYSTEM;
      const current = await requireConversation(id);
      const conversation = await changeStatus(
        current,
        "agent",
        { assignedTo: null, handoffReason: null },
        by,
      );
      if (current.status !== "agent") {
        await systemLine(conversation, by, SYSTEM_LINE_EVENTS.returned);
      }
      return conversation;
    },

    async close(id, opts = {}) {
      const by = opts.by ?? SYSTEM;
      const current = await requireConversation(id);
      const conversation = await changeStatus(current, "closed", {}, by);
      if (current.status !== "closed") {
        await systemLine(conversation, by, SYSTEM_LINE_EVENTS.closed);
      }
      return conversation;
    },

    async assign(id, userId, opts = {}) {
      const by = opts.by ?? SYSTEM;
      const current = await requireConversation(id);
      if (userId === null) {
        const conversation = await update(current, { assignedTo: null }, by);
        if (current.assignedTo !== null) await assignmentLine(conversation, null, by);
        return conversation;
      }
      let conversation = await changeStatus(current, "human", { assignedTo: userId }, by);
      if (current.assignedTo !== userId) await assignmentLine(conversation, userId, by);
      if (current.status !== "human") conversation = await enteredHuman(conversation, null, by);
      return conversation;
    },

    async pauseAgent(id, paused, opts = {}) {
      const by = opts.by ?? SYSTEM;
      const current = await requireConversation(id);
      if (current.agentPaused === paused) return current;
      const conversation = await adapter.conversations.update(id, { agentPaused: paused });
      if (paused) {
        await systemLine(conversation, by, SYSTEM_LINE_EVENTS.agentPaused);
      } else {
        const latestInbound = (await recentMessages(id)).findLast((m) => m.direction === "in");
        // Written even for rule changes: the runtime reads the resume line as its start marker.
        await insertLine(conversation, by, SYSTEM_LINE_EVENTS.agentResumed, {
          agentResumeFrom: latestInbound?.id ?? null,
        });
      }
      await emitter.emit("conversation.agent_paused", { conversation, paused, by });
      return conversation;
    },

    async windowStatus(id) {
      const conversation = await requireConversation(id);
      return windowStatus(conversation.lastInboundAt);
    },
  };
}
