"use client";

import type { AgentMode } from "@quami/sendo";
import { ExternalLink, LoaderCircle, MessageCircle, Pencil, Smartphone, Star } from "lucide-react";
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ConnectButton, pressClass } from "./connect-button";
import { useNumbersStrings, type NumbersStrings } from "./strings";
import {
  numberStatus,
  type EmbeddedSignupClientConfig,
  type NumbersActions,
  type NumbersLinks,
  type NumbersMutation,
  type NumberStatus,
  type NumberView,
} from "./types";

export type RowAction = "label" | "pause" | "mode" | "default" | "billing";

export interface NumberRowProps {
  number: NumberView;
  canManage: boolean;
  /** Actions of this row waiting for the server. */
  pending: ReadonlySet<RowAction>;
  /** Just connected in this session: the row rises in once. */
  entering: boolean;
  embeddedSignup: EmbeddedSignupClientConfig | null;
  links: NumbersLinks;
  onConnect: NumbersActions["connect"];
  onConnected: (mutation: NumbersMutation) => void;
  onReconnectFailed: () => void;
  onSaveLabel: (number: NumberView, label: string) => Promise<boolean>;
  onPauseAgent: (number: NumberView, paused: boolean) => void;
  onAgentMode: (number: NumberView, mode: AgentMode | null) => void;
  onSetDefault: (number: NumberView) => void;
  onVerifyBilling: (number: NumberView) => void;
  onDisconnect: (number: NumberView) => void;
}

const INHERIT = "inherit";

const STATUS_STYLE: Record<NumberStatus, { pill: string; dot: string }> = {
  connected: {
    pill: "bg-[#ecfdf3] text-[#067647] dark:bg-emerald-500/15 dark:text-emerald-300",
    dot: "bg-[#1fa855]",
  },
  billing_missing: {
    pill: "bg-[#fef3c7] text-[#b45309] dark:bg-amber-500/15 dark:text-amber-300",
    dot: "bg-[#f59e0b]",
  },
  billing_unknown: {
    pill: "bg-muted text-muted-foreground",
    dot: "bg-zinc-400",
  },
  token_invalid: {
    pill: "bg-destructive/10 text-destructive dark:bg-destructive/20",
    dot: "bg-destructive",
  },
  disconnected: {
    pill: "bg-muted text-muted-foreground",
    dot: "bg-zinc-400",
  },
};

function statusLabel(status: NumberStatus, strings: NumbersStrings): string {
  switch (status) {
    case "connected":
      return strings.statusConnected;
    case "billing_missing":
      return strings.statusBillingMissing;
    case "billing_unknown":
      return strings.statusBillingUnknown;
    case "token_invalid":
      return strings.statusTokenInvalid;
    case "disconnected":
      return strings.statusDisconnected;
  }
}

const rowEnterClass =
  "transition-[opacity,translate] duration-[var(--sendo-dur-menu,200ms)] ease-[var(--sendo-ease-out,cubic-bezier(0.16,1,0.3,1))] starting:translate-y-1.5 starting:opacity-0 motion-reduce:starting:translate-y-0";
const fadeInClass =
  "transition-opacity duration-[var(--sendo-dur-fast,160ms)] ease-[var(--sendo-ease-out,cubic-bezier(0.16,1,0.3,1))] starting:opacity-0";

/** The status pill. A status that changes while the screen is open fades in. */
function StatusPill({ status }: { status: NumberStatus }) {
  const strings = useNumbersStrings();
  const [shown, setShown] = useState(status);
  const [changed, setChanged] = useState(false);
  if (shown !== status) {
    setShown(status);
    setChanged(true);
  }
  const style = STATUS_STYLE[status];
  return (
    <span
      key={status}
      role="status"
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-[0.625rem] px-2 py-0.5 text-[0.71875rem] font-semibold",
        style.pill,
        changed && fadeInClass,
      )}
    >
      <span aria-hidden className={cn("size-1.5 flex-none rounded-full", style.dot)} />
      <span className="min-w-0">{statusLabel(status, strings)}</span>
    </span>
  );
}

function LabelForm({
  number,
  pending,
  onSave,
  onCancel,
}: {
  number: NumberView;
  pending: boolean;
  onSave: (label: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const strings = useNumbersStrings();
  const inputId = useId();
  const [value, setValue] = useState(number.label ?? "");

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await onSave(value)) onCancel();
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-wrap items-center gap-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        {strings.labelInput}
      </label>
      <Input
        id={inputId}
        value={value}
        maxLength={80}
        placeholder={strings.labelPlaceholder}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        className="h-8 w-full min-w-0 sm:w-64"
        autoFocus
        disabled={pending}
      />
      <Button type="submit" size="sm" className={pressClass} disabled={pending}>
        {pending ? (
          <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
        ) : null}
        {strings.labelSave}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={pressClass}
        disabled={pending}
        onClick={onCancel}
      >
        {strings.labelCancel}
      </Button>
    </form>
  );
}

/** One number: identity, status with its fix, agent controls and admin actions. */
export function NumberRow({
  number,
  canManage,
  pending,
  entering,
  embeddedSignup,
  links,
  onConnect,
  onConnected,
  onReconnectFailed,
  onSaveLabel,
  onPauseAgent,
  onAgentMode,
  onSetDefault,
  onVerifyBilling,
  onDisconnect,
}: NumberRowProps) {
  const strings = useNumbersStrings();
  const switchId = useId();
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const status = numberStatus(number);
  const title = number.label ?? number.displayPhone;
  const manageable = canManage && number.active;
  const billingUrl = links.metaBilling.replace("{wabaId}", encodeURIComponent(number.wabaId ?? ""));

  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const verifying = pending.has("billing");
  const verifyButton = (label: string) => (
    <Button
      type="button"
      size="xs"
      variant="outline"
      className={pressClass}
      disabled={verifying}
      onClick={() => {
        onVerifyBilling(number);
      }}
    >
      {verifying ? (
        <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
      ) : null}
      {verifying ? strings.billingVerifying : label}
    </Button>
  );

  return (
    <li
      className={cn(
        "rounded-xl border bg-background px-4 py-3.5",
        !number.active && "bg-muted/40",
        entering && rowEnterClass,
      )}
      data-status={status}
    >
      <div className="flex items-start gap-3">
        <span
          title={strings.channelLabel(number.channel)}
          className={cn(
            "mt-0.5 grid size-10 flex-none place-items-center rounded-full",
            number.active
              ? "bg-[#1fa855]/10 text-[#1a8f48] dark:text-[#4ade80]"
              : "bg-muted text-muted-foreground",
          )}
        >
          <MessageCircle aria-hidden className="size-5" />
          <span className="sr-only">{strings.channelLabel(number.channel)}</span>
        </span>

        <div className="min-w-0 flex-1">
          {editing ? (
            <LabelForm
              number={number}
              pending={pending.has("label")}
              onSave={(label) => onSaveLabel(number, label)}
              onCancel={() => {
                setEditing(false);
              }}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2
                className={cn(
                  "min-w-0 text-[0.9375rem] leading-snug font-semibold [overflow-wrap:anywhere]",
                  !number.active && "text-muted-foreground",
                  number.label === null && "tabular-nums",
                )}
              >
                {title}
              </h2>
              {manageable ? (
                <Button
                  ref={editButton}
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={strings.labelEdit}
                  title={strings.labelEdit}
                  className={cn(pressClass, "text-muted-foreground")}
                  onClick={() => {
                    setEditing(true);
                  }}
                >
                  <Pencil aria-hidden />
                </Button>
              ) : null}
              {number.isDefault ? (
                <span className="inline-flex flex-none items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap text-primary-foreground">
                  <Star aria-hidden className="size-3" />
                  {strings.badgeDefault}
                </span>
              ) : null}
              {number.coexistence ? (
                <span className="inline-flex flex-none items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap text-foreground/80">
                  <Smartphone aria-hidden className="size-3" />
                  {strings.badgeCoexistence}
                </span>
              ) : null}
            </div>
          )}

          <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
            {number.label === null ? null : (
              <>
                <span className="tabular-nums whitespace-nowrap">{number.displayPhone}</span>
                <span aria-hidden> · </span>
              </>
            )}
            <span className="whitespace-nowrap">{strings.channelLabel(number.channel)}</span>
            <span aria-hidden> · </span>
            <span className="whitespace-nowrap">{strings.onboardedVia(number.onboardedVia)}</span>
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={status} />
            {status === "billing_missing" && canManage ? (
              <>
                <Button asChild size="xs" variant="ghost" className={pressClass}>
                  <a href={billingUrl} target="_blank" rel="noopener noreferrer">
                    {strings.billingAdd}
                    <ExternalLink aria-hidden />
                  </a>
                </Button>
                {verifyButton(strings.billingVerify)}
              </>
            ) : null}
            {status === "billing_unknown" && canManage
              ? verifyButton(strings.billingVerifyUnknown)
              : null}
            {(status === "token_invalid" || status === "disconnected") && canManage ? (
              <ConnectButton
                config={embeddedSignup}
                mode={{
                  kind: "reconnect",
                  id: number.id,
                  displayPhone: number.displayPhone,
                  coexistence: number.coexistence,
                }}
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3"
                onConnect={onConnect}
                onConnected={onConnected}
                onReconnectFailed={onReconnectFailed}
                metaRequirementsUrl={links.metaRequirements}
              />
            ) : null}
          </div>
          {status === "token_invalid" ? (
            <p className="mt-1.5 text-[0.78125rem] text-muted-foreground">
              {strings.tokenInvalidHint}
            </p>
          ) : null}
          {status === "disconnected" ? (
            <p className="mt-1.5 text-[0.78125rem] text-muted-foreground">
              {strings.disconnectedHint}
            </p>
          ) : null}
        </div>
      </div>

      {number.active ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 sm:pl-[3.25rem]">
          {canManage ? (
            <div className="flex items-center gap-2">
              <Switch
                id={switchId}
                checked={number.agentPaused}
                disabled={pending.has("pause")}
                onCheckedChange={(checked) => {
                  onPauseAgent(number, checked);
                }}
                className="transition-[background-color,box-shadow,border-color] data-[state=checked]:bg-[#f59e0b] motion-reduce:[&_[data-slot=switch-thumb]]:transition-none"
              />
              <label htmlFor={switchId} className="text-[0.8125rem] whitespace-nowrap select-none">
                {strings.agentPause}
              </label>
            </div>
          ) : (
            <span
              className={cn(
                "text-[0.8125rem] whitespace-nowrap",
                number.agentPaused ? "text-[#b45309] dark:text-amber-300" : "text-muted-foreground",
              )}
            >
              {number.agentPaused ? strings.agentStatusPaused : strings.agentStatusActive}
            </span>
          )}

          {canManage ? (
            <Select
              value={number.agentMode ?? INHERIT}
              disabled={pending.has("mode")}
              onValueChange={(value) => {
                onAgentMode(number, value === "auto" || value === "draft" ? value : null);
              }}
            >
              <SelectTrigger size="sm" aria-label={strings.agentMode} className="min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>{strings.agentModeInherit}</SelectItem>
                <SelectItem value="auto">{strings.agentModeAuto}</SelectItem>
                <SelectItem value="draft">{strings.agentModeDraft}</SelectItem>
              </SelectContent>
            </Select>
          ) : number.agentMode === null ? null : (
            <span className="text-[0.8125rem] whitespace-nowrap text-muted-foreground">
              {number.agentMode === "draft" ? strings.agentModeDraft : strings.agentModeAuto}
            </span>
          )}

          {canManage ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-1 sm:ml-auto sm:w-auto">
              {number.isDefault ? null : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={pressClass}
                  disabled={pending.has("default")}
                  onClick={() => {
                    onSetDefault(number);
                  }}
                >
                  {pending.has("default") ? (
                    <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
                  ) : null}
                  {strings.setDefault}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  pressClass,
                  "text-destructive hover:bg-destructive/10 hover:text-destructive",
                )}
                onClick={() => {
                  onDisconnect(number);
                }}
              >
                {strings.disconnect}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
