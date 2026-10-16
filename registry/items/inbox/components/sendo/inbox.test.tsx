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
 * 13. AC-RS-2: a screen rendered with `locale="en"` shows Spanish text (or `"es"` English): a
 *     hard-coded string, a formatter with a fixed locale, or a system line showing its stored text.
 * 14. AC-RS-3: the `strings` prop replaces the locale instead of overriding single keys.
 * 15. AC-PL-4: a structured system line renders in the stored (English) text instead of the
 *     viewer's language, or a legacy row without params renders nothing.
 * 16. AC-RS-1: a locale object missing a key, or a missing locale, still typechecks.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SendoLocale } from "@/lib/sendo-ui";
import {
  makeActions,
  makeConversation,
  makeMessage,
  mockViewport,
  ok,
} from "../../../../test/inbox-factories";
import { leaksIn } from "../../../../test/leak";
import { InboxAccessDenied } from "./access-denied";
import { Inbox, type InboxProps } from "./inbox";
import { inboxStrings, resolveInboxStrings, type InboxStrings } from "./strings";
import type {
  InboxActions,
  InboxConversationView,
  InboxMessageView,
  InboxPermissions,
} from "./types";
import { formatCostCents, inboxFormat } from "./utils";

// Day separators use the inbox time zone (America/Guatemala); fixtures are "N minutes ago", so a
// run just after midnight there turns them into "yesterday". Pin the clock to midday there,
// before the module-level fixtures are built. Only `Date` is faked: timers stay real for waitFor.
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-14T18:00:00.000Z"));
});

const s = inboxStrings.es;
const f = inboxFormat("es");

const SUPERVISOR: InboxPermissions = {
  reassign: true,
  pauseAgent: true,
  viewCosts: false,
  manageSnippets: false,
  manageTags: false,
};
const AGENT: InboxPermissions = { ...SUPERVISOR, reassign: false, pauseAgent: false };

const DRAFT_LEAVE_TIMEOUT = 10_000;

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
      locale="es"
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

/**
 * Like `withThread`, but the thread follows the server after a draft action. Without realtime the
 * open thread polls every 3 s; on a slow CI worker a poll answering the old draft replaced the
 * sent message (or brought the card back) before the assertions ran.
 */
function withServerThread(
  actions: (setItems: (items: InboxMessageView[]) => void) => Partial<InboxActions>,
): Partial<InboxActions> {
  let items = [DRAFT];
  return {
    thread: vi.fn(() => Promise.resolve(ok({ items, nextCursor: null, names: {} }))),
    ...actions((next) => {
      items = next;
    }),
  };
}

beforeEach(() => {
  mockViewport(true);
});

describe("<Inbox> access (AC-RL-4)", () => {
  it("shows the no-access state for a role that resolves to null", () => {
    render(<InboxAccessDenied locale="es" />);
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
        locale="es"
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
    const reply = vi.fn(() => Promise.resolve(ok(sent)));
    let approveDraft = vi.fn();
    const actions = withServerThread((setItems) => {
      approveDraft = vi.fn(() => {
        setItems([sent]);
        return Promise.resolve(ok(sent));
      });
      return { approveDraft, reply };
    });
    renderInbox(conversation, makeActions(actions, conversation));
    await open(conversation);

    fireEvent.click(screen.getByRole("button", { name: s.draftApprove }));
    expect(approveDraft).toHaveBeenCalledWith("draft-1", undefined);
    expect(reply).not.toHaveBeenCalled();
    // The card leaves after its exit motion; loaded CI workers have taken over 5 s here.
    await waitFor(
      () => {
        expect(screen.queryByRole("button", { name: s.draftApprove })).toBeNull();
      },
      { timeout: DRAFT_LEAVE_TIMEOUT },
    );
    const log = screen.getByRole("log");
    expect(within(log).getByText(DRAFT.text ?? "")).toBeInTheDocument();
    expect(within(log).getByText(/aprobado por Ana López/)).toBeInTheDocument();
  }, 20_000);

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
    let discardDraft = vi.fn();
    const actions = withServerThread((setItems) => {
      discardDraft = vi.fn(() => {
        setItems([]);
        return Promise.resolve(ok(null));
      });
      return { discardDraft };
    });
    renderInbox(conversation, makeActions(actions, conversation));
    await open(conversation);

    fireEvent.click(screen.getByRole("button", { name: s.draftDiscard }));
    expect(discardDraft).toHaveBeenCalledWith("draft-1");
    await waitFor(
      () => {
        expect(screen.queryByRole("button", { name: s.draftDiscard })).toBeNull();
      },
      { timeout: DRAFT_LEAVE_TIMEOUT },
    );
  }, 20_000);

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
    const turn = formatCostCents(0.24, "es");
    expect(first).toContain(turn);
    expect(first).toContain(s.turnCost(turn, 1102, 64, f));
    expect(second).toContain(s.turnCost(s.costUnknown, 980, 22, f));
    const section = screen.getByText(s.sectionCost).closest("section");
    expect(section).not.toBeNull();
    expect(section).toHaveTextContent(s.costTurns(140, f));
    expect(section).toHaveTextContent(formatCostCents(31.5, "es").replace(/\s/g, " "));
    expect(section).toHaveTextContent(s.costUnpriced(2, f));
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

describe("<Inbox> languages (AC-RS-1..3, AC-PL-4)", () => {
  const ADMIN: InboxPermissions = { ...SUPERVISOR, viewCosts: true };
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const reason = "Wants to split the October balance";
  const conversation = makeConversation({
    status: "human",
    assignedTo: "user-2",
    assignee: { id: "user-2", name: "Luis Pérez", avatarUrl: null },
    handoff: { reason, by: "agent:recepcion", at: minutesAgo(30) },
    handoffReason: reason,
    hasPendingDraft: true,
    unreadCount: 3,
    tags: [{ id: "tag-1", name: "billing", color: "amber" }],
  });
  function systemLine(
    id: string,
    minutes: number,
    text: string,
    systemLine: NonNullable<InboxMessageView["systemLine"]>,
  ): InboxMessageView {
    return makeMessage({
      id,
      direction: "out",
      sender: "system",
      status: "sent",
      internal: true,
      text,
      createdAt: minutesAgo(minutes),
      systemLine,
    });
  }
  const items: InboxMessageView[] = [
    makeMessage({ id: "in-1", text: "Hi, can I pay in two parts?", createdAt: minutesAgo(40) }),
    systemLine("sys-1", 30, "The agent recepcion handed the conversation to a person · " + reason, {
      kind: "system",
      event: "handoff",
      by: "agent:recepcion",
      params: { reason },
    }),
    systemLine(
      "sys-2",
      29,
      "Reassigned to Luis Pérez by rule «billing-shift» (12 min without a reply)",
      {
        kind: "rule",
        event: "assigned",
        by: "rule:billing-shift",
        params: {
          ruleKey: "billing-shift",
          assignedTo: "user-2",
          assignedToName: "Luis Pérez",
          minutesWaiting: 12,
        },
      },
    ),
    systemLine("sys-3", 28, "Ana López paused the agent in this conversation", {
      kind: "system",
      event: "agent_paused",
      by: "user-1",
      params: { byName: "Ana López" },
    }),
    systemLine("sys-4", 27, "Conversación iniciada desde el QR de la garita", {
      kind: "system",
      event: "source",
      by: "system",
      params: {},
    }),
    systemLine("sys-5", 26, "Asignada a Ana López por regla «Turno cobranza»", {
      kind: "rule",
      event: "assigned",
      by: "rule:Turno cobranza",
      params: {},
    }),
    makeMessage({
      id: "note-1",
      direction: "out",
      sender: "human",
      senderRef: "user-1",
      internal: true,
      text: "Call her after 5",
      createdAt: minutesAgo(20),
    }),
    makeMessage({
      id: "agent-1",
      direction: "out",
      sender: "agent",
      senderRef: "recepcion",
      status: "read",
      text: "Your balance is Q 2,450.00",
      tokensIn: 1102,
      tokensOut: 64,
      costCents: 0.24,
      createdAt: minutesAgo(15),
    }),
    { ...DRAFT, createdAt: minutesAgo(1) },
  ];
  /** Everything the app stored: it stays in whatever language it was written in. */
  const USER_DATA = [
    "Diego Hernández",
    "Ana López",
    "Luis Pérez",
    "Recepción IA",
    "billing-shift",
    "billing",
    reason,
    "Hi, can I pay in two parts?",
    "Call her after 5",
    "Your balance is Q 2,450.00",
    DRAFT.text ?? "",
    "Conversación iniciada desde el QR de la garita",
    "Asignada a Ana López por regla «Turno cobranza»",
  ];

  async function renderIn(locale: SendoLocale, props: Partial<InboxProps> = {}) {
    const thread = vi.fn(() =>
      Promise.resolve(
        ok({
          items,
          nextCursor: null,
          names: { "user-1": "Ana López", "user-2": "Luis Pérez" },
          cost: {
            turns: 140,
            tokensIn: 150_000,
            tokensOut: 9_000,
            costCents: 31.5,
            unpricedTurns: 2,
          },
        }),
      ),
    );
    renderInbox(conversation, makeActions({ thread }, conversation), {
      locale,
      permissions: ADMIN,
      agentNames: { recepcion: "Recepción IA" },
      ...props,
    });
    await open(conversation);
  }

  it.each([
    ["en", "es"],
    ["es", "en"],
  ] as const)(
    "renders %s without %s strings, user data excluded (AC-RS-2)",
    async (locale, other) => {
      await renderIn(locale);
      expect(leaksIn(document.body, inboxStrings, locale, other, USER_DATA)).toEqual([]);
      const strings = inboxStrings[locale];
      const format = inboxFormat(locale);
      expect(screen.getByText(strings.dayToday)).toBeInTheDocument();
      expect(screen.getAllByText(strings.costTurns(140, format)).length).toBeGreaterThan(0);
    },
  );

  it("renders structured system lines in the viewer's language and legacy rows as stored (AC-PL-4)", async () => {
    await renderIn("es");
    const log = screen.getByRole("log");
    expect(
      within(log).getByText(`Recepción IA pasó la conversación a una persona · ${reason}`),
    ).toBeInTheDocument();
    expect(
      within(log).getByText(
        "Reasignada a Luis Pérez por la regla «billing-shift» (12 min sin respuesta)",
      ),
    ).toBeInTheDocument();
    expect(
      within(log).getByText("Ana López pausó al agente en esta conversación"),
    ).toBeInTheDocument();
    expect(
      within(log).getByText("Conversación iniciada desde el QR de la garita"),
    ).toBeInTheDocument();
    expect(
      within(log).getByText("Asignada a Ana López por regla «Turno cobranza»"),
    ).toBeInTheDocument();
    expect(within(log).queryByText(/paused the agent/)).toBeNull();
  });

  it("overrides single strings on top of the locale (AC-RS-3)", async () => {
    await renderIn("en", { strings: { tabClosed: "Archived" } });
    const tabs = screen.getByRole("tablist");
    expect(within(tabs).getByText("Archived")).toBeInTheDocument();
    expect(within(tabs).getByText(inboxStrings.en.tabOpen)).toBeInTheDocument();
    expect(resolveInboxStrings("en", { tabClosed: "Archived" }).tabMine).toBe(
      inboxStrings.en.tabMine,
    );
  });

  it("types every locale as a complete InboxStrings (AC-RS-1)", () => {
    const { pageTitle, ...withoutPageTitle } = inboxStrings.en;
    // @ts-expect-error: a locale object without `pageTitle` is not an InboxStrings.
    const incomplete: InboxStrings = withoutPageTitle;
    // @ts-expect-error: every SendoLocale needs its strings object.
    const missingLocale: Record<SendoLocale, InboxStrings> = { en: inboxStrings.en };
    expect([pageTitle, incomplete, missingLocale]).toHaveLength(3);
  });
});
