// @vitest-environment jsdom
/**
 * `<NumbersScreen>` languages and the disconnected-number controls that live only in the copied
 * UI (the actions and the export route are covered end to end in the playground). One test per
 * way it could fail:
 *
 * 1. AC-RS-2: the screen rendered with `locale="en"` shows Spanish text (or `"es"` English): a
 *    string left out of `numbersStrings`, a hard-coded label or a number formatted in a fixed
 *    locale. Checked with the delete-history dialog open, user data excluded.
 * 2. AC-RS-3: the `strings` prop replaces the locale instead of overriding single keys.
 * 3. AC-RS-1: a locale object missing a key, or a missing locale, still typechecks.
 * 4. AC-DN-4: "Export conversations" is missing for admins, shown to read-only users, or isn't a
 *    plain download link to the export route (the browser's own progress needs a real download).
 * 5. AC-DN-5: "Delete history" shows without `allowPurge`, shows on a connected number, or
 *    calls `purge` before the full number was typed.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SendoLocale } from "@/lib/sendo-ui";
import { leaksIn } from "../../../../../test/leak";
import { NumbersScreen, type NumbersScreenProps } from "./numbers-screen";
import { numbersStrings, resolveNumbersStrings, type NumbersStrings } from "./strings";
import type {
  NumbersAccess,
  NumbersActionResult,
  NumbersActions,
  NumbersMutation,
  NumberView,
} from "./types";

function view(
  overrides: Partial<NumberView> & Pick<NumberView, "id" | "displayPhone">,
): NumberView {
  return {
    channel: "whatsapp",
    label: null,
    phoneNumberId: `PN-${overrides.id}`,
    wabaId: "WABA-1",
    active: true,
    isDefault: false,
    coexistence: false,
    onboardedVia: "embedded_signup",
    agentPaused: false,
    agentMode: null,
    billingReady: true,
    billingCheckedAt: null,
    tokenInvalid: false,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

const NUMBERS: NumberView[] = [
  view({ id: "acc-1", displayPhone: "+502 2200 1001", label: "Torre Vista", isDefault: true }),
  view({ id: "acc-2", displayPhone: "+502 2200 1002", billingReady: false, coexistence: true }),
  view({
    id: "acc-3",
    displayPhone: "+52 55 1234 5678",
    tokenInvalid: true,
    onboardedVia: "manual",
  }),
  view({
    id: "acc-4",
    displayPhone: "+502 2234 5600",
    label: "Recepción",
    active: false,
    onboardedVia: "connect",
  }),
];

/** What the app stored: labels and phones stay as written. */
const USER_DATA = ["Torre Vista", "Recepción", ...NUMBERS.map((number) => number.displayPhone)];

function mutation(
  numbers: NumberView[],
  id: string,
): Promise<NumbersActionResult<NumbersMutation>> {
  return Promise.resolve({ ok: true, data: { numbers, id } });
}

function makeActions(overrides: Partial<NumbersActions> = {}): NumbersActions {
  const unused = () => mutation(NUMBERS, "acc-1");
  return {
    list: () => Promise.resolve({ ok: true, data: { access: "manage", numbers: NUMBERS } }),
    connect: unused,
    setDefault: unused,
    setLabel: unused,
    pauseAgent: unused,
    setAgentMode: unused,
    refreshBilling: unused,
    disconnect: unused,
    purge: (id) =>
      mutation(
        NUMBERS.filter((number) => number.id !== id),
        id,
      ),
    ...overrides,
  };
}

function renderScreen(
  locale: SendoLocale,
  props: Partial<NumbersScreenProps> = {},
  access: NumbersAccess = "manage",
) {
  return render(
    <NumbersScreen
      locale={locale}
      initial={{ ok: true, data: { access, numbers: NUMBERS } }}
      actions={makeActions()}
      embeddedSignup={null}
      links={{
        inbox: "/inbox",
        metaBilling: "https://business.facebook.com/settings/whatsapp-business-accounts/{wabaId}",
        metaRequirements: "https://sendo.dev/docs/embedded-signup",
        export: "/inbox/numbers/export/{id}",
      }}
      {...props}
    />,
  );
}

function row(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { name });
  const item = heading.closest("li");
  if (item === null) throw new Error(`no row for ${name}`);
  return item;
}

describe("<NumbersScreen> languages (AC-RS-1..3)", () => {
  it.each([
    ["en", "es"],
    ["es", "en"],
  ] as const)(
    "renders %s without %s strings, user data excluded (AC-RS-2)",
    async (locale, other) => {
      renderScreen(locale, { allowPurge: true });
      const strings = numbersStrings[locale];
      expect(screen.getByText(strings.count(4, { number: String }))).toBeInTheDocument();
      fireEvent.click(within(row("Recepción")).getByRole("button", { name: strings.purge }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(leaksIn(document.body, numbersStrings, locale, other, USER_DATA)).toEqual([]);
    },
  );

  it("overrides single strings on top of the locale (AC-RS-3)", () => {
    renderScreen("en", { strings: { exportConversations: "Download history" } });
    expect(screen.getAllByText("Download history")).toHaveLength(NUMBERS.length);
    expect(screen.getByText(numbersStrings.en.statusDisconnected)).toBeInTheDocument();
    expect(resolveNumbersStrings("es", { purge: "Eliminar" }).disconnect).toBe(
      numbersStrings.es.disconnect,
    );
  });

  it("types every locale as a complete NumbersStrings (AC-RS-1)", () => {
    const { pageTitle, ...withoutPageTitle } = numbersStrings.en;
    // @ts-expect-error: a locale object without `pageTitle` is not a NumbersStrings.
    const incomplete: NumbersStrings = withoutPageTitle;
    // @ts-expect-error: every SendoLocale needs its strings object.
    const missingLocale: Record<SendoLocale, NumbersStrings> = { en: numbersStrings.en };
    expect([pageTitle, incomplete, missingLocale]).toHaveLength(3);
  });
});

describe("<NumbersScreen> export and delete history (AC-DN-4, AC-DN-5)", () => {
  const en = numbersStrings.en;

  it("links every number to the export route as a download, for admins only (AC-DN-4)", () => {
    const { unmount } = renderScreen("en");
    for (const number of NUMBERS) {
      const link = within(row(number.label ?? number.displayPhone)).getByRole("link", {
        name: en.exportConversations,
      });
      expect(link).toHaveAttribute("href", `/inbox/numbers/export/${number.id}`);
      expect(link).toHaveAttribute("download");
    }
    unmount();

    renderScreen("en", {}, "read");
    expect(screen.queryByRole("link", { name: en.exportConversations })).toBeNull();
  });

  it("hides Delete history unless the app opts in, and only offers it on disconnected numbers (AC-DN-5)", () => {
    const { unmount } = renderScreen("en");
    expect(screen.queryByRole("button", { name: en.purge })).toBeNull();
    unmount();

    renderScreen("en", { allowPurge: true });
    expect(screen.getAllByRole("button", { name: en.purge })).toHaveLength(1);
    expect(within(row("Recepción")).getByRole("button", { name: en.purge })).toBeInTheDocument();
  });

  it("deletes only after the full number is typed (AC-DN-5)", async () => {
    const purge = vi.fn((id: string) =>
      mutation(
        NUMBERS.filter((number) => number.id !== id),
        id,
      ),
    );
    renderScreen("en", { allowPurge: true, actions: makeActions({ purge }) });
    fireEvent.click(within(row("Recepción")).getByRole("button", { name: en.purge }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText(en.purgeConfirmLabel("+502 2234 5600"));
    const confirm = within(dialog).getByRole("button", { name: en.purgeConfirm });

    fireEvent.change(input, { target: { value: "5600" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: "+502 2234 5601" } });
    fireEvent.click(confirm);
    expect(await within(dialog).findByText(en.purgeMismatch)).toBeInTheDocument();
    expect(purge).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "50222345600" } });
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(purge).toHaveBeenCalledWith("acc-4", "50222345600");
    });
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Recepción" })).toBeNull();
    });
  });
});
