import { describe, expect, it } from "vitest";
import { MESSAGE_STATUSES, type MessageStatus } from "../types/enums";
import { canTransition } from "./status";

const ALLOWED: readonly (readonly [MessageStatus, MessageStatus])[] = [
  ["pending", "sent"],
  ["pending", "delivered"],
  ["pending", "read"],
  ["pending", "failed"],
  ["sent", "delivered"],
  ["sent", "read"],
  ["sent", "failed"],
  ["delivered", "read"],
];

const allPairs = MESSAGE_STATUSES.flatMap((from) =>
  MESSAGE_STATUSES.map((to) => [from, to] as const),
);

describe("canTransition", () => {
  it.each(allPairs)("%s -> %s", (from, to) => {
    const expected = ALLOWED.some(([f, t]) => f === from && t === to);
    expect(canTransition(from, to)).toBe(expected);
  });
});
