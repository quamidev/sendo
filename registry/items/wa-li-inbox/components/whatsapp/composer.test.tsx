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

function closedWindow() {
  return { open: false, expiresAt: new Date(Date.now() - HOUR).toISOString() };
}

beforeEach(() => {
  mockViewport(true);
});

describe("<Composer>", () => {
  it("shows only the template picker when the window is closed", async () => {
    const listTemplates = vi.fn(() => Promise.resolve(ok([makeTemplate()])));
    const { container } = render(
      <Composer window={closedWindow()} onSend={vi.fn()} listTemplates={listTemplates} />,
    );
    // Closed from the start: no swap fade.
    expect(container.querySelector("[data-slot='composer']")).not.toHaveClass("starting:opacity-0");

    expect(screen.queryByRole("textbox", { name: defaultInboxStrings.composerLabel })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultInboxStrings.attach })).toBeNull();
    expect(screen.getByText(defaultInboxStrings.templateExplanation)).toBeInTheDocument();
    expect(
      await screen.findByRole("combobox", { name: defaultInboxStrings.templateLabel }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: defaultInboxStrings.templateSend })).toBeDisabled();
    expect(listTemplates).toHaveBeenCalledTimes(1);
  });

  it("offers text and attachments while the window is open", () => {
    render(<Composer window={openWindow()} onSend={vi.fn()} listTemplates={vi.fn()} />);
    expect(
      screen.getByRole("textbox", { name: defaultInboxStrings.composerLabel }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: defaultInboxStrings.attach })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

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
