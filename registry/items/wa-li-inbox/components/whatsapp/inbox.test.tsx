// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeActions,
  makeConversation,
  makeMessage,
  makePatch,
  mockViewport,
  ok,
} from "../../../../test/inbox-factories";
import { Inbox } from "./inbox";
import { defaultInboxStrings, mergeStrings } from "./strings";
import type { InboxActionResult, InboxMessageView } from "./types";

beforeEach(() => {
  mockViewport(true);
});

describe("mergeStrings", () => {
  it("keeps the Spanish defaults and applies overrides", () => {
    const strings = mergeStrings({ take: "Asignarme" });
    expect(strings.take).toBe("Asignarme");
    expect(strings.close).toBe(defaultInboxStrings.close);
    expect(mergeStrings()).toBe(defaultInboxStrings);
  });
});

describe("<Inbox>", () => {
  it("renders overridden strings instead of the defaults", () => {
    render(
      <Inbox
        strings={{ filterHuman: "Personas", listEmpty: "Nada por aquí" }}
        currentUserId="user-1"
        tenantId="tenant-1"
        realtimeClient={null}
        actions={makeActions()}
        initialConversations={[]}
      />,
    );
    expect(screen.getByRole("tab", { name: "Personas" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: defaultInboxStrings.filterHuman })).toBeNull();
    expect(screen.getByText("Nada por aquí")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: defaultInboxStrings.filterAgent })).toBeInTheDocument();
  });

  it("opens a thread, marks it seen and shows an optimistic pending reply until it is sent", async () => {
    let resolveReply: (result: InboxActionResult<InboxMessageView>) => void = () => undefined;
    const markSeen = vi.fn(() => Promise.resolve(ok(makePatch({ id: "conv-1" }))));
    const reply = vi.fn(
      () =>
        new Promise<InboxActionResult<InboxMessageView>>((resolve) => {
          resolveReply = resolve;
        }),
    );
    const actions = makeActions({
      markSeen,
      reply,
      thread: vi.fn(() =>
        Promise.resolve(
          ok({ items: [makeMessage({ text: "Necesito una cita" })], nextCursor: null }),
        ),
      ),
    });
    render(
      <Inbox
        currentUserId="user-1"
        tenantId="tenant-1"
        realtimeClient={null}
        actions={actions}
        initialConversations={[makeConversation({ unreadCount: 2 })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Ana Pérez/ }));
    expect(await screen.findByText("Necesito una cita")).toBeInTheDocument();
    expect(markSeen).toHaveBeenCalledWith("conv-1");

    const textbox = screen.getByRole("textbox", { name: defaultInboxStrings.composerLabel });
    fireEvent.change(textbox, { target: { value: "Claro, ¿qué día?" } });
    fireEvent.keyDown(textbox, { key: "Enter" });

    expect(await screen.findByText("Claro, ¿qué día?")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: defaultInboxStrings.tickPending })).toBeInTheDocument();
    expect(reply).toHaveBeenCalledWith("conv-1", {
      kind: "text",
      body: "Claro, ¿qué día?",
    });

    await act(async () => {
      resolveReply(
        ok(
          makeMessage({
            id: "msg-2",
            direction: "out",
            sender: "human",
            senderRef: "user-1",
            status: "sent",
            text: "Claro, ¿qué día?",
            createdAt: new Date().toISOString(),
          }),
        ),
      );
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole("img", { name: defaultInboxStrings.tickPending })).toBeNull();
    });
    expect(screen.getByRole("img", { name: defaultInboxStrings.tickSent })).toBeInTheDocument();
  });

  it("updates the list row preview to the sent reply", async () => {
    const reply = vi.fn(() =>
      Promise.resolve(
        ok(
          makeMessage({
            id: "msg-2",
            direction: "out",
            sender: "human",
            senderRef: "user-1",
            status: "sent",
            text: "Ya quedó resuelto el cobro",
            createdAt: new Date().toISOString(),
          }),
        ),
      ),
    );
    const actions = makeActions({
      reply,
      thread: vi.fn(() =>
        Promise.resolve(
          ok({ items: [makeMessage({ text: "Necesito una cita" })], nextCursor: null }),
        ),
      ),
    });
    render(
      <Inbox
        currentUserId="user-1"
        tenantId="tenant-1"
        realtimeClient={null}
        actions={actions}
        initialConversations={[
          makeConversation({
            lastMessagePreview: {
              text: "Necesito una cita",
              direction: "in",
              sender: "contact",
              type: "text",
              status: "received",
              at: new Date(Date.now() - 60_000).toISOString(),
            },
          }),
        ]}
      />,
    );

    const row = screen.getByRole("button", { name: /Ana Pérez/ });
    expect(row).toHaveTextContent("Necesito una cita");
    fireEvent.click(row);
    await screen.findByRole("textbox", { name: defaultInboxStrings.composerLabel });

    const textbox = screen.getByRole("textbox", { name: defaultInboxStrings.composerLabel });
    fireEvent.change(textbox, { target: { value: "Ya quedó resuelto el cobro" } });
    fireEvent.keyDown(textbox, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ana Pérez/ })).toHaveTextContent(
        `${defaultInboxStrings.previewYou} Ya quedó resuelto el cobro`,
      );
    });
  });

  it("plays the enter motion only on messages appended after the thread loaded", async () => {
    const reply = vi.fn(() => new Promise<InboxActionResult<InboxMessageView>>(() => undefined));
    const actions = makeActions({
      reply,
      thread: vi.fn(() =>
        Promise.resolve(
          ok({
            items: [
              makeMessage({ id: "msg-2", text: "Segundo" }),
              makeMessage({ id: "msg-1", text: "Primero" }),
            ],
            nextCursor: null,
          }),
        ),
      ),
    });
    render(
      <Inbox
        currentUserId="user-1"
        tenantId="tenant-1"
        realtimeClient={null}
        actions={actions}
        initialConversations={[makeConversation()]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ana Pérez/ }));
    const history = await screen.findByText("Primero");
    expect(history.closest("[data-motion]")).toBeNull();
    expect(screen.getByText("Segundo").closest("[data-motion]")).toBeNull();

    const textbox = screen.getByRole("textbox", { name: defaultInboxStrings.composerLabel });
    fireEvent.change(textbox, { target: { value: "Nuevo" } });
    fireEvent.keyDown(textbox, { key: "Enter" });
    const appended = await screen.findByText("Nuevo");
    expect(appended.closest("[data-motion='enter']")).not.toBeNull();
  });

  it("hides Tomar for a conversation already assigned to me and updates the badge on Cerrar", async () => {
    const close = vi.fn((id: string) =>
      Promise.resolve(ok(makePatch({ id, status: "closed", assignedTo: "user-1" }))),
    );
    const actions = makeActions({ close });
    render(
      <Inbox
        currentUserId="user-1"
        tenantId="tenant-1"
        realtimeClient={null}
        actions={actions}
        initialConversations={[makeConversation({ assignedTo: "user-1" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ana Pérez/ }));
    const header = await screen.findByRole("heading", { name: "Ana Pérez" });
    expect(header).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: defaultInboxStrings.take })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: defaultInboxStrings.close }));
    await waitFor(() => {
      // Badge in the list row and in the thread header.
      expect(screen.getAllByText(defaultInboxStrings.statusClosed)).toHaveLength(2);
    });
    expect(close).toHaveBeenCalledWith("conv-1");
    expect(screen.queryByRole("button", { name: defaultInboxStrings.close })).toBeNull();
  });
});
