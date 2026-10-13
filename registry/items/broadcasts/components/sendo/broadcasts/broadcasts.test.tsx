// @vitest-environment jsdom
/**
 * The two decisions the Envíos screen makes on its own, driven through the rendered UI with the
 * server actions as the boundary (the package logic is covered E2E in
 * `apps/playground/test/broadcasts.test.ts`).
 *
 * Ways it could fail (one test each):
 * 1. The review step lets the admin confirm (or calls `createBroadcast`) when the preview says
 *    nobody is eligible (a MARKETING template to a list without opt-in).
 * 2. With eligible contacts, confirming is blocked, or creates something other than the draft
 *    that was previewed (other template, audience, variables or rate).
 * 3. The progress view keeps showing the counts it was opened with instead of the ones
 *    `getBroadcast` returns while the broadcast is sending.
 * 4. A failed recipient row hides Meta's error (code and message).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BroadcastComposer } from "./broadcast-composer";
import { BroadcastProgress } from "./broadcast-progress";
import { formatCount } from "./format";
import { defaultBroadcastsStrings as strings } from "./strings";
import type {
  BroadcastDraft,
  BroadcastPreviewView,
  BroadcastsActions,
  BroadcastSummaryView,
  RecipientCounts,
} from "./types";
import { DEFAULT_BROADCASTS_LINKS } from "./types";

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

async function fillAndReview(actions: ReturnType<typeof composerActions>, rate = "30") {
  const onCreated = vi.fn();
  render(
    <BroadcastComposer
      numbers={[NUMBER]}
      actions={actions}
      links={DEFAULT_BROADCASTS_LINKS}
      strings={strings}
      onCancel={vi.fn()}
      onCreated={onCreated}
    />,
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

    const confirm = screen.getByRole("button", { name: strings.confirm(800) });
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
        strings={strings}
        pollMs={10}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(strings.processed(0, 10_000))).toBeInTheDocument();

    expect(await screen.findByText(strings.processed(1_000, 10_000))).toBeInTheDocument();
    expect(actions.getBroadcast).toHaveBeenCalledWith("bc-1");
    expect(count(strings.recipientStatusLabels.pending)).toHaveTextContent(formatCount(9_000));
    expect(count(strings.recipientStatusLabels.sent)).toHaveTextContent("500");
    expect(count(strings.recipientStatusLabels.delivered)).toHaveTextContent("300");
    expect(count(strings.recipientStatusLabels.read)).toHaveTextContent("150");
    expect(count(strings.recipientStatusLabels.failed)).toHaveTextContent("50");
    expect(count(strings.filterAll)).toHaveTextContent(formatCount(10_000));
    // The bar's accessible name carries the same progress.
    expect(screen.getByRole("img", { name: strings.processed(1_000, 10_000) })).toBeInTheDocument();
  });

  it("4. shows Meta's error on a failed recipient", async () => {
    const opened = summary({ failed: 1 }, "done");
    render(
      <BroadcastProgress
        broadcast={opened}
        numbers={[NUMBER]}
        actions={progressActions(opened)}
        links={DEFAULT_BROADCASTS_LINKS}
        strings={strings}
        onBack={vi.fn()}
      />,
    );
    const row = (await screen.findByText("Aleksandra Wiśniewska-Kowalczyk")).closest("li");
    expect(row).not.toBeNull();
    const cell = within(row as HTMLElement);
    expect(cell.getByText(strings.metaError(131026))).toBeInTheDocument();
    expect(cell.getByText(/Message undeliverable: Unable to deliver message/)).toBeInTheDocument();
    expect(cell.getByText(strings.recipientStatusLabels.failed)).toBeInTheDocument();
  });
});
