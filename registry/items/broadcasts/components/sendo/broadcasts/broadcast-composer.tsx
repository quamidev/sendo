"use client";

import { AlertTriangle, ArrowLeft, ChevronDown, ExternalLink, Info, Users } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fillTemplate, type BroadcastsFormat } from "./format";
import { BackLink, Callout, ErrorBar } from "./parts";
import { pressClass, viewEnterClass } from "./press";
import type { BroadcastsStrings } from "./strings";
import { useBroadcastsFormat, useBroadcastsStrings } from "./strings-context";
import {
  DEFAULT_RATE,
  MAX_RATE,
  SKIP_REASONS,
  type BroadcastAudienceView,
  type BroadcastDraft,
  type BroadcastNumberView,
  type BroadcastPreviewView,
  type BroadcastsActionResult,
  type BroadcastsActions,
  type BroadcastsLinks,
  type BroadcastSummaryView,
  type BroadcastTemplateView,
} from "./types";

export interface BroadcastComposerProps {
  /** Connected numbers of the tenant. */
  numbers: BroadcastNumberView[];
  actions: Pick<
    BroadcastsActions,
    "listTemplates" | "listAudiences" | "previewBroadcast" | "createBroadcast"
  >;
  links: BroadcastsLinks;
  onCancel: () => void;
  onCreated: (broadcast: BroadcastSummaryView) => void;
}

type Loadable<T> = { state: "loading" } | { state: "failed" } | { state: "ready"; items: T[] };
interface Keyed<T> {
  key: string;
  value: Loadable<T>;
}

export function errorText(
  result: Extract<BroadcastsActionResult<unknown>, { ok: false }>,
  strings: BroadcastsStrings,
  format: BroadcastsFormat,
): string {
  if (result.code === "VARIABLES" && result.expected !== undefined) {
    return strings.variablesError(result.expected, format);
  }
  return strings.errors[result.code];
}

const templateKey = (template: Pick<BroadcastTemplateView, "name" | "language">) =>
  `${template.name}\u0000${template.language}`;

/**
 * Flow H steps 1–3: number, approved template, variables, recipients (the app's lists) and
 * rate → "Review broadcast" (`previewBroadcast`) → the review with the counts and the cost note →
 * "Send to N contacts" (`createBroadcast`), disabled when nobody is eligible.
 */
export function BroadcastComposer({
  numbers,
  actions,
  links,
  onCancel,
  onCreated,
}: BroadcastComposerProps) {
  const strings = useBroadcastsStrings();
  const format = useBroadcastsFormat();
  const id = useId();
  const initialNumber = numbers.find((number) => number.isDefault) ?? numbers[0];
  const [account, setAccount] = useState(initialNumber?.id ?? "");
  const [templatesFor, setTemplatesFor] = useState<Keyed<BroadcastTemplateView> | null>(null);
  const [audiencesFor, setAudiencesFor] = useState<Keyed<BroadcastAudienceView> | null>(null);
  const [template, setTemplate] = useState("");
  const [variables, setVariables] = useState<string[]>([]);
  const [audience, setAudience] = useState("");
  const [rate, setRate] = useState(String(DEFAULT_RATE));
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    draft: BroadcastDraft;
    preview: BroadcastPreviewView;
  } | null>(null);
  const [reload, setReload] = useState(0);

  // Templates and lists load per number; `key` tells a stale answer from the current one.
  const key = `${account}|${String(reload)}`;
  const templates: Loadable<BroadcastTemplateView> =
    templatesFor?.key === key ? templatesFor.value : { state: "loading" };
  const audiences: Loadable<BroadcastAudienceView> =
    audiencesFor?.key === key ? audiencesFor.value : { state: "loading" };

  useEffect(() => {
    if (account === "") return;
    let live = true;
    const settle = <T,>(
      promise: Promise<BroadcastsActionResult<T[]>>,
      set: (value: Keyed<T>) => void,
    ) => {
      promise.then(
        (result) => {
          if (live) {
            set({
              key,
              value: result.ok ? { state: "ready", items: result.data } : { state: "failed" },
            });
          }
        },
        () => {
          if (live) set({ key, value: { state: "failed" } });
        },
      );
    };
    settle(actions.listTemplates(account), setTemplatesFor);
    settle(actions.listAudiences(account), setAudiencesFor);
    return () => {
      live = false;
    };
  }, [account, actions, key]);

  const number = numbers.find((candidate) => candidate.id === account) ?? null;
  const templateList = templates.state === "ready" ? templates.items : [];
  const selectedTemplate = templateList.find((item) => templateKey(item) === template) ?? null;
  const audienceList = audiences.state === "ready" ? audiences.items : [];
  const selectedAudience = audienceList.find((item) => item.id === audience) ?? null;

  const filled = variables.filter((value) => value.trim() !== "").length;
  const variablesOk = filled === 0 || filled === variables.length;
  const rateValue = Number(rate);
  const rateOk = /^\d+$/.test(rate.trim()) && rateValue >= 1 && rateValue <= MAX_RATE;
  const ready =
    number !== null &&
    selectedTemplate !== null &&
    selectedAudience !== null &&
    variablesOk &&
    rateOk;

  function chooseTemplate(key: string) {
    setTemplate(key);
    const next = templateList.find((item) => templateKey(item) === key);
    setVariables(Array.from({ length: next?.variableCount ?? 0 }, () => ""));
  }

  function chooseAccount(next: string) {
    setAccount(next);
    setTemplate("");
    setVariables([]);
    setAudience("");
  }

  async function runPreview() {
    setAttempted(true);
    if (!ready || busy !== null) return;
    const draft: BroadcastDraft = {
      account: number.id,
      template: selectedTemplate.name,
      language: selectedTemplate.language,
      audience: selectedAudience.id,
      variables: filled === 0 ? null : variables.map((value) => value.trim()),
      ratePerMinute: rateValue,
    };
    setBusy("preview");
    setError(null);
    try {
      const result = await actions.previewBroadcast(draft);
      if (result.ok) setReview({ draft, preview: result.data });
      else setError(errorText(result, strings, format));
    } catch {
      setError(strings.errors.UNKNOWN);
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (review === null || review.preview.eligible === 0 || busy !== null) return;
    setBusy("create");
    setError(null);
    try {
      const result = await actions.createBroadcast(review.draft);
      if (result.ok) {
        onCreated(result.data);
        return;
      }
      setError(errorText(result, strings, format));
    } catch {
      setError(strings.errors.UNKNOWN);
    }
    setBusy(null);
  }

  if (
    review !== null &&
    number !== null &&
    selectedTemplate !== null &&
    selectedAudience !== null
  ) {
    return (
      <ReviewStep
        preview={review.preview}
        number={number}
        template={selectedTemplate}
        audience={selectedAudience}
        links={links}
        busy={busy === "create"}
        error={error}
        onDismissError={() => {
          setError(null);
        }}
        onBack={() => {
          setReview(null);
          setError(null);
        }}
        onConfirm={() => void confirm()}
      />
    );
  }

  const fieldIds = {
    number: `${id}-number`,
    template: `${id}-template`,
    rate: `${id}-rate`,
    rateHint: `${id}-rate-hint`,
  };

  return (
    <form
      key="form"
      className={cn("flex flex-col gap-5", viewEnterClass)}
      onSubmit={(event) => {
        event.preventDefault();
        void runPreview();
      }}
    >
      <BackLink label={strings.backToList} onClick={onCancel} />
      <header className="-mt-2 flex flex-col gap-1">
        <h2 className="text-[17px] font-[650] tracking-[-0.01em]">{strings.composeTitle}</h2>
        <p className="text-sm text-muted-foreground">{strings.composeDescription}</p>
      </header>

      <Section title={strings.stepTemplate}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={strings.numberLabel} htmlFor={fieldIds.number}>
            <NativeSelect
              id={fieldIds.number}
              value={account}
              onChange={chooseAccount}
              invalid={attempted && number === null}
            >
              {number === null && <option value="">{strings.numberPlaceholder}</option>}
              {numbers.map((option) => (
                <option key={option.id} value={option.id}>
                  {strings.numberName(option.label, option.displayPhone)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={strings.templateLabel} htmlFor={fieldIds.template}>
            <NativeSelect
              id={fieldIds.template}
              value={template}
              disabled={templates.state !== "ready" || templateList.length === 0}
              onChange={chooseTemplate}
              invalid={attempted && selectedTemplate === null}
            >
              <option value="">
                {templates.state === "loading"
                  ? strings.templatesLoading
                  : strings.templatePlaceholder}
              </option>
              {templateList.map((option) => (
                <option key={templateKey(option)} value={templateKey(option)}>
                  {`${option.name} · ${option.language} · ${strings.categoryLabels[option.category] ?? option.category}`}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {number?.billingReady === false && (
          <Callout tone="warning" icon={<AlertTriangle />}>
            {strings.billingWarning}
          </Callout>
        )}
        {templates.state === "failed" && (
          <ErrorBar
            message={strings.templatesFailed}
            onRetry={() => {
              setReload((value) => value + 1);
            }}
          />
        )}
        {templates.state === "ready" && templateList.length === 0 && (
          <Callout tone="neutral" icon={<Info />}>
            {strings.templatesEmpty}
          </Callout>
        )}
        {selectedTemplate !== null && (
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {strings.templatePreview}
              </span>
              <span className="text-xs text-muted-foreground">
                {strings.categoryRules[selectedTemplate.category] ?? strings.unknownCategoryRule}
              </span>
            </div>
            {selectedTemplate.body !== null && (
              <p className="max-w-prose rounded-[14px] rounded-bl-[5px] border bg-background px-3 py-2 text-sm leading-[1.45] whitespace-pre-wrap [overflow-wrap:anywhere]">
                {fillTemplate(selectedTemplate.body, variables)}
              </p>
            )}
          </div>
        )}
      </Section>

      {variables.length > 0 && (
        <Section title={strings.stepVariables} hint={strings.variablesHint}>
          <div className="grid gap-3 md:grid-cols-2">
            {variables.map((value, index) => {
              const inputId = `${id}-var-${String(index)}`;
              return (
                <Field key={inputId} label={strings.variableLabel(index + 1)} htmlFor={inputId}>
                  <Input
                    id={inputId}
                    value={value}
                    maxLength={1024}
                    aria-invalid={attempted && !variablesOk && value.trim() === ""}
                    onChange={(event) => {
                      const next = [...variables];
                      next[index] = event.target.value;
                      setVariables(next);
                    }}
                  />
                </Field>
              );
            })}
          </div>
          {attempted && !variablesOk && (
            <p className="text-xs text-destructive">{strings.variablesIncomplete}</p>
          )}
        </Section>
      )}

      <Section title={strings.stepRecipients} hint={strings.recipientsHint}>
        {audiences.state === "loading" && account !== "" && (
          <p className="text-sm text-muted-foreground">{strings.audiencesLoading}</p>
        )}
        {audiences.state === "failed" && (
          <ErrorBar
            message={strings.audiencesFailed}
            onRetry={() => {
              setReload((value) => value + 1);
            }}
          />
        )}
        {audiences.state === "ready" && audienceList.length === 0 && (
          <Callout tone="neutral" icon={<Users />} title={strings.audiencesEmptyTitle}>
            <span className="[overflow-wrap:anywhere]">{strings.audiencesEmptyBody}</span>
          </Callout>
        )}
        {audienceList.length > 0 && (
          <fieldset className="grid gap-2 md:grid-cols-2">
            <legend className="sr-only">{strings.stepRecipients}</legend>
            {audienceList.map((option) => (
              <label
                key={option.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border bg-background px-3 py-2.5",
                  "transition-[background-color,border-color] duration-[var(--sendo-dur-fast,160ms)] hover:border-ring",
                  "has-[:checked]:border-foreground has-[:checked]:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                  attempted && selectedAudience === null && "border-destructive/60",
                )}
              >
                <input
                  type="radio"
                  name={`${id}-audience`}
                  value={option.id}
                  checked={audience === option.id}
                  className="mt-1 size-4 shrink-0 accent-foreground"
                  onChange={() => {
                    setAudience(option.id);
                  }}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                      {option.label}
                    </span>
                    {option.size !== null && (
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {strings.audienceSize(option.size, format)}
                      </span>
                    )}
                  </span>
                  {option.description !== null && (
                    <span
                      className="line-clamp-2 text-xs text-muted-foreground"
                      title={option.description}
                    >
                      {option.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </Section>

      <Section title={strings.stepRate}>
        <Field label={strings.rateLabel} htmlFor={fieldIds.rate}>
          <Input
            id={fieldIds.rate}
            inputMode="numeric"
            value={rate}
            className="w-32 tabular-nums"
            aria-invalid={!rateOk}
            aria-describedby={fieldIds.rateHint}
            onChange={(event) => {
              setRate(event.target.value);
            }}
          />
        </Field>
        <p
          id={fieldIds.rateHint}
          className={cn("text-xs", rateOk ? "text-muted-foreground" : "text-destructive")}
        >
          {rateOk ? strings.rateHint : strings.rateInvalid(MAX_RATE, format)}
        </p>
      </Section>

      {error !== null && (
        <ErrorBar
          message={error}
          onDismiss={() => {
            setError(null);
          }}
        />
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className={pressClass} onClick={onCancel}>
          {strings.cancelCompose}
        </Button>
        <Button
          type="submit"
          className={pressClass}
          disabled={busy !== null || (attempted && !ready)}
        >
          {busy === "preview" ? strings.reviewing : strings.review}
        </Button>
      </div>
    </form>
  );
}

function ReviewStep({
  preview,
  number,
  template,
  audience,
  links,
  busy,
  error,
  onDismissError,
  onBack,
  onConfirm,
}: {
  preview: BroadcastPreviewView;
  number: BroadcastNumberView;
  template: BroadcastTemplateView;
  audience: BroadcastAudienceView;
  links: BroadcastsLinks;
  busy: boolean;
  error: string | null;
  onDismissError: () => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const strings = useBroadcastsStrings();
  const format = useBroadcastsFormat();
  const skippedTotal = SKIP_REASONS.reduce((sum, reason) => sum + preview.skipped[reason], 0);
  const category = strings.categoryLabels[preview.category] ?? preview.category;
  const nobody = preview.eligible === 0;

  return (
    <section key="review" className={cn("flex flex-col gap-5", viewEnterClass)}>
      <header className="flex flex-col gap-1">
        <h2 className="text-[17px] font-[650] tracking-[-0.01em]">{strings.reviewTitle}</h2>
        <p className="text-sm text-muted-foreground">{strings.reviewDescription}</p>
      </header>

      <dl className="grid gap-x-6 gap-y-3 rounded-xl border bg-background p-4 text-sm sm:grid-cols-2">
        <SummaryItem label={strings.summaryTemplate}>
          {`${template.name} · ${template.language} · ${category}`}
        </SummaryItem>
        <SummaryItem label={strings.summaryNumber}>
          {strings.numberName(number.label, number.displayPhone)}
        </SummaryItem>
        <SummaryItem label={strings.summaryAudience}>{audience.label}</SummaryItem>
        <SummaryItem label={strings.summaryRate}>
          {strings.perMinute(preview.ratePerMinute, format)}
        </SummaryItem>
      </dl>

      <div className="grid grid-cols-1 gap-2 min-[440px]:grid-cols-3">
        <Stat label={strings.previewTotal} value={preview.total} />
        <Stat label={strings.previewEligible} value={preview.eligible} emphasis />
        <Stat label={strings.previewSkipped} value={skippedTotal} />
      </div>

      {skippedTotal > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">{strings.previewBreakdown}</h3>
          <ul className="divide-y rounded-xl border bg-background">
            {SKIP_REASONS.filter((reason) => preview.skipped[reason] > 0).map((reason) => (
              <li key={reason} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{strings.skipReasonLabels[reason]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {strings.skipReasonHints[reason]}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {format.number(preview.skipped[reason])}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {nobody ? (
        <Callout tone="danger" icon={<AlertTriangle />} title={strings.noneEligibleTitle}>
          {strings.noneEligibleBody(preview.category)}
        </Callout>
      ) : (
        <p className="text-sm text-muted-foreground">
          {strings.estimatedTime(preview.estimatedMinutes, preview.ratePerMinute, format)}
        </p>
      )}

      {number.billingReady === false && !nobody && (
        <Callout tone="warning" icon={<AlertTriangle />}>
          {strings.billingReviewWarning}
        </Callout>
      )}

      <Callout tone="info" icon={<Info />} title={strings.costTitle}>
        <p>{strings.costBody(category)}</p>
        <a
          href={links.metaPricing}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:no-underline"
        >
          {strings.costLink}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </Callout>

      {error !== null && <ErrorBar message={error} onDismiss={onDismissError} />}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" className={pressClass} disabled={busy} onClick={onBack}>
          <ArrowLeft aria-hidden />
          {strings.back}
        </Button>
        <Button className={pressClass} disabled={nobody || busy} onClick={onConfirm}>
          {busy
            ? strings.sending
            : nobody
              ? strings.confirmNone
              : strings.confirm(preview.eligible, format)}
        </Button>
      </div>
    </section>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-background p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

/** A native select styled like the shadcn input: works with the phone's own picker. */
function NativeSelect({
  id,
  value,
  disabled,
  invalid,
  onChange,
  children,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="relative min-w-0">
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        className={cn(
          "h-9 w-full min-w-0 appearance-none truncate rounded-md border border-input bg-background py-1 pr-9 pl-3 text-sm shadow-xs outline-none",
          "transition-[border-color,box-shadow] duration-[var(--sendo-dur-fast,160ms)] hover:border-ring",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        )}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  const format = useBroadcastsFormat();
  return (
    <div
      className={cn(
        "flex min-w-0 items-baseline justify-between gap-2 rounded-xl border px-3 py-2.5 min-[440px]:flex-col min-[440px]:items-start min-[440px]:justify-start min-[440px]:gap-0.5",
        emphasis ? "border-foreground/20 bg-background" : "bg-muted/30",
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-[22px] leading-tight font-[650] tabular-nums">
        {format.number(value)}
      </span>
    </div>
  );
}
