import { describe, expect, it } from "vitest";
import { MESSAGE_STATUSES, type MessageStatus } from "../types/enums";
import { canTransition, nextStatus, statusRank } from "./status";

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

  it("rejects a late delivered after read", () => {
    expect(canTransition("read", "delivered")).toBe(false);
  });

  it("lets failed beat pending and sent but not delivered or read", () => {
    expect(canTransition("pending", "failed")).toBe(true);
    expect(canTransition("sent", "failed")).toBe(true);
    expect(canTransition("delivered", "failed")).toBe(false);
    expect(canTransition("read", "failed")).toBe(false);
  });

  it("never moves inbound (received) messages", () => {
    for (const status of MESSAGE_STATUSES) {
      expect(canTransition("received", status)).toBe(false);
      expect(canTransition(status, "received")).toBe(false);
    }
  });
});

describe("statusRank", () => {
  it("orders the outbound lifecycle", () => {
    expect(statusRank("pending")).toBeLessThan(statusRank("sent"));
    expect(statusRank("sent")).toBeLessThan(statusRank("delivered"));
    expect(statusRank("delivered")).toBeLessThan(statusRank("read"));
    expect(statusRank("failed")).toBeGreaterThan(statusRank("sent"));
    expect(statusRank("failed")).toBeLessThan(statusRank("read"));
  });
});

describe("nextStatus", () => {
  it("applies out-of-order updates forward-only", () => {
    const applied = (["sent", "read", "delivered", "failed"] as const).reduce<MessageStatus>(
      nextStatus,
      "pending",
    );
    expect(applied).toBe("read");
  });
});
