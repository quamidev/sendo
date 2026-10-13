import type { BroadcastRecipientStatus, MessageStatus } from "../types/enums";
import { canTransition } from "../utils/status";

/**
 * A recipient's status once its message is in `message` status, forward-only like messages
 * (`pending → sent → delivered → read`; `failed` beats `pending`/`sent`; `read`/`failed` are
 * terminal). `skipped` never moves. `cancelled` moves only when its message really went out
 * (a cancel that raced a send).
 */
export function recipientStatusAfter(
  current: BroadcastRecipientStatus,
  message: MessageStatus,
): BroadcastRecipientStatus {
  if (current === "skipped") return current;
  const from: MessageStatus = current === "cancelled" ? "pending" : current;
  return canTransition(from, message) ? (message as BroadcastRecipientStatus) : current;
}
