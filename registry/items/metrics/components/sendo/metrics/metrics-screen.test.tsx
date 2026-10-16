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
 * 4. AC-RS-2: the screen rendered with `locale="en"` shows Spanish text (or `"es"` English): a
 *    string left out of `metricsStrings`, a hard-coded label or a count, cost, duration or day
 *    formatted in a fixed locale. Checked with every table and the chart's table view, user data
 *    excluded.
 * 5. AC-RS-3: the `strings` prop replaces the locale instead of overriding single keys.
 * 6. AC-RS-1: a locale object missing a key, or a missing locale, still typechecks.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SendoLocale } from "@/lib/sendo-ui";
import { leaksIn } from "../../../../../test/leak";
import { metricsFormat } from "./format";
import { MetricsNotice, MetricsScreen } from "./metrics-screen";
import { metricsStrings, resolveMetricsStrings, type MetricsStrings } from "./strings";
import { summarizeMetrics } from "./summary";
import type {
  MetricsActionResult,
  MetricsFilters,
  MetricsNumberView,
  MetricsRaw,
  MetricsReport,
} from "./types";

const strings = metricsStrings.en;
const format = metricsFormat("en");
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
  return summarizeMetrics({
    filters,
    timeZone: "America/Guatemala",
    raw,
    tags: [],
    formatLocale: "en",
  });
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
        locale="en"
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
    expect(document.body.textContent).not.toMatch(/\$|1[.,]23/);
  });

  it("2. a slower, older response never replaces the newest selection", async () => {
    const seven = deferred<MetricsActionResult<MetricsReport>>();
    const ninety = deferred<MetricsActionResult<MetricsReport>>();
    const loadMetrics = vi.fn((filters: MetricsFilters) =>
      filters.from === "2026-10-03" ? seven.promise : ninety.promise,
    );
    render(
      <MetricsScreen
        locale="en"
        initialReport={report(thirtyDays, 7, true)}
        numbers={NUMBERS}
        tags={[]}
        today={TODAY}
        actions={{ loadMetrics }}
      />,
    );
    expect(screen.getByText(strings.costTitle)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: strings.presetDays(7, format) }));
    fireEvent.click(screen.getByRole("button", { name: strings.presetDays(90, format) }));
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
    expect(screen.getByRole("button", { name: strings.presetDays(90, format) })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("3. a failed refetch keeps the previous numbers, shows the error and retries the same filters", async () => {
    const loadMetrics = vi.fn<(f: MetricsFilters) => Promise<MetricsActionResult<MetricsReport>>>();
    loadMetrics.mockResolvedValueOnce({ ok: false, code: "UNKNOWN", message: "Sin conexión" });
    render(
      <MetricsScreen
        locale="en"
        initialReport={report(thirtyDays, 7, true)}
        numbers={NUMBERS}
        tags={[]}
        today={TODAY}
        actions={{ loadMetrics }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.presetDays(7, format) }));
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

describe("<MetricsScreen> languages (AC-RS-1..3)", () => {
  const TAGS = [
    { id: "t-1", name: "Facturación", color: "amber" as const },
    { id: "t-2", name: "VIP", color: "violet" as const },
  ];
  /** What the app stored: number, tag, person, agent and source names, and the timezone. */
  const USER_DATA = [
    "Recepción",
    "+502 2222 3333",
    "America/Guatemala",
    "Facturación",
    "VIP",
    "María José López",
    "u-9",
    "recepcion",
    "ad:120211",
    "qr:mostrador",
  ];

  function fullReport(formatLocale: string): MetricsReport {
    const day = TODAY;
    const conversation = (id: string, seconds: number | null, tagIds: string[]) => ({
      conversationId: id,
      accountId: "acc-1",
      channel: "whatsapp" as const,
      contactId: `c-${id}`,
      assignedTo: null,
      source: null,
      tagIds,
      day,
      firstInboundAt: new Date(`${day}T15:00:00Z`),
      firstResponseAt: seconds === null ? null : new Date(`${day}T15:05:00Z`),
      responder: seconds === null ? null : ("human" as const),
      responderRef: null,
      seconds,
    });
    const closed = (id: string, aiResolved: boolean, tagIds: string[]) => ({
      conversationId: id,
      accountId: "acc-1",
      channel: "whatsapp" as const,
      source: null,
      tagIds,
      day,
      createdAt: new Date(`${day}T15:00:00Z`),
      closedAt: new Date(`${day}T18:00:00Z`),
      everHuman: !aiResolved,
      humanMessages: aiResolved ? 0 : 2,
      agentMessages: 3,
      aiResolved,
    });
    const assignee = (id: string | null, name: string | null, sent: number) => ({
      day,
      assignee: id,
      name,
      avatarUrl: null,
      conversations: 3,
      messagesSent: sent,
      firstResponses: 2,
      firstResponseSeconds: [45, 4_000],
      medianFirstResponseSeconds: 2_022,
    });
    return summarizeMetrics({
      filters: thirtyDays,
      timeZone: "America/Guatemala",
      tags: TAGS,
      formatLocale,
      raw: {
        daily: [
          {
            day,
            accountId: "acc-1",
            channel: "whatsapp",
            inbound: 12_840,
            outbound: 9_310,
            conversationsStarted: 1,
            conversationsClosed: 3,
            costCents: 0.42,
            tokensIn: 12_000,
            tokensOut: 1_500,
          },
        ],
        byAssignee: [
          assignee("u-1", "María José López", 1_204),
          assignee("u-9", null, 3),
          assignee("business_app", null, 2),
          assignee(null, null, 1),
        ],
        firstResponse: [
          conversation("1", 45, ["t-1"]),
          conversation("2", 200_000, ["t-2", "t-1"]),
          conversation("3", null, []),
        ],
        aiResolution: [closed("1", true, ["t-1"]), closed("4", false, [])],
        bySource: [
          { day, source: null, conversations: 2 },
          { day, source: "ad:120211", conversations: 1 },
          { day, source: "qr:mostrador", conversations: 1 },
        ],
        cost: [
          {
            day,
            agent: "recepcion",
            costCents: 0.42,
            tokensIn: 12_000,
            tokensOut: 1_500,
            turns: 4,
          },
          { day, agent: null, costCents: 0, tokensIn: 0, tokensOut: 0, turns: 0 },
        ],
      },
    });
  }

  it.each([
    ["en", "es"],
    ["es", "en"],
  ] as const)("renders %s without %s strings, user data excluded (AC-RS-2)", (locale, other) => {
    const localized = metricsStrings[locale];
    render(
      <MetricsScreen
        locale={locale}
        initialReport={fullReport(locale)}
        numbers={NUMBERS}
        tags={TAGS}
        today={TODAY}
        actions={{ loadMetrics: vi.fn() }}
      />,
    );
    expect(screen.getByRole("heading", { name: localized.pageTitle })).toBeInTheDocument();
    expect(screen.getByText(localized.businessApp)).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: localized.showTable })) {
      fireEvent.click(button);
    }
    expect(screen.getAllByRole("columnheader", { name: localized.dayColumn })).toHaveLength(2);
    expect(leaksIn(document.body, metricsStrings, locale, other, USER_DATA)).toEqual([]);
  });

  it("renders the notices in the page's locale (AC-RS-2)", () => {
    render(<MetricsNotice kind="forbidden" locale="es" />);
    expect(screen.getByText(metricsStrings.es.forbiddenTitle)).toBeInTheDocument();
    expect(leaksIn(document.body, metricsStrings, "es", "en")).toEqual([]);
  });

  it("overrides single strings on top of the locale (AC-RS-3)", () => {
    render(
      <MetricsScreen
        locale="en"
        strings={{ pageTitle: "Inbox health" }}
        initialReport={report(thirtyDays, 7, false)}
        numbers={NUMBERS}
        tags={[]}
        today={TODAY}
        actions={{ loadMetrics: vi.fn() }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Inbox health" })).toBeInTheDocument();
    expect(screen.getByText(strings.kpiMessages)).toBeInTheDocument();
    expect(resolveMetricsStrings("es", { retry: "Otra vez" }).apply).toBe(metricsStrings.es.apply);
  });

  it("types every locale as a complete MetricsStrings (AC-RS-1)", () => {
    const { pageTitle, ...withoutPageTitle } = metricsStrings.en;
    // @ts-expect-error: a locale object without `pageTitle` is not a MetricsStrings.
    const incomplete: MetricsStrings = withoutPageTitle;
    // @ts-expect-error: every SendoLocale needs its strings object.
    const missingLocale: Record<SendoLocale, MetricsStrings> = { en: metricsStrings.en };
    expect([pageTitle, incomplete, missingLocale]).toHaveLength(3);
  });
});
