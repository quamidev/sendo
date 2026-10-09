import type { MessageStatus } from "../types/enums";

const STATUS_RANK: Readonly<Record<MessageStatus, number>> = {
  received: 0,
  pending: 0,
  sent: 1,
  failed: 2,
  delivered: 2,
  read: 3,
};

/**
 * Ordering used for forward-only updates: `pending 0 < sent 1 < delivered 2 < read 3`.
 * `failed` ranks 2 (beats `pending` and `sent`, not `delivered`/`read`).
 * `received` (inbound only) ranks 0. Use `canTransition` to decide updates.
 */
export function statusRank(status: MessageStatus): number {
  return STATUS_RANK[status];
}

/**
 * Whether a message in status `from` may move to `to`:
 * - only forward (`pending → sent → delivered → read`), never to the same status or back;
 * - `failed` wins over `pending` and `sent` but not over `delivered` or `read`;
 * - `failed` and `read` are terminal;
 * - `received` is the fixed status of inbound messages: nothing moves to or from it.
 */
export function canTransition(from: MessageStatus, to: MessageStatus): boolean {
  if (from === "received" || to === "received") return false;
  if (from === "failed" || to === "pending") return false;
  return statusRank(to) > statusRank(from);
}

/** The status that results from applying `incoming` to `current` under the forward-only rule. */
export function nextStatus(current: MessageStatus, incoming: MessageStatus): MessageStatus {
  return canTransition(current, incoming) ? incoming : current;
}
