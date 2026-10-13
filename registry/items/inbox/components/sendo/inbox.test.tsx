// @vitest-environment jsdom
/**
 * `<Inbox>` in isolation (registry RTL): the rules the operator relies on that the package E2E
 * suite can't see, because they live in the copied UI. Written before the SND-3.5 UI, one test
 * per way it could fail:
 *
 * 1. AC-RL-4: a user whose role resolves to `null` sees data instead of "No tienes acceso a la
 *    bandeja" (page-level component, and the list coming back `FORBIDDEN`).
 * 2. AC-IB-4: "Aprobar y enviar" calls `reply` (or `approveDraft` with text) instead of
 *    `approveDraft(draftId)`; the card stays after approval or the sent message never shows.
 * 3. AC-IB-4: an edited draft is sent as the original text.
 * 4. AC-IB-4: "Descartar" doesn't call `discardDraft(draftId)`.
 * 5. Flow E 5: a closed window still lets the operator approve the draft.
 * 6. AC-IB-6: the handoff banner shows outside `human`, or hides while `human`.
 * 7. AC-IB-2 / AC-RL-2: "Reanudar" resumes through the wrong action, or shows for an agent role
 *    or for a pause on the whole number (only an admin can lift that, from Números).
 * 8. AC-IB-8: a disconnected number still offers the composer.
 * 9. Edge case: a conversation reassigned away (`FORBIDDEN` on open) stays in the list.
 * 10. AC-CO-2: a non-admin (no `costs.view`) gets the turn cost line on agent replies or the
 *     "Costo del agente" section.
 * 11. AC-CO-2: an admin doesn't get the cost line on agent replies ("—" when the cost is null),
 *     gets it on operator or contact messages, or the panel totals only the loaded page instead
 *     of the whole conversation (`cost` of the thread page).
 * 12. AC-VN-2: a voice note shows neither its transcript nor "Sin transcripción" after a failure.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeActions,
  makeConversation,
  makeMessage,
  mockViewport,
  ok,
} from "../../../../test/inbox-factories";
import { InboxAccessDenied } from "./access-denied";
import { Inbox, type InboxProps } from "./inbox";
import { defaultInboxStrings as s } from "./strings";
import type { InboxActions, InboxConversationView, InboxPermissions } from "./types";

const SUPERVISOR: InboxPermissions = {
  reassign: true,
  pauseAgent: true,
  viewCosts: false,
  manageSnippets: false,
  manageTags: false,
};
const AGENT: InboxPermissions = { ...SUPERVISOR, reassign: false, pauseAgent: false };

const DRAFT = makeMessage({
  id: "draft-1",
  direction: "out",
  sender: "agent",
  senderRef: "recepcion",
  status: "pending",
  draft: true,
  text: "Ya registré la fuga; el plomero llega mañana a las 8:00.",
  sentAt: null,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
});

function renderInbox(
  conversation: InboxConversationView,
  actions: InboxActions,
  props: Partial<InboxProps> = {},
) {
  return render(
    <Inbox
      currentUser={{ id: "user-1", name: "Ana López" }}
      tenantId="tenant-1"
      realtimeClient={null}
      actions={actions}
      permissions={SUPERVISOR}
      tags={[]}
      initialPage={{ items: [conversation], nextCursor: null, counts: null }}
      {...props}
    />,
  );
}

async function open(conversation: InboxConversationView) {
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(conversation.contact.displayName) }),
  );
  await screen.findByRole("log");
  await waitFor(() => {
    expect(screen.getByRole("log")).toHaveAttribute("aria-busy", "false");
  });
}

function withThread(actions: Partial<InboxActions>, items = [DRAFT]): Partial<InboxActions> {
  return {
    thread: vi.fn(() => Promise.resolve(ok({ items, nextCursor: null, names: {} }))),
    ...actions,
  };
}

beforeEach(() => {
  mockViewport(true);
});

describe("<Inbox> access (AC-RL-4)", () => {
  it("shows the no-access state for a role that resolves to null", () => {
    render(<InboxAccessDenied />);
    expect(screen.getByRole("alert")).toHaveTextContent(s.accessDeniedTitle);
  });

  it("switches to the no-access state when the list is FORBIDDEN", async () => {
    const actions = makeActions({
      list: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          code: "FORBIDDEN" as const,
          message: "Access denied",
        }),
      ),
    });
    render(
      <Inbox
        currentUser={{ id: "user-1", name: null }}
        tenantId="tenant-1"
        realtimeClient={null}
        actions={actions}
        tags={[]}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(s.accessDeniedTitle);
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

describe("<Inbox> draft card (AC-IB-4)", () => {
  const conversation = makeConversation({ hasPendingDraft: true });

  it("approves the draft as is, then shows the sent agent message instead of the card", async () => {
    const sent = makeMessage({
      id: "draft-1",
      direction: "out",
      sender: "agent",
      senderRef: "recepcion",
      status: "sent",
      text: DRAFT.text,
      approvedBy: "user-1",
    });
    const approveDraft = vi.fn(() => Promise.resolve(ok(sent)));
    const reply = vi.fn(() => Promise.resolve(ok(sent)));
    renderInbox(conversation, makeActions(withThread({ approveDraft, reply }), conversation));
    await open(conversation);

    fireEvent.click(screen.getByRole("button", { name: s.draftApprove }));
    expect(approveDraft).toHaveBeenCalledWith("draft-1", undefined);
    expect(reply).not.toHaveBeenCalled();
    // The card leaves after its exit motion; give a loaded CI worker more than the 1 s default.
    await waitFor(
      () => {
        expect(screen.queryByRole("button", { name: s.draftApprove })).toBeNull();
      },
      { timeout: 2_500 },
    );
    const log = screen.getByRole("log");
    expect(within(log).getByText(DRAFT.text ?? "")).toBeInTheDocument();
    expect(within(log).getByText(/aprobado por Ana López/)).toBeInTheDocument();
  });

  it("sends the edited text", async () => {
    const approveDraft = vi.fn(() => Promise.resolve(ok(makeMessage({ id: "draft-1" }))));
    renderInbox(conversation, makeActions(withThread({ approveDraft }), conversation));
    await open(conversation);

    fireEvent.click(screen.getByRole("button", { name: s.draftEdit }));
    fireEvent.change(screen.getByRole("textbox", { name: s.draftEditLabel }), {
      target: { value: "El plomero llega mañana a las 9:00." },
    });
    fireEvent.click(screen.getByRole("button", { name: s.draftSendEdited }));
    expect(approveDraft).toHaveBeenCalledWith("draft-1", "El plomero llega mañana a las 9:00.");
  });

  it("discards the draft", async () => {
    const discardDraft = vi.fn(() => Promise.resolve(ok(null)));
    renderInbox(conversation, makeActions(withThread({ discardDraft }), conversation));
    await open(conversation);

    fireEvent.click(screen.getByRole("button", { name: s.draftDiscard }));
    expect(discardDraft).toHaveBeenCalledWith("draft-1");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: s.draftDiscard })).toBeNull();
    });
  });

  it("can't approve once the window closed", async () => {
    const closed = makeConversation({
      hasPendingDraft: true,
      window: { open: false, expiresAt: new Date(Date.now() - 60_000).toISOString() },
    });
    const actions = makeActions(withThread({}), closed);
    renderInbox(closed, actions);
    await open(closed);

    expect(screen.getByText(s.draftWindowClosed)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: s.draftApprove })).toBeDisabled();
    expect(screen.getByRole("button", { name: s.draftDiscard })).toBeEnabled();
  });
});

describe("<Inbox> banners", () => {
  const handoff = {
    reason: "Pide dividir el saldo en dos pagos.",
    by: "agent:recepcion",
    at: null,
  };

  it("shows the handoff reason only while the conversation is with a person (AC-IB-6)", async () => {
    const human = makeConversation({ status: "human", handoff, handoffReason: handoff.reason });
    const view = renderInbox(human, makeActions({}, human));
    await open(human);
    expect(screen.getByText(handoff.reason)).toBeInTheDocument();
    view.unmount();

    const agent = makeConversation({ status: "agent", handoff, handoffReason: handoff.reason });
    renderInbox(agent, makeActions({}, agent));
    await open(agent);
    expect(screen.queryByText(handoff.reason)).toBeNull();
  });

  it("resumes a paused agent with Reanudar, for supervisors only (AC-IB-2)", async () => {
    const paused = makeConversation({ agentPaused: true, agentPausedOn: "conversation" });
    const pauseAgent = vi.fn(() => Promise.resolve(ok(paused)));
    const view = renderInbox(paused, makeActions({ pauseAgent }, paused));
    await open(paused);
    expect(screen.getByText(s.pausedBannerTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: s.resume }));
    expect(pauseAgent).toHaveBeenCalledWith(paused.id, false);
    view.unmount();

    renderInbox(paused, makeActions({}, paused), { permissions: AGENT });
    await open(paused);
    expect(screen.getByText(s.pausedBannerTitle)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: s.resume })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("doesn't offer Reanudar for a pause on the whole number", async () => {
    const paused = makeConversation({ agentPaused: true, agentPausedOn: "account" });
    renderInbox(paused, makeActions({}, paused));
    await open(paused);
    expect(screen.getByText(s.pausedAccountTitle)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: s.resume })).toBeNull();
  });

  it("disables the composer on a disconnected number and keeps the thread readable (AC-IB-8)", async () => {
    const disconnected = makeConversation({ accountActive: false });
    const actions = makeActions(
      withThread({}, [makeMessage({ text: "¿Siguen abiertos?" })]),
      disconnected,
    );
    renderInbox(disconnected, actions);
    await open(disconnected);
    expect(screen.getByText(s.disconnectedTitle)).toBeInTheDocument();
    expect(screen.getByText("¿Siguen abiertos?")).toBeInTheDocument();
    expect(screen.getByText(s.composerDisconnected)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: s.composerLabel })).toBeNull();
  });
});

describe("<Inbox> visibility", () => {
  it("drops a conversation that was reassigned away when it is opened", async () => {
    const conversation = makeConversation();
    const actions = makeActions(
      {
        thread: vi.fn(() =>
          Promise.resolve({
            ok: false as const,
            code: "FORBIDDEN" as const,
            message: "Access denied",
          }),
        ),
      },
      conversation,
    );
    renderInbox(conversation, actions);
    fireEvent.click(screen.getByRole("button", { name: /Diego Hernández/ }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Diego Hernández/ })).toBeNull();
    });
    expect(screen.queryByRole("log")).toBeNull();
  });
});

describe("<Inbox> agent cost (AC-CO-2) and voice notes (AC-VN-2)", () => {
  const conversation = makeConversation();
  const ADMIN: InboxPermissions = { ...SUPERVISOR, viewCosts: true };
  const priced = makeMessage({
    id: "agent-1",
    direction: "out",
    sender: "agent",
    senderRef: "recepcion",
    status: "read",
    text: "El saldo es Q 2,450.00",
    tokensIn: 1102,
    tokensOut: 64,
    costCents: 0.24,
  });
  const unpriced = makeMessage({
    id: "agent-2",
    direction: "out",
    sender: "agent",
    senderRef: "recepcion",
    status: "read",
    text: "¿Algo más?",
    tokensIn: 980,
    tokensOut: 22,
    costCents: null,
  });
  const human = makeMessage({
    id: "human-1",
    direction: "out",
    sender: "human",
    senderRef: "user-1",
    status: "read",
    text: "Te ayudo yo",
  });
  const items = [human, unpriced, priced, makeMessage()];
  const total = {
    turns: 140,
    tokensIn: 150_000,
    tokensOut: 9_000,
    costCents: 31.5,
    unpricedTurns: 2,
  };

  function costLines() {
    return [...document.querySelectorAll("[data-turn-cost]")].map((node) => node.textContent);
  }

  it("hides turn cost and the cost section from non-admins", async () => {
    const supervisorItems = items.map((m) => ({
      ...m,
      tokensIn: null,
      tokensOut: null,
      costCents: null,
    }));
    renderInbox(conversation, makeActions(withThread({}, supervisorItems), conversation));
    await open(conversation);
    expect(costLines()).toEqual([]);
    expect(screen.queryByText(s.sectionCost)).toBeNull();
  });

  it("shows admins each agent turn's cost and the conversation total", async () => {
    const thread = vi.fn(() =>
      Promise.resolve(ok({ items, nextCursor: "older", names: {}, cost: total })),
    );
    renderInbox(conversation, makeActions({ thread }, conversation), { permissions: ADMIN });
    await open(conversation);
    expect(costLines()).toHaveLength(2);
    const [first, second] = costLines();
    expect(first).toContain("$0.0024");
    expect(first).toContain(s.turnCost("$0.0024", 1102, 64));
    expect(second).toContain(s.turnCost(s.costUnknown, 980, 22));
    const section = screen.getByText(s.sectionCost).closest("section");
    expect(section).not.toBeNull();
    expect(section).toHaveTextContent(s.costTurns(140));
    expect(section).toHaveTextContent("$0.3150");
    expect(section).toHaveTextContent(s.costUnpriced(2));
  });

  it("shows a voice note's transcript, or 'Sin transcripción' when it failed", async () => {
    const media = {
      url: "https://storage.example/a.ogg",
      mimeType: "audio/ogg",
      sizeBytes: 1200,
      downloadStatus: "done" as const,
    };
    const voice = makeMessage({
      id: "voice-1",
      type: "audio",
      text: "Quiero agendar una cita",
      content: {},
      media,
      transcription: { model: "whisper-1", ms: 900, error: null },
    });
    const failed = makeMessage({
      id: "voice-2",
      type: "audio",
      text: null,
      content: {},
      media,
      transcription: { model: "whisper-1", ms: 30_000, error: "timeout" },
    });
    renderInbox(conversation, makeActions(withThread({}, [failed, voice]), conversation));
    await open(conversation);
    const log = screen.getByRole("log");
    expect(log.querySelectorAll("audio")).toHaveLength(2);
    expect(within(log).getByText("Quiero agendar una cita")).toBeInTheDocument();
    const missing = within(log).getByText(s.transcriptMissing);
    expect(missing.parentElement).toHaveAttribute("title", s.transcriptMissingReason("timeout"));
  });
});
