"use client";

import { LoaderCircle, Plus, RefreshCw, Smartphone, SmartphoneNfc } from "lucide-react";
import { useEffect, useRef, useState, type SyntheticEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  launchEmbeddedSignup,
  loadFacebookSdk,
  type EmbeddedSignupOutcome,
  type FacebookSdk,
} from "@/lib/sendo-embedded-signup";
import { useNumbersStrings, type NumbersStrings } from "./strings";
import type {
  EmbeddedSignupClientConfig,
  NumbersActionResult,
  NumbersActions,
  NumbersMutation,
} from "./types";

export type ConnectMode =
  | { kind: "new"; first: boolean }
  | { kind: "reconnect"; id: string; displayPhone: string; coexistence: boolean };

export interface ConnectButtonProps {
  /** `null` disables connecting (Embedded Signup env vars missing). */
  config: EmbeddedSignupClientConfig | null;
  mode: ConnectMode;
  onConnect: NumbersActions["connect"];
  onConnected: (mutation: NumbersMutation) => void;
  /** A reconnect failed after the server may have disconnected the number: reload the list. */
  onReconnectFailed?: () => void;
  metaRequirementsUrl: string;
  className?: string;
  size?: "sm" | "default";
  variant?: "default" | "outline";
}

type SdkState = "loading" | "ready" | "failed";

const PIN_RE = /^\d{6}$/;
export const pressClass =
  "transition-[scale,background-color,border-color,color,opacity] duration-[var(--sendo-dur-press,120ms)] ease-[var(--sendo-ease-out,cubic-bezier(0.16,1,0.3,1))] active:scale-[0.97] motion-reduce:active:scale-100";

function outcomeError(
  outcome: Exclude<EmbeddedSignupOutcome, { status: "finish" | "cancel" }>,
  strings: NumbersStrings,
): string {
  return outcome.reason === "no_number" ? strings.signupNoNumber : strings.signupMetaError;
}

function showFailure(
  result: Extract<NumbersActionResult<unknown>, { ok: false }>,
  strings: NumbersStrings,
  mode: ConnectMode,
  metaRequirementsUrl: string,
): void {
  switch (result.code) {
    case "SIGNUP_CODE_EXPIRED":
      toast.error(strings.signupCodeExpired);
      return;
    case "META_PERMISSION_MISSING":
      toast.error(strings.signupPermissionMissing, {
        action: {
          label: strings.signupPermissionDocs,
          onClick: () => window.open(metaRequirementsUrl, "_blank", "noopener,noreferrer"),
        },
      });
      return;
    case "ACCOUNT_EXISTS":
      toast.error(strings.signupAccountExists);
      return;
    case "ALREADY_CONNECTED":
      toast.error(strings.signupAlreadyConnected);
      return;
    case "WRONG_NUMBER":
      toast.error(strings.signupWrongNumber(mode.kind === "reconnect" ? mode.displayPhone : ""));
      return;
    case "CONFIG_ERROR":
      toast.error(strings.signupConfigError);
      return;
    case "FORBIDDEN":
      toast.error(strings.noPermission);
      return;
    default:
      toast.error(strings.signupFailed);
  }
}

/**
 * "Conectar WhatsApp": opens Meta's Embedded Signup (new number or the coexistence flavour),
 * hands the result to the `connect` server action and maps every failure to a Spanish
 * message. A number with two-step verification asks for its PIN and opens Meta again
 * (the first code is already spent).
 */
export function ConnectButton({
  config,
  mode,
  onConnect,
  onConnected,
  onReconnectFailed,
  metaRequirementsUrl,
  className,
  size = "default",
  variant = "default",
}: ConnectButtonProps) {
  const strings = useNumbersStrings();
  const sdkRef = useRef<FacebookSdk | null>(null);
  const [sdkState, setSdkState] = useState<SdkState>("loading");
  const [busy, setBusy] = useState(false);
  const [chooseOpen, setChooseOpen] = useState(false);
  const [pinFor, setPinFor] = useState<{ coexistence: boolean } | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);

  const appId = config?.appId;
  const graphVersion = config?.graphVersion;
  const sdkUrl = config?.sdkUrl;

  useEffect(() => {
    if (appId === undefined || graphVersion === undefined) return;
    let cancelled = false;
    loadFacebookSdk({ appId, version: graphVersion, sdkUrl }).then(
      (sdk) => {
        if (cancelled) return;
        sdkRef.current = sdk;
        setSdkState("ready");
      },
      () => {
        if (!cancelled) setSdkState("failed");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [appId, graphVersion, sdkUrl]);

  const reconnectId = mode.kind === "reconnect" ? mode.id : undefined;

  async function finish(outcome: EmbeddedSignupOutcome, coexistence: boolean, withPin?: string) {
    if (outcome.status === "cancel") {
      toast(strings.signupCancelled);
      return;
    }
    if (outcome.status === "error") {
      toast.error(outcomeError(outcome, strings));
      return;
    }
    const result = await onConnect({
      code: outcome.code,
      wabaId: outcome.wabaId,
      phoneNumberId: outcome.phoneNumberId,
      coexistence: outcome.coexistence || coexistence,
      ...(withPin !== undefined && { pin: withPin }),
      ...(reconnectId !== undefined && { reconnectId }),
    });
    if (result.ok) {
      const connected = result.data.numbers.find((number) => number.id === result.data.id);
      const phone = connected?.label ?? connected?.displayPhone ?? "";
      toast.success(
        mode.kind === "reconnect" ? strings.reconnected(phone) : strings.connected(phone),
      );
      onConnected(result.data);
      return;
    }
    if (result.code === "PIN_CONFLICT") {
      setPin("");
      setPinError(false);
      setPinFor({ coexistence });
      return;
    }
    showFailure(result, strings, mode, metaRequirementsUrl);
    if (mode.kind === "reconnect" && result.code !== "WRONG_NUMBER") onReconnectFailed?.();
  }

  /** Must run synchronously inside the click/submit handler (popup blockers). */
  function start(coexistence: boolean, withPin?: string) {
    const sdk = sdkRef.current;
    if (config === null || sdk === null || busy) return;
    setBusy(true);
    const pending = launchEmbeddedSignup(sdk, {
      configId: config.configId,
      coexistence,
      ...(config.trustedOrigins !== undefined && { trustedOrigins: config.trustedOrigins }),
    });
    void pending
      .then((outcome) => finish(outcome, coexistence, withPin))
      .catch(() => {
        toast.error(strings.signupFailed);
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function onClick() {
    if (sdkState === "failed") {
      toast.error(strings.sdkLoadFailed);
      return;
    }
    if (mode.kind === "reconnect") {
      start(mode.coexistence);
      return;
    }
    if (config?.coexistence === false) {
      start(false);
      return;
    }
    setChooseOpen(true);
  }

  function choose(coexistence: boolean) {
    setChooseOpen(false);
    start(coexistence);
  }

  function submitPin(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pinFor === null) return;
    if (!PIN_RE.test(pin)) {
      setPinError(true);
      return;
    }
    const { coexistence } = pinFor;
    setPinFor(null);
    start(coexistence, pin);
  }

  const disabled = config === null || sdkState === "loading" || busy;
  const Icon = mode.kind === "reconnect" ? RefreshCw : Plus;
  const label =
    mode.kind === "reconnect"
      ? strings.reconnect
      : mode.first
        ? strings.connectFirst
        : strings.connectAnother;

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        disabled={disabled}
        aria-busy={busy || (config !== null && sdkState === "loading")}
        title={config === null ? strings.connectNotConfigured : undefined}
        onClick={onClick}
        className={cn(pressClass, className)}
      >
        {busy ? (
          <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Icon aria-hidden />
        )}
        {busy ? strings.connecting : label}
      </Button>

      <Dialog open={chooseOpen} onOpenChange={setChooseOpen}>
        <DialogContent className="sm:max-w-md motion-reduce:[--tw-enter-scale:1] motion-reduce:[--tw-exit-scale:1]">
          <DialogHeader>
            <DialogTitle>{strings.connectChooseTitle}</DialogTitle>
            <DialogDescription>{strings.connectChooseDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <ChoiceButton
              icon={<Smartphone aria-hidden className="size-5" />}
              title={strings.connectCloudTitle}
              description={strings.connectCloudDescription}
              onClick={() => {
                choose(false);
              }}
            />
            <ChoiceButton
              icon={<SmartphoneNfc aria-hidden className="size-5" />}
              title={strings.connectCoexistenceTitle}
              description={strings.connectCoexistenceDescription}
              onClick={() => {
                choose(true);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pinFor !== null}
        onOpenChange={(open) => {
          if (!open) setPinFor(null);
        }}
      >
        <DialogContent className="sm:max-w-sm motion-reduce:[--tw-enter-scale:1] motion-reduce:[--tw-exit-scale:1]">
          <form onSubmit={submitPin} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{strings.pinTitle}</DialogTitle>
              <DialogDescription>{strings.pinDescription}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <label htmlFor="sendo-numbers-pin" className="text-sm font-medium">
                {strings.pinLabel}
              </label>
              <Input
                id="sendo-numbers-pin"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={pin}
                aria-invalid={pinError}
                aria-describedby={pinError ? "sendo-numbers-pin-error" : undefined}
                onChange={(event) => {
                  setPin(event.target.value.replace(/\D/g, "").slice(0, 6));
                  setPinError(false);
                }}
                className="font-mono tracking-[0.3em] tabular-nums"
                autoFocus
              />
              {pinError ? (
                <p id="sendo-numbers-pin-error" className="text-destructive text-sm">
                  {strings.pinInvalid}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className={pressClass}
                onClick={() => {
                  setPinFor(null);
                }}
              >
                {strings.cancel}
              </Button>
              <Button type="submit" className={pressClass}>
                {strings.pinSubmit}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChoiceButton({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border bg-background p-3 text-left outline-none hover:border-ring hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
        pressClass,
        "active:scale-[0.99]",
      )}
    >
      <span className="mt-0.5 grid size-9 flex-none place-items-center rounded-full bg-[#1fa855]/10 text-[#1a8f48] dark:text-[#4ade80]">
        {icon}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground text-sm">{description}</span>
      </span>
    </button>
  );
}
