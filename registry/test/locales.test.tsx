// @vitest-environment jsdom
/**
 * The six UI items side by side (SNL-7.3): one table instead of six separate conventions. Each
 * item's own test goes deeper (dialogs, tables, charts); this one makes sure no item is left out
 * and that they all follow the same rules.
 *
 * Ways it could fail (one test each):
 * 1. A UI item in registry.json (a seventh, or a renamed one) has no row here, so nothing checks
 *    its languages.
 * 2. AC-RS-2: a root screen rendered with `locale="en"` shows Spanish (or `"es"` English) in its
 *    default state, user data excluded.
 * 3. AC-RS-1 / AC-RS-2 (type level): a locale object missing a key, a missing locale, or a root
 *    screen rendered without `locale` still typechecks, in any of the six items.
 * 4. AC-RS-4: registry UI code hard-codes a locale (`"es-GT"`, `"en-US"`…) or formats with the
 *    runtime's default locale (`toLocaleString()`, `new Intl.NumberFormat()`), instead of taking
 *    `formatLocale`.
 */
import { render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import type { SendoLocale } from "@/lib/sendo-ui";
import {
  BroadcastsScreen,
  type BroadcastsScreenProps,
} from "../items/broadcasts/components/sendo/broadcasts/broadcasts-screen";
import {
  broadcastsStrings,
  type BroadcastsStrings,
} from "../items/broadcasts/components/sendo/broadcasts/strings";
import type { BroadcastsActions } from "../items/broadcasts/components/sendo/broadcasts/types";
import { Inbox, type InboxProps } from "../items/inbox/components/sendo/inbox";
import { inboxStrings, type InboxStrings } from "../items/inbox/components/sendo/strings";
import {
  MetricsScreen,
  type MetricsScreenProps,
} from "../items/metrics/components/sendo/metrics/metrics-screen";
import {
  metricsStrings,
  type MetricsStrings,
} from "../items/metrics/components/sendo/metrics/strings";
import { summarizeMetrics } from "../items/metrics/components/sendo/metrics/summary";
import {
  NumbersScreen,
  type NumbersScreenProps,
} from "../items/numbers/components/sendo/numbers/numbers-screen";
import {
  numbersStrings,
  type NumbersStrings,
} from "../items/numbers/components/sendo/numbers/strings";
import type { NumbersActions, NumberView } from "../items/numbers/components/sendo/numbers/types";
import {
  LinksScreen,
  type LinksScreenProps,
} from "../items/widgets/components/sendo/widgets/links-screen";
import {
  widgetsStrings,
  type WidgetsStrings,
} from "../items/widgets/components/sendo/widgets/strings";
import {
  RulesScreen,
  type RulesScreenProps,
} from "../items/workflows/components/sendo/workflows/rules-screen";
import {
  workflowsStrings,
  type WorkflowsStrings,
} from "../items/workflows/components/sendo/workflows/strings";
import type { RuleRowView } from "../items/workflows/components/sendo/workflows/types";
import { makeActions, makeConversation, mockViewport } from "./inbox-factories";
import { leaksIn, visibleText } from "./leak";

const REGISTRY = path.resolve(import.meta.dirname, "..");

/** Actions that never answer: the screens keep the state their props gave them. */
function idle<T extends object>(shape: T): T {
  return new Proxy(shape, { get: () => () => new Promise(() => undefined) });
}

const PHONE = "+502 2200 1001";
const OTHER_PHONE = "+502 2200 1002";
/** Stored data shown on every screen (labels, phones, names): excluded from the leak check. */
const USER_DATA = ["Torre Vista", PHONE, OTHER_PHONE, "Diego Hernández", "+50255550001", "garita"];

const NUMBER: NumberView = {
  id: "acc-1",
  channel: "whatsapp",
  label: "Torre Vista",
  displayPhone: PHONE,
  phoneNumberId: "PN-1",
  wabaId: "WABA-1",
  active: true,
  isDefault: true,
  coexistence: false,
  onboardedVia: "embedded_signup",
  agentPaused: false,
  agentMode: null,
  billingReady: true,
  billingCheckedAt: null,
  tokenInvalid: false,
  createdAt: new Date(0).toISOString(),
};

const RULE: RuleRowView = {
  id: "r-1",
  key: "garita",
  type: "auto_close",
  params: { afterDays: 7 },
  accountId: null,
  position: 0,
  active: true,
  origin: "screen",
  valid: true,
  error: null,
  updatedBy: null,
  updatedByName: null,
  updatedAt: "2026-10-01T12:00:00.000Z",
};

interface Row {
  item: string;
  strings: Record<SendoLocale, object>;
  /** Text the screen shows once rendered (its title). */
  heading: (locale: SendoLocale) => string;
  render: (locale: SendoLocale) => ReactElement;
}

const ROWS: Row[] = [
  {
    item: "inbox",
    strings: inboxStrings,
    heading: (locale) => inboxStrings[locale].pageTitle,
    render: (locale) => {
      const conversation = makeConversation({ lastMessagePreview: null });
      return (
        <Inbox
          locale={locale}
          currentUser={{ id: "user-1", name: "Diego Hernández" }}
          tenantId="tenant-1"
          realtimeClient={null}
          actions={makeActions({}, conversation)}
          numbers={[]}
          tags={[]}
          initialPage={{ items: [conversation], nextCursor: null, counts: null }}
        />
      );
    },
  },
  {
    item: "numbers",
    strings: numbersStrings,
    heading: (locale) => numbersStrings[locale].title,
    render: (locale) => (
      <NumbersScreen
        locale={locale}
        initial={{
          ok: true,
          data: {
            access: "manage",
            numbers: [
              NUMBER,
              {
                ...NUMBER,
                id: "acc-2",
                label: null,
                displayPhone: OTHER_PHONE,
                isDefault: false,
                active: false,
              },
            ],
          },
        }}
        actions={idle({} as NumbersActions)}
        embeddedSignup={null}
        links={{
          inbox: "/inbox",
          metaBilling: "https://business.facebook.com/settings/whatsapp-business-accounts/{wabaId}",
          metaRequirements: "https://sendo.quami.dev/docs/embedded-signup",
          export: "/inbox/numbers/export/{id}",
        }}
        allowPurge
      />
    ),
  },
  {
    item: "broadcasts",
    strings: broadcastsStrings,
    heading: (locale) => broadcastsStrings[locale].pageTitle,
    render: (locale) => (
      <BroadcastsScreen
        locale={locale}
        numbers={[
          {
            id: "acc-1",
            label: "Torre Vista",
            displayPhone: PHONE,
            isDefault: true,
            active: true,
            billingReady: true,
          },
        ]}
        initialBroadcasts={{ items: [], nextCursor: null }}
        actions={idle({} as BroadcastsActions)}
        syncUrl={false}
      />
    ),
  },
  {
    item: "metrics",
    strings: metricsStrings,
    heading: (locale) => metricsStrings[locale].pageTitle,
    render: (locale) => (
      <MetricsScreen
        locale={locale}
        initialReport={summarizeMetrics({
          filters: { from: "2026-09-10", to: "2026-10-09", account: null, tagIds: [] },
          timeZone: "America/Guatemala",
          raw: {
            daily: [],
            byAssignee: [],
            firstResponse: [],
            aiResolution: [],
            bySource: [],
            cost: null,
          },
          tags: [],
          formatLocale: locale,
        })}
        numbers={[
          {
            id: "acc-1",
            label: "Torre Vista",
            displayPhone: PHONE,
            isDefault: true,
            active: true,
            timezone: "America/Guatemala",
          },
        ]}
        tags={[]}
        today="2026-10-09"
        actions={idle({} as MetricsScreenProps["actions"])}
      />
    ),
  },
  {
    item: "widgets",
    strings: widgetsStrings,
    heading: (locale) => widgetsStrings[locale].pageTitle,
    render: (locale) => (
      <LinksScreen
        locale={locale}
        numbers={[{ id: "acc-1", label: "Torre Vista", displayPhone: PHONE, isDefault: true }]}
        sources={[{ source: "garita", conversations: 1_234 }]}
        initialDraft={{ account: "acc-1", text: "", source: "garita" }}
        initialLink={null}
        actions={idle({} as LinksScreenProps["actions"])}
      />
    ),
  },
  {
    item: "workflows",
    strings: workflowsStrings,
    heading: (locale) => workflowsStrings[locale].pageTitle,
    render: (locale) => (
      <RulesScreen
        locale={locale}
        initialRules={[RULE]}
        numbers={[
          {
            id: "acc-1",
            label: "Torre Vista",
            displayPhone: PHONE,
            phoneNumberId: "PN-1",
            active: true,
          },
        ]}
        actions={idle({} as RulesScreenProps["actions"])}
        currentUserId="user-1"
      />
    ),
  },
];

/** Every row in both languages: [item, locale, row]. */
const CASES = ROWS.flatMap((row) =>
  (["en", "es"] as const).map((locale) => [row.item, locale, row] as const),
);

type ManifestFile = { path: string; type: string; target?: string };
const manifest = JSON.parse(readFileSync(path.join(REGISTRY, "registry.json"), "utf8")) as {
  items: { name: string; files: ManifestFile[] }[];
};
const uiItems = manifest.items.filter((item) =>
  item.files.some((file) => file.path.endsWith(".tsx")),
);

describe("the six UI items' languages", () => {
  beforeEach(() => {
    mockViewport(true);
  });

  it("1. every UI item in registry.json has a row in this table", () => {
    expect(ROWS.map((row) => row.item).sort()).toEqual(uiItems.map((item) => item.name).sort());
  });

  it.each(CASES)(
    "2. AC-RS-2: %s rendered in %s shows nothing of the other language",
    async (_item, locale, row) => {
      const other: SendoLocale = locale === "en" ? "es" : "en";
      render(row.render(locale));
      expect(await screen.findAllByText(row.heading(locale))).not.toHaveLength(0);
      expect(visibleText(document.body).length).toBeGreaterThan(80);
      expect(leaksIn(document.body, row.strings, locale, other, USER_DATA)).toEqual([]);
    },
  );

  it("3. AC-RS-1 / AC-RS-2 types: every item needs every key, every locale and the locale prop", () => {
    const without = <T extends { pageTitle: string }>({ pageTitle, ...rest }: T) => {
      expect(pageTitle).not.toBe("");
      return rest;
    };
    // @ts-expect-error: a locale object without `pageTitle` is not an InboxStrings.
    const inbox: InboxStrings = without(inboxStrings.en);
    // @ts-expect-error: a locale object without `pageTitle` is not a NumbersStrings.
    const numbers: NumbersStrings = without(numbersStrings.en);
    // @ts-expect-error: a locale object without `pageTitle` is not a BroadcastsStrings.
    const broadcasts: BroadcastsStrings = without(broadcastsStrings.en);
    // @ts-expect-error: a locale object without `pageTitle` is not a MetricsStrings.
    const metrics: MetricsStrings = without(metricsStrings.en);
    // @ts-expect-error: a locale object without `pageTitle` is not a WidgetsStrings.
    const widgets: WidgetsStrings = without(widgetsStrings.en);
    // @ts-expect-error: a locale object without `pageTitle` is not a WorkflowsStrings.
    const workflows: WorkflowsStrings = without(workflowsStrings.en);

    const missingLocale = [
      // @ts-expect-error: every SendoLocale needs its strings object.
      { en: inboxStrings.en } satisfies Record<SendoLocale, InboxStrings>,
      // @ts-expect-error: every SendoLocale needs its strings object.
      { en: numbersStrings.en } satisfies Record<SendoLocale, NumbersStrings>,
      // @ts-expect-error: every SendoLocale needs its strings object.
      { en: broadcastsStrings.en } satisfies Record<SendoLocale, BroadcastsStrings>,
      // @ts-expect-error: every SendoLocale needs its strings object.
      { en: metricsStrings.en } satisfies Record<SendoLocale, MetricsStrings>,
      // @ts-expect-error: every SendoLocale needs its strings object.
      { en: widgetsStrings.en } satisfies Record<SendoLocale, WidgetsStrings>,
      // @ts-expect-error: every SendoLocale needs its strings object.
      { en: workflowsStrings.en } satisfies Record<SendoLocale, WorkflowsStrings>,
    ];

    type WithoutLocale<P> = Omit<P, "locale">;
    const rootsWithoutLocale = [
      // @ts-expect-error: <Inbox> needs `locale`.
      {} as WithoutLocale<InboxProps> satisfies InboxProps,
      // @ts-expect-error: <NumbersScreen> needs `locale`.
      {} as WithoutLocale<NumbersScreenProps> satisfies NumbersScreenProps,
      // @ts-expect-error: <BroadcastsScreen> needs `locale`.
      {} as WithoutLocale<BroadcastsScreenProps> satisfies BroadcastsScreenProps,
      // @ts-expect-error: <MetricsScreen> needs `locale`.
      {} as WithoutLocale<MetricsScreenProps> satisfies MetricsScreenProps,
      // @ts-expect-error: <LinksScreen> needs `locale`.
      {} as WithoutLocale<LinksScreenProps> satisfies LinksScreenProps,
      // @ts-expect-error: <RulesScreen> needs `locale`.
      {} as WithoutLocale<RulesScreenProps> satisfies RulesScreenProps,
    ];
    expect([inbox, numbers, broadcasts, metrics, widgets, workflows]).toHaveLength(6);
    expect(missingLocale).toHaveLength(6);
    expect(rootsWithoutLocale).toHaveLength(6);
  });

  it("4. AC-RS-4: no hard-coded or runtime-default locale in registry UI code", () => {
    /** Day keys (`YYYY-MM-DD`) use en-CA as a format trick, never for display. */
    const ALLOWED = [/"en-CA"/, /^\s*(?:locale|formatLocale): "en",$/];
    const problems: string[] = [];
    let scanned = 0;
    for (const item of uiItems) {
      for (const file of item.files) {
        if (!/\.tsx?$/.test(file.path) || /\.test\.tsx?$/.test(file.path)) continue;
        if (file.target === "lib/sendo-ui.ts") continue; // the SendoLocale union and the app's choice
        const absolute = path.resolve(REGISTRY, "..", file.path);
        if (!existsSync(absolute)) continue;
        scanned += 1;
        const code = readFileSync(absolute, "utf8")
          .replace(/\/\*[^]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
          .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
        code.split("\n").forEach((line, index) => {
          const where = `${file.path}:${String(index + 1)}`;
          const literal = /(["'`])(?:es|en)(?:-[A-Za-z]{2,4})?\1/.exec(line);
          if (literal && !ALLOWED.some((allowed) => allowed.test(line))) {
            problems.push(`${where}: locale literal ${literal[0]}`);
          }
          if (/\.toLocale(?:Date|Time)?String\(\s*\)/.test(line)) {
            problems.push(`${where}: toLocale*String() without formatLocale`);
          }
          if (
            /\bIntl\.[A-Za-z]+\(\s*(?:undefined\b|\))/.test(line) &&
            !line.includes(".resolvedOptions().timeZone")
          ) {
            problems.push(`${where}: Intl formatter on the runtime's default locale`);
          }
        });
      }
    }
    expect(problems).toEqual([]);
    expect(scanned).toBeGreaterThan(40);
  });
});
