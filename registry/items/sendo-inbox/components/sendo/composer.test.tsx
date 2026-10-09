// @vitest-environment jsdom
/**
 * `<Composer>` in isolation (registry RTL): the composer rules live only in the copied UI, the
 * package E2E suite can't see them. One test per way it could fail:
 *
 * 1. A send that fails with WINDOW_CLOSED leaves the text box instead of the template-only bar.
 * 2. Shift+Enter sends instead of inserting a newline.
 * 3. Flow D 8: a closed window still offers free text (it must be the "Ventana de 24 h cerrada"
 *    bar with the template picker), or the note mode disappears with it.
 * 4. AC-IB-3 / Flow D 6: "Nota interna" sends through `reply` (to the contact) instead of `note`.
 * 5. AC-SN-2: `/` doesn't open the picker; arrows don't move the active option (or don't wrap);
 *    the search isn't accent-insensitive; Escape doesn't close it; Enter sends "/…" instead of
 *    inserting; Tab moves focus away instead of inserting.
 * 6. AC-SN-3: an inserted snippet with unresolved variables can be sent (button or Enter), the
 *    warning doesn't name them, or sending stays blocked after they are filled in.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTemplate, mockViewport, ok } from "../../../../test/inbox-factories";
import { Composer, type ComposerProps } from "./composer";
import { defaultInboxStrings as s } from "./strings";
import type { InboxSnippetView } from "./types";

const HOUR = 60 * 60_000;

function openWindow() {
  return { open: true, expiresAt: new Date(Date.now() + 5 * HOUR).toISOString() };
}

function closedWindow() {
  return { open: false, expiresAt: new Date(Date.now() - HOUR).toISOString() };
}

function snippet(overrides: Partial<InboxSnippetView>): InboxSnippetView {
  return {
    id: "snip-1",
    shortcut: "saludo",
    body: "Hola {{nombre}}",
    visibility: "tenant",
    accountId: null,
    own: false,
    ...overrides,
  };
}

const SNIPPETS = [
  snippet({ id: "s-saldo", shortcut: "saldo", body: "Hola {{nombre}}, tu saldo es {{saldo}}." }),
  snippet({
    id: "s-horario",
    shortcut: "horario",
    body: "Atendemos de lunes a viernes, días hábiles.",
  }),
  snippet({ id: "s-gracias", shortcut: "gracias", body: "¡Con gusto!", visibility: "personal" }),
];

function renderComposer(props: Partial<ComposerProps> = {}) {
  const onSend = vi.fn<ComposerProps["onSend"]>(() => Promise.resolve("sent"));
  const onNote = vi.fn<NonNullable<ComposerProps["onNote"]>>(() => Promise.resolve("sent"));
  const listSnippets = vi.fn(() => Promise.resolve(ok(SNIPPETS)));
  const renderSnippet = vi.fn((id: string) =>
    Promise.resolve(
      ok(
        id === "s-saldo"
          ? { text: "Hola María, tu saldo es {{saldo}}.", unresolved: ["saldo"] }
          : { text: SNIPPETS.find((item) => item.id === id)?.body ?? "", unresolved: [] },
      ),
    ),
  );
  render(
    <Composer
      window={openWindow()}
      onSend={onSend}
      onNote={onNote}
      listTemplates={vi.fn(() => Promise.resolve(ok([makeTemplate()])))}
      listSnippets={listSnippets}
      renderSnippet={renderSnippet}
      status="agent"
      {...props}
    />,
  );
  return { onSend, onNote, listSnippets, renderSnippet };
}

function textbox() {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: s.composerLabel });
}

function type(value: string) {
  fireEvent.change(textbox(), { target: { value } });
}

function picker() {
  return screen.getByRole("listbox", { name: s.snippetPickerTitle, hidden: true });
}

function pickerOpen(): boolean {
  return picker().closest("[data-slot='snippet-picker']")?.getAttribute("data-state") === "open";
}

function activeOption() {
  return within(picker()).getByRole("option", { selected: true, hidden: true });
}

beforeEach(() => {
  mockViewport(true);
});

describe("<Composer>", () => {
  it("switches to the template-only bar when a send fails with WINDOW_CLOSED", async () => {
    const onSend = vi.fn(() => Promise.resolve("window_closed" as const));
    renderComposer({ onSend });
    type("Hola");
    fireEvent.keyDown(textbox(), { key: "Enter" });

    const bar = await screen.findByRole("status");
    expect(bar).toHaveTextContent(s.windowClosedBarTitle);
    // Swapped while on screen: the bar fades in place (opacity only).
    expect(bar.parentElement).toHaveClass("starting:opacity-0");
    expect(screen.queryByRole("textbox", { name: s.composerLabel })).toBeNull();
    // The operator was writing: the picker opens right away.
    expect(await screen.findByRole("form", { name: s.templateChoose })).toBeInTheDocument();
    expect(onSend).toHaveBeenCalledWith({ kind: "text", body: "Hola" });
  });

  it("inserts a newline on Shift+Enter instead of sending", () => {
    const { onSend } = renderComposer();
    type("Hola");
    fireEvent.keyDown(textbox(), { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("offers only templates while the window is closed, and notes still work", async () => {
    const { onSend, onNote } = renderComposer({ window: closedWindow() });

    expect(screen.getByText(s.windowClosedBarTitle)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: s.composerLabel })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: s.composerTemplateButton }));
    expect(await screen.findByRole("form", { name: s.templateChoose })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: s.composerModeNote }));
    expect(screen.queryByText(s.windowClosedBarTitle)).toBeNull();
    type("Llamé por teléfono");
    fireEvent.keyDown(textbox(), { key: "Enter" });
    await waitFor(() => {
      expect(onNote).toHaveBeenCalledWith("Llamé por teléfono");
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("saves a note through note, never reply", async () => {
    const { onSend, onNote } = renderComposer();
    expect(screen.getByText(s.composerHintStepIn)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: s.composerModeNote }));
    expect(screen.getByRole("radio", { name: s.composerModeNote })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText(s.composerHintNote)).toBeInTheDocument();
    expect(textbox()).toHaveAttribute("placeholder", s.composerPlaceholderNote);
    // Notes are text only: no attachment, no snippets.
    expect(screen.queryByRole("button", { name: s.attach })).toBeNull();

    type("El residente pidió que lo llamen después de las 5.");
    fireEvent.click(screen.getByRole("button", { name: s.send }));
    await waitFor(() => {
      expect(onNote).toHaveBeenCalledWith("El residente pidió que lo llamen después de las 5.");
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(textbox()).toHaveValue("");
  });

  it("navigates the snippet picker with the keyboard and inserts with Enter or Tab", async () => {
    const { onSend, renderSnippet, listSnippets } = renderComposer();

    type("/");
    await waitFor(() => {
      expect(within(picker()).getAllByRole("option", { hidden: true })).toHaveLength(3);
    });
    expect(pickerOpen()).toBe(true);
    expect(listSnippets).toHaveBeenCalledTimes(1);
    expect(textbox()).toHaveAttribute("aria-activedescendant", activeOption().id);
    expect(activeOption()).toHaveTextContent("/saldo");
    expect(within(picker()).getByText(s.snippetScopePersonal)).toBeInTheDocument();

    fireEvent.keyDown(textbox(), { key: "ArrowDown" });
    expect(activeOption()).toHaveTextContent("/horario");
    fireEvent.keyDown(textbox(), { key: "ArrowUp" });
    fireEvent.keyDown(textbox(), { key: "ArrowUp" });
    expect(activeOption()).toHaveTextContent("/gracias");

    // Accent-insensitive search on the body ("días").
    type("/dias");
    expect(within(picker()).getAllByRole("option", { hidden: true })).toHaveLength(1);
    expect(activeOption()).toHaveTextContent("/horario");

    fireEvent.keyDown(textbox(), { key: "Escape" });
    expect(pickerOpen()).toBe(false);
    // Typing on in the dismissed token keeps it closed; a new `/` opens it again.
    type("/diass");
    expect(pickerOpen()).toBe(false);
    type("");
    type("/gra");
    expect(pickerOpen()).toBe(true);
    fireEvent.keyDown(textbox(), { key: "Tab" });
    await waitFor(() => {
      expect(textbox()).toHaveValue("¡Con gusto!");
    });
    expect(renderSnippet).toHaveBeenCalledWith("s-gracias");
    expect(pickerOpen()).toBe(false);

    // Mid-message: the `/token` at the caret is replaced, the rest stays.
    type("¡Con gusto! /hor");
    fireEvent.keyDown(textbox(), { key: "Enter" });
    await waitFor(() => {
      expect(textbox()).toHaveValue("¡Con gusto! Atendemos de lunes a viernes, días hábiles.");
    });
    expect(onSend).not.toHaveBeenCalled();

    // Nothing matches: Enter closes the picker instead of sending "/zzz".
    type("/zzz");
    expect(screen.getByText(s.snippetPickerEmpty)).toBeInTheDocument();
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(pickerOpen()).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("opens the picker from the zap button", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: s.snippetPickerOpen }));
    expect(textbox()).toHaveValue("/");
    await waitFor(() => {
      expect(pickerOpen()).toBe(true);
    });
  });

  it("blocks sending until the unresolved variables are filled", async () => {
    const { onSend } = renderComposer();
    type("/sal");
    await waitFor(() => {
      expect(activeOption()).toHaveTextContent("/saldo");
    });
    fireEvent.keyDown(textbox(), { key: "Enter" });
    await waitFor(() => {
      expect(textbox()).toHaveValue("Hola María, tu saldo es {{saldo}}.");
    });

    const warning = screen.getByText(s.snippetUnresolved(["saldo"]));
    expect(warning).toBeInTheDocument();
    expect(textbox()).toHaveAttribute("aria-invalid", "true");
    // The variable is selected, so typing replaces it.
    expect(textbox().selectionStart).toBe("Hola María, tu saldo es ".length);
    expect(textbox().selectionEnd).toBe("Hola María, tu saldo es {{saldo}}".length);
    expect(screen.getByRole("button", { name: s.send })).toBeDisabled();
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    type("Hola María, tu saldo es Q 2,450.00.");
    expect(screen.queryByText(s.snippetUnresolved(["saldo"]))).toBeNull();
    expect(screen.getByRole("button", { name: s.send })).toBeEnabled();
    await act(async () => {
      fireEvent.keyDown(textbox(), { key: "Enter" });
      await Promise.resolve();
    });
    expect(onSend).toHaveBeenCalledWith({
      kind: "text",
      body: "Hola María, tu saldo es Q 2,450.00.",
    });
  });
});
