// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTemplate, mockViewport, ok } from "../../../../test/inbox-factories";
import { Composer } from "./composer";
import { defaultInboxStrings } from "./strings";

const HOUR = 60 * 60_000;

function openWindow() {
  return { open: true, expiresAt: new Date(Date.now() + 5 * HOUR).toISOString() };
}

beforeEach(() => {
  mockViewport(true);
});

describe("<Composer>", () => {
  it("switches to the template picker when a send fails with WINDOW_CLOSED", async () => {
    const onSend = vi.fn(() => Promise.resolve("window_closed" as const));
    const listTemplates = vi.fn(() => Promise.resolve(ok([makeTemplate()])));
    render(<Composer window={openWindow()} onSend={onSend} listTemplates={listTemplates} />);

    const textbox = screen.getByRole("textbox", { name: defaultInboxStrings.composerLabel });
    fireEvent.change(textbox, { target: { value: "Hola" } });
    fireEvent.keyDown(textbox, { key: "Enter" });

    const explanation = await screen.findByRole("status");
    expect(explanation).toHaveTextContent(defaultInboxStrings.templateExplanation);
    // Swapped while on screen: the template picker fades in place (opacity only).
    expect(explanation.closest("[data-slot='composer']")).toHaveClass("starting:opacity-0");
    expect(screen.queryByRole("textbox", { name: defaultInboxStrings.composerLabel })).toBeNull();
    expect(onSend).toHaveBeenCalledWith({ kind: "text", body: "Hola" });
  });

  it("inserts a newline on Shift+Enter instead of sending", () => {
    const onSend = vi.fn(() => Promise.resolve("sent" as const));
    render(<Composer window={openWindow()} onSend={onSend} listTemplates={vi.fn()} />);
    const textbox = screen.getByRole("textbox", { name: defaultInboxStrings.composerLabel });
    fireEvent.change(textbox, { target: { value: "Hola" } });
    fireEvent.keyDown(textbox, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });
});
