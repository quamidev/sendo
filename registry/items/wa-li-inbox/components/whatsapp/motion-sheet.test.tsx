// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mockMediaQueries } from "../../../../test/inbox-factories";
import { MotionSheet } from "./motion-sheet";
import { defaultInboxStrings } from "./strings";

beforeAll(() => {
  mockMediaQueries({
    "(prefers-reduced-motion)": false,
    "(prefers-reduced-motion: reduce)": false,
  });
});

describe("<MotionSheet>", () => {
  it("opens as a draggable spring sheet and closes from its close button", () => {
    const onOpenChange = vi.fn();
    render(
      <MotionSheet open onOpenChange={onOpenChange} title="Elige una plantilla">
        <p>Contenido</p>
      </MotionSheet>,
    );
    const sheet = screen.getByRole("dialog", { name: "Elige una plantilla" });
    expect(sheet).toHaveAttribute("data-motion", "spring");
    expect(sheet.querySelector("[data-slot='sheet-handle']")).not.toBeNull();
    expect(screen.getByText("Contenido")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: defaultInboxStrings.sheetClose }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing while closed", () => {
    render(
      <MotionSheet open={false} onOpenChange={vi.fn()} title="Vista previa">
        <p>Contenido</p>
      </MotionSheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
