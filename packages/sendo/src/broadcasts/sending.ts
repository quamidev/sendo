import type { SendoContext } from "../core/context";
import { composeOutbound, type SendTarget } from "../core/outbound";
import { MetaApiError } from "../errors/meta-api-error";
import type { TickStep } from "../rules/tick";
import type {
  Account,
  Broadcast,
  BroadcastRecipient,
  MessageError,
  TenantId,
} from "../types/entities";
import type { BroadcastStatus } from "../types/enums";
import { redactText } from "../utils/redact";
import { skipReasonFor, storedVariables } from "./eligibility";
import { recipientStatusAfter } from "./status";

/** `pause_reason` of a broadcast stopped by Meta error 131042 (no payment method). */
export const BILLING_PAUSE_REASON = "billing";

/** Broadcasts the tick looks at: waiting to start, sending, or paused (billing may resume). */
const TICK_STATUSES: BroadcastStatus[] = ["queued", "sending", "paused"];
const LIST_PAGE = 50;

const INTERRUPTED_ERROR: MessageError = {
  message:
    "The send was interrupted before it was confirmed; it is not retried, to avoid duplicates.",
};

type RecipientOutcome = "sent" | "skipped" | "failed" | "billing" | "stop" | "error";

function errorOf(ctx: SendoContext, error: unknown): MessageError {
  const message = error instanceof Error ? error.message : String(error);
  return { message: redactText(message, ctx.secrets()) };
}

/**
 * Pauses a queued or sending broadcast with `pause_reason = "billing"` (131042 on a send or a
 * status webhook). The tick resumes it once the account's `billingReady` is true again.
 */
export async function pauseBroadcastForBilling(
  ctx: SendoContext,
  broadcastId: string,
): Promise<void> {
  const broadcast = await ctx.adapter.broadcasts.get(broadcastId);
  if (broadcast === null || (broadcast.status !== "queued" && broadcast.status !== "sending")) {
    return;
  }
  await ctx.adapter.broadcasts.update(broadcastId, {
    status: "paused",
    pauseReason: BILLING_PAUSE_REASON,
  });
  ctx.logger.warn(
    `[sendo] broadcast ${broadcastId} paused: the number has no payment method (Meta 131042)`,
  );
}

/** Puts a recipient back in the queue (its failed message row stays in the thread). */
async function requeue(ctx: SendoContext, recipient: BroadcastRecipient): Promise<void> {
  await ctx.adapter.broadcasts.updateRecipient(recipient.id, {
    status: "pending",
    messageId: null,
  });
}

/**
 * A recipient that already has a message (an earlier pass stopped between storing and
 * confirming): adopt the message's status, never send twice.
 */
async function recover(
  ctx: SendoContext,
  recipient: BroadcastRecipient,
): Promise<RecipientOutcome> {
  const { adapter } = ctx;
  const message =
    recipient.messageId === null ? null : await adapter.messages.get(recipient.messageId);
  const status = message === null ? "pending" : recipientStatusAfter("pending", message.status);
  if (message !== null && status !== "pending") {
    await adapter.broadcasts.updateRecipient(recipient.id, {
      status,
      ...(status === "failed" && { error: message.error ?? INTERRUPTED_ERROR }),
    });
    return status === "failed" ? "failed" : "sent";
  }
  await adapter.broadcasts.updateRecipient(recipient.id, {
    status: "failed",
    error: INTERRUPTED_ERROR,
  });
  return "failed";
}

async function sendToRecipient(
  ctx: SendoContext,
  broadcast: Broadcast,
  account: Account,
  recipient: BroadcastRecipient,
): Promise<RecipientOutcome> {
  const { adapter, services } = ctx;
  if (recipient.messageId !== null) return recover(ctx, recipient);

  const contact = await adapter.contacts.get(recipient.contactId);
  const skip = contact === null ? "invalid_phone" : skipReasonFor(broadcast.category, contact);
  if (contact === null || skip !== null) {
    await adapter.broadcasts.updateRecipient(recipient.id, {
      status: "skipped",
      skipReason: skip ?? "invalid_phone",
    });
    return "skipped";
  }

  const { conversation } = await services.conversations.ensure({ account, contact });
  const target: SendTarget = { account, contact, conversation, sender: "system", senderRef: null };
  let composed;
  try {
    composed = await composeOutbound(ctx, target, {
      kind: "template",
      name: broadcast.templateName,
      language: broadcast.language,
      variables: storedVariables(recipient.variables ?? broadcast.variables),
    });
  } catch (error) {
    await adapter.broadcasts.updateRecipient(recipient.id, {
      status: "failed",
      error: errorOf(ctx, error),
    });
    return "failed";
  }

  const pending = await adapter.messages.insertOutbound({
    tenantId: conversation.tenantId,
    conversationId: conversation.id,
    type: composed.type,
    content: composed.content,
    text: composed.text,
    sender: "system",
    senderRef: null,
    metadata: { broadcastId: broadcast.id, broadcastRecipientId: recipient.id },
  });
  // Linked before the send so a fast status webhook finds the recipient.
  await adapter.broadcasts.updateRecipient(recipient.id, { messageId: pending.id });

  let sent;
  try {
    sent = await services.messages.sendStored(pending, {
      account,
      contact,
      conversation,
      sender: "system",
      senderRef: null,
      skipWindowCheck: true,
      ...composed,
    });
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (error.hint === "billing_not_ready") {
        await requeue(ctx, recipient);
        return "billing";
      }
      if (error.hint === "rate_limited" || error.hint === "token_invalid") {
        await requeue(ctx, recipient);
        return "stop";
      }
      const failed = await adapter.messages.get(pending.id);
      await adapter.broadcasts.updateRecipient(recipient.id, {
        status: "failed",
        error: failed?.error ?? errorOf(ctx, error),
      });
      return "failed";
    }
    ctx.logger.error(`[sendo] broadcast ${broadcast.id} send to ${recipient.id} failed`, error);
    await requeue(ctx, recipient);
    return "error";
  }

  // A status webhook may already have moved the recipient (or a cancel raced the send).
  const current = (await adapter.broadcasts.recipientByMessageId(pending.id)) ?? recipient;
  const status = recipientStatusAfter(current.status, sent.status);
  if (status !== current.status) {
    await adapter.broadcasts.updateRecipient(recipient.id, {
      status,
      ...(status === "failed" && sent.error !== null && { error: sent.error }),
    });
  }
  return "sent";
}

interface PassResult {
  sent: number;
  errors: number;
}

/** One tick pass over one broadcast: start/resume it, send up to `ratePerMinute`, finish it. */
async function runBroadcast(
  ctx: SendoContext,
  initial: Broadcast,
  account: Account,
  now: Date,
  remainingMs: () => number,
): Promise<PassResult> {
  const { adapter, logger } = ctx;
  const result: PassResult = { sent: 0, errors: 0 };
  let broadcast = initial;

  if (broadcast.status === "paused") {
    if (broadcast.pauseReason !== BILLING_PAUSE_REASON || account.billingReady !== true) {
      return result;
    }
    broadcast = await adapter.broadcasts.update(broadcast.id, {
      status: "sending",
      pauseReason: null,
    });
  }

  const template = await adapter.templates.get(
    account.id,
    broadcast.templateName,
    broadcast.language,
  );
  if (template?.active !== true || template.status !== "APPROVED") {
    logger.warn(
      `[sendo] broadcast ${broadcast.id} failed: template ${broadcast.templateName} (${broadcast.language}) is no longer approved`,
    );
    await adapter.broadcasts.cancelPending(broadcast.id);
    await adapter.broadcasts.update(broadcast.id, { status: "failed", finishedAt: now });
    return result;
  }

  if (broadcast.status === "queued") {
    broadcast = await adapter.broadcasts.update(broadcast.id, {
      status: "sending",
      startedAt: now,
    });
  }

  const batch = await adapter.broadcasts.nextPending(broadcast.id, broadcast.ratePerMinute);
  for (const recipient of batch) {
    if (remainingMs() <= 0) return result;
    // A cancel (or a billing pause from a status webhook) stops the pass between sends.
    const latest = await adapter.broadcasts.get(broadcast.id);
    if (latest?.status !== "sending") return result;
    const outcome = await sendToRecipient(ctx, broadcast, account, recipient);
    if (outcome === "sent") result.sent++;
    if (outcome === "billing") {
      await pauseBroadcastForBilling(ctx, broadcast.id);
      return result;
    }
    if (outcome === "error") result.errors++;
    if (outcome === "stop" || outcome === "error") return result;
  }

  const latest = await adapter.broadcasts.get(broadcast.id);
  if (
    latest?.status === "sending" &&
    (await adapter.broadcasts.counts(broadcast.id)).pending === 0
  ) {
    await adapter.broadcasts.update(broadcast.id, { status: "done", finishedAt: new Date() });
  }
  return result;
}

async function activeBroadcasts(ctx: SendoContext, tenantId: TenantId): Promise<Broadcast[]> {
  const out: Broadcast[] = [];
  let cursor: string | null = null;
  do {
    const page = await ctx.adapter.broadcasts.list({
      tenantId,
      status: TICK_STATUSES,
      cursor,
      limit: LIST_PAGE,
    });
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  // Oldest first: earlier broadcasts finish before later ones start.
  return out.reverse();
}

/**
 * Step 4 of `sendo.maintenance.tick` (AC-BC-3): for every queued, sending or billing-paused
 * broadcast of a connected number, sends up to `ratePerMinute` pending recipients. 131042
 * pauses the broadcast; a rate limit (130429 and the other `rate_limited` codes) or an invalid
 * token stops that broadcast's pass with the recipient left `pending`. `count` = messages sent.
 */
export const broadcastsTickStep: TickStep = async (input) => {
  const { ctx, now } = input;
  const remainingMs = () => input.remainingMs();
  const { adapter, logger } = ctx;
  let count = 0;
  let errors = 0;
  const accounts = new Map((await adapter.accounts.list({ active: true })).map((a) => [a.id, a]));
  const tenants = new Set([...accounts.values()].map((a) => a.tenantId));
  for (const tenantId of tenants) {
    for (const broadcast of await activeBroadcasts(ctx, tenantId)) {
      if (remainingMs() <= 0) return { count, errors };
      const account = accounts.get(broadcast.accountId);
      if (account === undefined) continue;
      try {
        const pass = await runBroadcast(ctx, broadcast, account, now, remainingMs);
        count += pass.sent;
        errors += pass.errors;
      } catch (error) {
        errors++;
        logger.error(`[sendo] broadcast ${broadcast.id} pass failed`, error);
      }
    }
  }
  return { count, errors };
};
