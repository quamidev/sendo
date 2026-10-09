// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mockMediaQueries } from "../../../../test/inbox-factories";
import { MotionSheet } from "./motion-sheet";

// Separate file: motion caches the reduced-motion preference for the module's lifetime.
beforeAll(() => {
  mockMediaQueries({ "(prefers-reduced-motion)": true, "(prefers-reduced-motion: reduce)": true });
});

describe("<MotionSheet> with prefers-reduced-motion", () => {
  it("only fades: no spring, no drag handle", () => {
    render(
      <MotionSheet open onOpenChange={vi.fn()} title="Vista previa" dragBody>
        <p>Imagen</p>
      </MotionSheet>,
    );
    const sheet = screen.getByRole("dialog", { name: "Vista previa" });
    expect(sheet).toHaveAttribute("data-motion", "fade");
    expect(sheet.querySelector("[data-slot='sheet-handle']")).toBeNull();
    expect(sheet.style.transform === "" || sheet.style.transform === "none").toBe(true);
  });
});
