import { pauseBroadcastForBilling } from "../../broadcasts/sending";
import { recipientStatusAfter } from "../../broadcasts/status";
import { markBillingNotReady } from "../accounts/billing";
import { META_BILLING_ERROR_CODE } from "../../errors/meta-api-error";
import type { Message } from "../../types/entities";
import type { SendoContext } from "../context";

/**
 * AC-BC-3: moves a broadcast recipient forward with its message's status (status webhooks).
 * Only messages sent by a broadcast (`metadata.broadcastId`) are looked up. A `failed` status
 * with Meta 131042 pauses the broadcast (`pause_reason = "billing"`) and marks the number
 * `billingReady = false`.
 */
export async function syncBroadcastRecipient(ctx: SendoContext, message: Message): Promise<void> {
  const broadcastId = message.metadata.broadcastId;
  if (message.direction !== "out" || typeof broadcastId !== "string") return;
  const { adapter } = ctx;
  const recipient = await adapter.broadcasts.recipientByMessageId(message.id);
  if (recipient === null) return;
  const status = recipientStatusAfter(recipient.status, message.status);
  if (status === recipient.status) return;
  await adapter.broadcasts.updateRecipient(recipient.id, {
    status,
    ...(status === "failed" && message.error !== null && { error: message.error }),
  });
  if (status === "failed" && message.error?.code === META_BILLING_ERROR_CODE) {
    await pauseBroadcastForBilling(ctx, recipient.broadcastId);
    const broadcast = await adapter.broadcasts.get(recipient.broadcastId);
    const account = broadcast === null ? null : await adapter.accounts.getById(broadcast.accountId);
    if (account !== null) await markBillingNotReady(ctx, account);
  }
}
