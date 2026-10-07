import type { WindowStatus } from "../types/entities";

export const WINDOW_DURATION_MS = 24 * 60 * 60 * 1000;

/** When the customer service window opened by an inbound message at `lastInboundAt` closes. */
export function windowExpiresAt(lastInboundAt: Date): Date {
  return new Date(lastInboundAt.getTime() + WINDOW_DURATION_MS);
}

/**
 * The 24-hour customer service window. Open while `now <= lastInboundAt + 24h`
 * (inclusive at exactly 24 h, closed 1 ms later). Closed when the contact never wrote.
 */
export function windowStatus(lastInboundAt: Date | null, now: Date = new Date()): WindowStatus {
  if (lastInboundAt === null) return { open: false, expiresAt: null };
  const expiresAt = windowExpiresAt(lastInboundAt);
  return { open: now.getTime() <= expiresAt.getTime(), expiresAt };
}
