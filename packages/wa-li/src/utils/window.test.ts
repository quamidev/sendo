import { describe, expect, it } from "vitest";
import { WINDOW_DURATION_MS, windowExpiresAt, windowStatus } from "./window";

const lastInbound = new Date("2026-10-06T12:00:00.000Z");
const at = (offsetMs: number) => new Date(lastInbound.getTime() + offsetMs);

describe("windowStatus", () => {
  it("is still open at exactly 24 h", () => {
    expect(windowStatus(lastInbound, at(WINDOW_DURATION_MS)).open).toBe(true);
  });

  it("is closed at 24 h + 1 ms", () => {
    const status = windowStatus(lastInbound, at(WINDOW_DURATION_MS + 1));
    expect(status.open).toBe(false);
    expect(status.expiresAt).toEqual(windowExpiresAt(lastInbound));
  });
});
