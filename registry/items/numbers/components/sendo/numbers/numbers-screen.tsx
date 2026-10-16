"use client";

import type { AgentMode } from "@quami/sendo";
import { ArrowLeft, Inbox, Lock, MessageCircle, Phone } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { SendoLocale } from "@/lib/sendo-ui";
import { cn } from "@/lib/utils";
import { ConnectButton, pressClass } from "./connect-button";
import { DisconnectDialog } from "./disconnect-dialog";
import { NumberRow, type RowAction } from "./number-row";
import { PurgeDialog } from "./purge-dialog";
import { numbersFormat, resolveNumbersStrings, type NumbersStrings } from "./strings";
import { NumbersStringsContext, type NumbersStringsContextValue } from "./strings-context";
import type {
  EmbeddedSignupClientConfig,
  NumbersActionResult,
  NumbersActions,
  NumbersLinks,
  NumbersMutation,
  NumbersPage,
  NumberView,
} from "./types";

export interface NumbersScreenProps {
  /** The screen's language (`sendoLocale` from `lib/sendo-ui.ts`). */
  locale: SendoLocale;
  /** BCP-47 tag for numbers, e.g. `es-GT`. Defaults to `locale`. */
  formatLocale?: string;
  /** Result of the `list` action (the page calls it on the server). */
  initial: NumbersActionResult<NumbersPage>;
  actions: NumbersActions;
  /** `null` disables connecting (Embedded Signup env vars missing). */
  embeddedSignup: EmbeddedSignupClientConfig | null;
  links: NumbersLinks;
  /** Single strings on top of `locale`'s. */
  strings?: Partial<NumbersStrings>;
  /**
   * Shows "Delete history" on disconnected numbers (needs `actions.purge`). Off by default:
   * deleting is permanent, and when to do it is your retention policy.
   */
  allowPurge?: boolean;
}

/**
 * Keeps the rows where they are (no jumps after a change), appends new numbers, and keeps
 * the `tokenInvalid` mark of untouched rows (only `list`, `connect` and `refreshBilling`
 * check tokens on Meta).
 */
function mergeNumbers(
  current: NumberView[],
  incoming: NumberView[],
  touchedId: string | null,
  tokenChecked: boolean,
): NumberView[] {
  const previous = new Map(current.map((number) => [number.id, number]));
  const next = new Map(incoming.map((number) => [number.id, number]));
  const keep = (number: NumberView): NumberView =>
    tokenChecked && number.id === touchedId
      ? number
      : {
          ...number,
          tokenInvalid: number.active && (previous.get(number.id)?.tokenInvalid ?? false),
        };
  const ordered = current.flatMap((number) => {
    const updated = next.get(number.id);
    return updated === undefined ? [] : [keep(updated)];
  });
  return [...ordered, ...incoming.filter((number) => !previous.has(number.id)).map(keep)];
}

function displayName(number: NumberView): string {
  return number.label ?? number.displayPhone;
}

function Shell({
  links,
  strings,
  children,
}: {
  links: NumbersLinks;
  strings: NumbersStrings;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 bg-[#fafafa] dark:bg-background">
      <nav
        aria-label={strings.navLabel}
        className="hidden w-14 flex-none flex-col items-center gap-1.5 border-r bg-background py-3.5 md:flex"
      >
        <div
          aria-hidden
          className="mb-3 grid size-[30px] place-items-center rounded-[9px] bg-primary text-sm font-bold tracking-tight text-primary-foreground"
        >
          S
        </div>
        <a
          href={links.inbox}
          title={strings.navInbox}
          aria-label={strings.navInbox}
          className={cn(
            "grid size-[38px] place-items-center rounded-[9px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            pressClass,
            "active:scale-[0.94]",
          )}
        >
          <Inbox aria-hidden className="size-[18px]" />
        </a>
        <span
          aria-current="page"
          title={strings.navNumbers}
          className="grid size-[38px] place-items-center rounded-[9px] bg-accent text-foreground"
        >
          <Phone aria-hidden className="size-[18px]" />
          <span className="sr-only">{strings.navNumbers}</span>
        </span>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-5 pb-16 md:px-8 md:pt-8">
          <a
            href={links.inbox}
            className={cn(
              "inline-flex items-center gap-1.5 self-start rounded-md py-1 pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:hidden",
              pressClass,
            )}
          >
            <ArrowLeft aria-hidden className="size-4" />
            {strings.backToInbox}
          </a>
          {children}
        </div>
      </main>
    </div>
  );
}

function Notice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-background px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      {children}
    </div>
  );
}

/**
 * The numbers screen (Flow C): every number of the tenant with its status and, for admins,
 * connect (Embedded Signup), label, default, agent pause and mode, billing re-check and
 * disconnect, export of every number's conversations and, with `allowPurge`, deleting the
 * history of a disconnected number. Non-admins get a read-only list (or nothing, see
 * `numbersVisibleToNonAdmins`).
 */
export function NumbersScreen({
  locale,
  formatLocale: formatLocaleProp,
  initial,
  actions,
  embeddedSignup,
  links,
  strings: overrides,
  allowPurge = false,
}: NumbersScreenProps) {
  const strings = useMemo(() => resolveNumbersStrings(locale, overrides), [locale, overrides]);
  const formatLocale = formatLocaleProp ?? locale;
  const format = useMemo(() => numbersFormat(formatLocale), [formatLocale]);
  const stringsContext = useMemo<NumbersStringsContextValue>(
    () => ({ strings, locale, formatLocale }),
    [strings, locale, formatLocale],
  );
  const [numbers, setNumbers] = useState<NumberView[]>(initial.ok ? initial.data.numbers : []);
  const [pending, setPending] = useState<ReadonlyMap<string, ReadonlySet<RowAction>>>(new Map());
  const [entering, setEntering] = useState<ReadonlySet<string>>(new Set());
  const [disconnecting, setDisconnecting] = useState<NumberView | null>(null);
  const [purging, setPurging] = useState<NumberView | null>(null);

  const access = initial.ok ? initial.data.access : null;
  const canManage = access === "manage";
  const purge = actions.purge;
  const canPurge = allowPurge && purge !== undefined;

  function setRowPending(id: string, action: RowAction, on: boolean) {
    setPending((current) => {
      const next = new Map(current);
      const actions = new Set(next.get(id));
      if (on) actions.add(action);
      else actions.delete(action);
      next.set(id, actions);
      return next;
    });
  }

  function apply(mutation: NumbersMutation, tokenChecked: boolean) {
    setNumbers((current) => mergeNumbers(current, mutation.numbers, mutation.id, tokenChecked));
  }

  function patch(id: string, fields: Partial<NumberView>) {
    setNumbers((current) =>
      current.map((number) => (number.id === id ? { ...number, ...fields } : number)),
    );
  }

  function fail(result: Extract<NumbersActionResult<unknown>, { ok: false }>) {
    toast.error(result.code === "FORBIDDEN" ? strings.noPermission : strings.actionFailed);
  }

  /** Runs a row action; optimistic `fields` are reverted when it fails. */
  async function run(
    number: NumberView,
    action: RowAction,
    call: () => Promise<NumbersActionResult<NumbersMutation>>,
    options: { optimistic?: Partial<NumberView>; tokenChecked?: boolean } = {},
  ): Promise<NumbersMutation | null> {
    const before = number;
    if (options.optimistic !== undefined) patch(number.id, options.optimistic);
    setRowPending(number.id, action, true);
    try {
      const result = await call();
      if (!result.ok) {
        if (options.optimistic !== undefined) {
          const revert = Object.fromEntries(
            Object.keys(options.optimistic).map((key) => [key, before[key as keyof NumberView]]),
          ) as Partial<NumberView>;
          patch(number.id, revert);
        }
        fail(result);
        return null;
      }
      apply(result.data, options.tokenChecked === true);
      return result.data;
    } finally {
      setRowPending(number.id, action, false);
    }
  }

  async function reload() {
    const result = await actions.list();
    if (result.ok) setNumbers(result.data.numbers);
  }

  function connected(mutation: NumbersMutation) {
    const isNew = !numbers.some((number) => number.id === mutation.id);
    apply(mutation, true);
    if (isNew) setEntering((current) => new Set(current).add(mutation.id));
  }

  async function saveLabel(number: NumberView, label: string): Promise<boolean> {
    return (await run(number, "label", () => actions.setLabel(number.id, label))) !== null;
  }

  function pauseAgent(number: NumberView, paused: boolean) {
    void run(number, "pause", () => actions.pauseAgent(number.id, paused), {
      optimistic: { agentPaused: paused },
    }).then((done) => {
      if (done !== null) {
        toast(
          paused
            ? strings.agentPausedOn(displayName(number))
            : strings.agentResumedOn(displayName(number)),
        );
      }
    });
  }

  function agentMode(number: NumberView, mode: AgentMode | null) {
    void run(number, "mode", () => actions.setAgentMode(number.id, mode), {
      optimistic: { agentMode: mode },
    });
  }

  function setDefault(number: NumberView) {
    void run(number, "default", () => actions.setDefault(number.id)).then((done) => {
      if (done !== null) toast.success(strings.defaultSet(displayName(number)));
    });
  }

  function verifyBilling(number: NumberView) {
    void run(number, "billing", () => actions.refreshBilling(number.id), {
      tokenChecked: true,
    }).then((done) => {
      const updated = done?.numbers.find((candidate) => candidate.id === number.id);
      if (updated === undefined || updated.tokenInvalid) return;
      if (updated.billingReady === true) toast.success(strings.billingConfirmed);
      else if (updated.billingReady === false) toast(strings.billingStillMissing);
      else toast(strings.billingStillUnknown);
    });
  }

  async function confirmDisconnect(number: NumberView, confirmation: string): Promise<boolean> {
    const result = await actions.disconnect(number.id, confirmation);
    if (!result.ok) {
      if (result.code === "CONFIRMATION_MISMATCH") toast.error(strings.disconnectMismatch);
      else fail(result);
      return false;
    }
    apply(result.data, true);
    toast.success(strings.disconnected(displayName(number)));
    return true;
  }

  async function confirmPurge(number: NumberView, confirmation: string): Promise<boolean> {
    if (purge === undefined) return false;
    const result = await purge(number.id, confirmation);
    if (!result.ok) {
      if (result.code === "CONFIRMATION_MISMATCH") toast.error(strings.purgeMismatch);
      else fail(result);
      return false;
    }
    apply(result.data, false);
    toast.success(strings.purged(displayName(number)));
    return true;
  }

  let body: ReactNode;
  if (!initial.ok) {
    body = (
      <Notice icon={<Lock aria-hidden className="size-5" />}>
        <p className="text-sm text-muted-foreground">
          {initial.code === "FORBIDDEN" ? strings.forbidden : strings.loadFailed}
        </p>
      </Notice>
    );
  } else if (access === "hidden") {
    body = (
      <Notice icon={<Lock aria-hidden className="size-5" />}>
        <p className="text-sm text-muted-foreground">{strings.hidden}</p>
      </Notice>
    );
  } else if (numbers.length === 0) {
    body = (
      <Notice icon={<MessageCircle aria-hidden className="size-5" />}>
        <div className="grid max-w-sm gap-1">
          <h2 className="font-semibold">{strings.emptyTitle}</h2>
          <p className="text-sm text-muted-foreground">
            {canManage ? strings.emptyDescription : strings.emptyReadOnly}
          </p>
        </div>
        {canManage ? (
          <>
            <ConnectButton
              config={embeddedSignup}
              mode={{ kind: "new", first: true }}
              onConnect={actions.connect}
              onConnected={connected}
              metaRequirementsUrl={links.metaRequirements}
              className="mt-2"
            />
            {embeddedSignup === null ? (
              <p className="max-w-sm text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {strings.connectNotConfigured}
              </p>
            ) : null}
          </>
        ) : null}
      </Notice>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-2.5" aria-label={strings.title}>
        {numbers.map((number) => (
          <NumberRow
            key={number.id}
            number={number}
            canManage={canManage}
            pending={pending.get(number.id) ?? new Set()}
            entering={entering.has(number.id)}
            embeddedSignup={embeddedSignup}
            links={links}
            onConnect={actions.connect}
            onConnected={connected}
            onReconnectFailed={() => void reload()}
            onSaveLabel={saveLabel}
            onPauseAgent={pauseAgent}
            onAgentMode={agentMode}
            onSetDefault={setDefault}
            onVerifyBilling={verifyBilling}
            onDisconnect={setDisconnecting}
            allowPurge={canPurge}
            onPurge={setPurging}
          />
        ))}
      </ul>
    );
  }

  const showHeaderConnect = canManage && numbers.length > 0;

  return (
    <NumbersStringsContext value={stringsContext}>
      <Shell links={links} strings={strings}>
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{strings.title}</h1>
            <p className="text-sm text-muted-foreground">
              {strings.subtitle}
              {initial.ok && access !== "hidden" && numbers.length > 0 ? (
                <>
                  {" "}
                  <span className="whitespace-nowrap tabular-nums">
                    {strings.count(numbers.length, format)}
                  </span>
                </>
              ) : null}
            </p>
          </div>
          {showHeaderConnect ? (
            <ConnectButton
              config={embeddedSignup}
              mode={{ kind: "new", first: false }}
              onConnect={actions.connect}
              onConnected={connected}
              metaRequirementsUrl={links.metaRequirements}
              size="sm"
            />
          ) : null}
        </header>
        {showHeaderConnect && embeddedSignup === null ? (
          <p className="-mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {strings.connectNotConfigured}
          </p>
        ) : null}
        {access === "read" ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-[0.8125rem] text-muted-foreground">
            {strings.readOnlyNotice}
          </p>
        ) : null}
        {body}
        <DisconnectDialog
          number={disconnecting}
          onOpenChange={(open) => {
            if (!open) setDisconnecting(null);
          }}
          onConfirm={confirmDisconnect}
        />
        {canPurge ? (
          <PurgeDialog
            number={purging}
            onOpenChange={(open) => {
              if (!open) setPurging(null);
            }}
            onConfirm={confirmPurge}
          />
        ) : null}
      </Shell>
    </NumbersStringsContext>
  );
}
