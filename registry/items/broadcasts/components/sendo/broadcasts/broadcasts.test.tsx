// @vitest-environment jsdom
/**
 * The two decisions the Broadcasts screen makes on its own, driven through the rendered UI with the
 * server actions as the boundary (the package logic is covered E2E in
 * `apps/playground/test/broadcasts.test.ts`), and its two languages.
 *
 * Ways it could fail (one test each):
 * 1. The review step lets the admin confirm (or calls `createBroadcast`) when the preview says
 *    nobody is eligible (a MARKETING template to a list without opt-in).
 * 2. With eligible contacts, confirming is blocked, or creates something other than the draft
 *    that was previewed (other template, audience, variables or rate).
 * 3. The progress view keeps showing the counts it was opened with instead of the ones
 *    `getBroadcast` returns while the broadcast is sending.
 * 4. A failed recipient row hides Meta's error (code and message).
 * 5. AC-RS-2: the screen rendered with `locale="en"` shows Spanish text (or `"es"` English): a
 *    string left out of `broadcastsStrings`, a hard-coded label or a count or date formatted in a
 *    fixed locale. Checked on the list, the review step and the progress view with the cancel
 *    dialog open, user data excluded.
 * 6. AC-RS-3: the `strings` prop replaces the locale instead of overriding single keys.
 * 7. AC-RS-1: a locale object missing a key, or a missing locale, still typechecks.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SendoLocale } from "@/lib/sendo-ui";
import { leaksIn } from "../../../../../test/leak";
import { BroadcastComposer } from "./broadcast-composer";
import { BroadcastProgress } from "./broadcast-progress";
import { BroadcastsScreen } from "./broadcasts-screen";
import { broadcastsFormat } from "./format";
import { broadcastsStrings, resolveBroadcastsStrings, type BroadcastsStrings } from "./strings";
import { BroadcastsStringsProvider } from "./strings-context";
import type {
  BroadcastDraft,
  BroadcastPreviewView,
  BroadcastsActions,
  BroadcastSummaryView,
  RecipientCounts,
} from "./types";
import { DEFAULT_BROADCASTS_LINKS } from "./types";

const strings = broadcastsStrings.en;
const format = broadcastsFormat("en");

function inLocale(locale: SendoLocale) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <BroadcastsStringsProvider locale={locale}>{children}</BroadcastsStringsProvider>;
  };
}

const NUMBER = {
  id: "acc-1",
  label: "Recepción",
  displayPhone: "+502 2222 3333",
  isDefault: true,
  active: true,
  billingReady: true,
};

const PROMO = {
  id: "tpl-1",
  name: "promo_noviembre",
  language: "es",
  category: "MARKETING",
  variableCount: 1,
  body: "Hola {{1}}, este mes tenemos 20% en limpiezas.",
};

function preview(eligible: number, noOptIn: number): BroadcastPreviewView {
  return {
    total: eligible + noOptIn,
    eligible,
    skipped: { no_opt_in: noOptIn, opted_out: 0, invalid_phone: 0 },
    category: "MARKETING",
    ratePerMinute: 30,
    estimatedMinutes: Math.ceil(eligible / 30),
  };
}

function summary(
  counts: Partial<RecipientCounts>,
  status: BroadcastSummaryView["status"] = "sending",
) {
  return {
    id: "bc-1",
    accountId: "acc-1",
    templateName: "recordatorio_cita",
    language: "es",
    category: "UTILITY",
    status,
    pauseReason: null,
    ratePerMinute: 60,
    createdBy: "admin",
    createdAt: "2026-10-09T15:00:00.000Z",
    startedAt: "2026-10-09T15:01:00.000Z",
    finishedAt: null,
    counts: {
      pending: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      ...counts,
    },
  } satisfies BroadcastSummaryView;
}

function composerActions(result: BroadcastPreviewView) {
  return {
    listTemplates: vi.fn<BroadcastsActions["listTemplates"]>(() =>
      Promise.resolve({ ok: true, data: [PROMO] }),
    ),
    listAudiences: vi.fn<BroadcastsActions["listAudiences"]>(() =>
      Promise.resolve({
        ok: true,
        data: [{ id: "pacientes", label: "Pacientes activos", description: null, size: 1200 }],
      }),
    ),
    previewBroadcast: vi.fn<BroadcastsActions["previewBroadcast"]>(() =>
      Promise.resolve({ ok: true, data: result }),
    ),
    createBroadcast: vi.fn<BroadcastsActions["createBroadcast"]>(() =>
      Promise.resolve({ ok: true, data: summary({ pending: result.eligible }, "queued") }),
    ),
  };
}

async function fillAndReview(
  actions: ReturnType<typeof composerActions>,
  rate = "30",
  locale: SendoLocale = "en",
) {
  const onCreated = vi.fn();
  const strings = broadcastsStrings[locale];
  render(
    <BroadcastComposer
      numbers={[NUMBER]}
      actions={actions}
      links={DEFAULT_BROADCASTS_LINKS}
      onCancel={vi.fn()}
      onCreated={onCreated}
    />,
    { wrapper: inLocale(locale) },
  );
  const template = screen.getByLabelText(strings.templateLabel);
  await waitFor(() => {
    expect(template).toBeEnabled();
  });
  fireEvent.change(template, { target: { value: `${PROMO.name}\u0000${PROMO.language}` } });
  fireEvent.change(screen.getByLabelText(strings.variableLabel(1)), { target: { value: "Ana" } });
  fireEvent.click(await screen.findByRole("radio", { name: /Pacientes activos/ }));
  fireEvent.change(screen.getByLabelText(strings.rateLabel), { target: { value: rate } });
  fireEvent.click(screen.getByRole("button", { name: strings.review }));
  await screen.findByRole("heading", { name: strings.reviewTitle });
  return { onCreated };
}

describe("broadcast review", () => {
  it("1. cannot be confirmed when nobody is eligible", async () => {
    const actions = composerActions(preview(0, 1200));
    await fillAndReview(actions);

    expect(screen.getByText(strings.noneEligibleTitle)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: strings.confirmNone });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(actions.createBroadcast).not.toHaveBeenCalled();
    // The skipped reason is explained, and the cost note links to Meta, with no rates.
    expect(screen.getByText(strings.skipReasonLabels.no_opt_in)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: strings.costLink })).toHaveAttribute(
      "href",
      DEFAULT_BROADCASTS_LINKS.metaPricing,
    );
  });

  it("2. confirms exactly the previewed draft when some contacts are eligible", async () => {
    const actions = composerActions(preview(800, 400));
    const { onCreated } = await fillAndReview(actions, "45");

    const confirm = screen.getByRole("button", { name: strings.confirm(800, format) });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
    const expected: BroadcastDraft = {
      account: "acc-1",
      template: "promo_noviembre",
      language: "es",
      audience: "pacientes",
      variables: ["Ana"],
      ratePerMinute: 45,
    };
    expect(actions.previewBroadcast).toHaveBeenCalledWith(expected);
    expect(actions.createBroadcast).toHaveBeenCalledWith(expected);
  });
});

describe("broadcast progress", () => {
  function progressActions(next: BroadcastSummaryView) {
    return {
      getBroadcast: vi.fn<BroadcastsActions["getBroadcast"]>(() =>
        Promise.resolve({ ok: true, data: next }),
      ),
      listRecipients: vi.fn<BroadcastsActions["listRecipients"]>(() =>
        Promise.resolve({
          ok: true,
          data: {
            items: [
              {
                id: "r-1",
                contactId: "c-1",
                name: "Aleksandra Wiśniewska-Kowalczyk",
                phone: "+50255550001",
                appRef: null,
                status: "failed",
                skipReason: null,
                error: {
                  code: 131026,
                  title: "Message undeliverable",
                  message: "Unable to deliver message",
                  details: "Recipient is not a valid WhatsApp user",
                },
                updatedAt: "2026-10-09T15:02:00.000Z",
              },
            ],
            nextCursor: null,
          },
        }),
      ),
      cancelBroadcast: vi.fn<BroadcastsActions["cancelBroadcast"]>(),
    };
  }

  const count = (label: string) =>
    within(screen.getByRole("list", { name: strings.recipientsFilterLabel }))
      .getByText(label)
      .closest("button");

  it("3. renders the counts that getBroadcast returns while sending", async () => {
    const opened = summary({ pending: 10_000 });
    const actions = progressActions(
      summary({ pending: 9_000, sent: 500, delivered: 300, read: 150, failed: 50 }),
    );
    render(
      <BroadcastProgress
        broadcast={opened}
        numbers={[NUMBER]}
        actions={actions}
        links={DEFAULT_BROADCASTS_LINKS}
        pollMs={10}
        onBack={vi.fn()}
      />,
      { wrapper: inLocale("en") },
    );
    expect(screen.getByText(strings.processed(0, 10_000, format))).toBeInTheDocument();

    expect(await screen.findByText(strings.processed(1_000, 10_000, format))).toBeInTheDocument();
    expect(actions.getBroadcast).toHaveBeenCalledWith("bc-1");
    expect(count(strings.recipientStatusLabels.pending)).toHaveTextContent(format.number(9_000));
    expect(count(strings.recipientStatusLabels.sent)).toHaveTextContent("500");
    expect(count(strings.recipientStatusLabels.delivered)).toHaveTextContent("300");
    expect(count(strings.recipientStatusLabels.read)).toHaveTextContent("150");
    expect(count(strings.recipientStatusLabels.failed)).toHaveTextContent("50");
    expect(count(strings.filterAll)).toHaveTextContent(format.number(10_000));
    // The bar's accessible name carries the same progress.
    expect(
      screen.getByRole("img", { name: strings.processed(1_000, 10_000, format) }),
    ).toBeInTheDocument();
  });

  it("4. shows Meta's error on a failed recipient", async () => {
    const opened = summary({ failed: 1 }, "done");
    render(
      <BroadcastProgress
        broadcast={opened}
        numbers={[NUMBER]}
        actions={progressActions(opened)}
        links={DEFAULT_BROADCASTS_LINKS}
        onBack={vi.fn()}
      />,
      { wrapper: inLocale("en") },
    );
    const row = (await screen.findByText("Aleksandra Wiśniewska-Kowalczyk")).closest("li");
    expect(row).not.toBeNull();
    const cell = within(row as HTMLElement);
    expect(cell.getByText(strings.metaError(131026))).toBeInTheDocument();
    expect(cell.getByText(/Message undeliverable: Unable to deliver message/)).toBeInTheDocument();
    expect(cell.getByText(strings.recipientStatusLabels.failed)).toBeInTheDocument();
  });
});

describe("<BroadcastsScreen> languages (AC-RS-1..3)", () => {
  const META_ERROR = {
    code: 131026,
    title: "Message undeliverable",
    message: "Unable to deliver message",
    details: "Recipient is not a valid WhatsApp user",
  };
  /** What the app and Meta stored: names, phones, templates, lists and Meta's error text. */
  const USER_DATA = [
    NUMBER.label,
    NUMBER.displayPhone,
    PROMO.name,
    "Hola Ana, este mes tenemos 20% en limpiezas.",
    "Ana",
    "recordatorio_cita",
    "Pacientes activos",
    "Aleksandra Wiśniewska-Kowalczyk",
    "+50255550001",
    `${META_ERROR.title}: ${META_ERROR.message} — ${META_ERROR.details}`,
  ];
  const sending = summary({ pending: 1_200, sent: 400, delivered: 250, failed: 1 });
  const cancelled = {
    ...summary({ sent: 2, cancelled: 3 }, "cancelled"),
    id: "bc-2",
    accountId: "acc-2",
  };

  function screenActions(): BroadcastsActions {
    return {
      ...composerActions(preview(800, 400)),
      listBroadcasts: () => Promise.resolve({ ok: true, data: { items: [], nextCursor: null } }),
      getBroadcast: () => Promise.resolve({ ok: true, data: sending }),
      listRecipients: () =>
        Promise.resolve({
          ok: true,
          data: {
            items: [
              {
                id: "r-1",
                contactId: "c-1",
                name: "Aleksandra Wiśniewska-Kowalczyk",
                phone: "+50255550001",
                appRef: null,
                status: "failed",
                skipReason: null,
                error: META_ERROR,
                updatedAt: "2026-10-09T15:02:00.000Z",
              },
            ],
            nextCursor: "next",
          },
        }),
      cancelBroadcast: () => Promise.resolve({ ok: true, data: sending }),
    };
  }

  function renderScreen(locale: SendoLocale, opened: BroadcastSummaryView | null) {
    return render(
      <BroadcastsScreen
        locale={locale}
        numbers={[NUMBER, { ...NUMBER, id: "acc-2", label: null, active: false }]}
        initialBroadcasts={{ items: [sending, cancelled], nextCursor: "c" }}
        initialBroadcast={opened}
        actions={screenActions()}
        syncUrl={false}
      />,
    );
  }

  it.each([
    ["en", "es"],
    ["es", "en"],
  ] as const)(
    "renders %s without %s strings, user data excluded (AC-RS-2)",
    async (locale, other) => {
      const strings = broadcastsStrings[locale];
      const list = renderScreen(locale, null);
      expect(screen.getByRole("heading", { name: strings.pageTitle })).toBeInTheDocument();
      expect(leaksIn(document.body, broadcastsStrings, locale, other, USER_DATA)).toEqual([]);
      list.unmount();

      const review = await fillAndReview(composerActions(preview(800, 400)), "30", locale);
      expect(review.onCreated).not.toHaveBeenCalled();
      expect(screen.getByText(strings.previewBreakdown)).toBeInTheDocument();
      expect(leaksIn(document.body, broadcastsStrings, locale, other, USER_DATA)).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: strings.back }));
      expect(leaksIn(document.body, broadcastsStrings, locale, other, USER_DATA)).toEqual([]);
      document.body.innerHTML = "";

      renderScreen(locale, sending);
      expect(await screen.findByText("Aleksandra Wiśniewska-Kowalczyk")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: strings.cancel }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(leaksIn(document.body, broadcastsStrings, locale, other, USER_DATA)).toEqual([]);
    },
  );

  it("overrides single strings on top of the locale (AC-RS-3)", () => {
    render(
      <BroadcastsScreen
        locale="en"
        strings={{ newBroadcast: "Start a send" }}
        numbers={[NUMBER]}
        initialBroadcasts={{ items: [sending], nextCursor: null }}
        actions={screenActions()}
        syncUrl={false}
      />,
    );
    expect(screen.getByRole("button", { name: /Start a send/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: strings.pageTitle })).toBeInTheDocument();
    expect(resolveBroadcastsStrings("es", { back: "Atrás" }).cancel).toBe(
      broadcastsStrings.es.cancel,
    );
  });

  it("types every locale as a complete BroadcastsStrings (AC-RS-1)", () => {
    const { pageTitle, ...withoutPageTitle } = broadcastsStrings.en;
    // @ts-expect-error: a locale object without `pageTitle` is not a BroadcastsStrings.
    const incomplete: BroadcastsStrings = withoutPageTitle;
    // @ts-expect-error: every SendoLocale needs its strings object.
    const missingLocale: Record<SendoLocale, BroadcastsStrings> = { en: broadcastsStrings.en };
    expect([pageTitle, incomplete, missingLocale]).toHaveLength(3);
  });
});
