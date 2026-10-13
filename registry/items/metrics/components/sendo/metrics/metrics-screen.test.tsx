// @vitest-environment jsdom
/**
 * The metrics screen against `loadMetrics` (the server action boundary), with reports built by the
 * item's own `summarizeMetrics` from rows shaped like `sendo.metrics.*` returns them.
 *
 * Ways it could fail (one test each):
 * 1. Money leaks to supervisors: a report without cost (`cost: null`, the API's null cost fields)
 *    still renders the cost section or a cost figure.
 * 2. Race: two filter changes in a row, the first answering last, leave the screen on the stale
 *    period (wrong numbers under the selected preset).
 * 3. A failed refetch blanks the screen or shows nothing: the previous numbers must stay, with the
 *    error and a retry that re-sends the same filters.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetricsScreen } from "./metrics-screen";
import { defaultMetricsStrings as strings } from "./strings";
import { summarizeMetrics } from "./summary";
import type {
  MetricsActionResult,
  MetricsFilters,
  MetricsNumberView,
  MetricsRaw,
  MetricsReport,
} from "./types";

const TODAY = "2026-10-09";
const NUMBERS: MetricsNumberView[] = [
  {
    id: "acc-1",
    label: "Recepción",
    displayPhone: "+502 2222 3333",
    isDefault: true,
    active: true,
    timezone: "America/Guatemala",
  },
];

function report(filters: MetricsFilters, inbound: number, withCost: boolean): MetricsReport {
  const raw: MetricsRaw = {
    daily: [
      {
        day: filters.to,
        accountId: "acc-1",
        channel: "whatsapp",
        inbound,
        outbound: 3,
        conversationsStarted: 2,
        conversationsClosed: 1,
        costCents: withCost ? 123.45 : null,
        tokensIn: withCost ? 1000 : null,
        tokensOut: withCost ? 100 : null,
      },
    ],
    byAssignee: [],
    firstResponse: [],
    aiResolution: [],
    bySource: [],
    cost: withCost
      ? [
          {
            day: filters.to,
            agent: "recepcion",
            costCents: 123.45,
            tokensIn: 1000,
            tokensOut: 100,
            turns: 4,
          },
        ]
      : null,
  };
  return summarizeMetrics({ filters, timeZone: "America/Guatemala", raw, tags: [] });
}

const thirtyDays: MetricsFilters = { from: "2026-09-10", to: TODAY, account: null, tagIds: [] };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function messagesTile(): string {
  const label = screen.getByText(strings.kpiMessages);
  return label.parentElement?.querySelector("dd")?.textContent ?? "";
}

describe("MetricsScreen", () => {
  it("1. renders no cost section or figure when the report has no cost (supervisor)", () => {
    render(
      <MetricsScreen
        initialReport={report(thirtyDays, 7, false)}
        numbers={NUMBERS}
        tags={[]}
        today={TODAY}
        actions={{ loadMetrics: vi.fn() }}
      />,
    );
    expect(messagesTile()).toBe("10");
    expect(screen.queryByText(strings.costTitle)).toBeNull();
    expect(screen.queryByText(strings.costPerAgentTitle)).toBeNull();
    expect(document.body.textContent).not.toMatch(/US\$|1,23/);
  });

  it("2. a slower, older response never replaces the newest selection", async () => {
    const seven = deferred<MetricsActionResult<MetricsReport>>();
    const ninety = deferred<MetricsActionResult<MetricsReport>>();
    const loadMetrics = vi.fn((filters: MetricsFilters) =>
      filters.from === "2026-10-03" ? seven.promise : ninety.promise,
    );
    render(
      <MetricsScreen
        initialReport={report(thirtyDays, 7, true)}
        numbers={NUMBERS}
        tags={[]}
        today={TODAY}
        actions={{ loadMetrics }}
      />,
    );
    expect(screen.getByText(strings.costTitle)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: strings.presetDays(7) }));
    fireEvent.click(screen.getByRole("button", { name: strings.presetDays(90) }));
    const ninetyFilters = loadMetrics.mock.calls[1]?.[0];
    expect(ninetyFilters).toMatchObject({ from: "2026-07-12", to: TODAY });

    await act(async () => {
      ninety.resolve({ ok: true, data: report(ninetyFilters as MetricsFilters, 90, true) });
      await ninety.promise;
    });
    await act(async () => {
      seven.resolve({
        ok: true,
        data: report(loadMetrics.mock.calls[0]?.[0] as MetricsFilters, 1, true),
      });
      await seven.promise;
    });
    expect(messagesTile()).toBe("93");
    expect(screen.getByRole("button", { name: strings.presetDays(90) })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("3. a failed refetch keeps the previous numbers, shows the error and retries the same filters", async () => {
    const loadMetrics = vi.fn<(f: MetricsFilters) => Promise<MetricsActionResult<MetricsReport>>>();
    loadMetrics.mockResolvedValueOnce({ ok: false, code: "UNKNOWN", message: "Sin conexión" });
    render(
      <MetricsScreen
        initialReport={report(thirtyDays, 7, true)}
        numbers={NUMBERS}
        tags={[]}
        today={TODAY}
        actions={{ loadMetrics }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.presetDays(7) }));
      await Promise.resolve();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión");
    expect(messagesTile()).toBe("10");

    const sevenFilters = loadMetrics.mock.calls[0]?.[0] as MetricsFilters;
    loadMetrics.mockResolvedValueOnce({ ok: true, data: report(sevenFilters, 20, true) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.retry }));
      await Promise.resolve();
    });
    expect(loadMetrics.mock.calls[1]?.[0]).toEqual(sevenFilters);
    expect(messagesTile()).toBe("23");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
