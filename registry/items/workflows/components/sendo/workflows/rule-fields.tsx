"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  AutoAssignDraft,
  AutoCloseDraft,
  EscalateDraft,
  QueueMode,
  RouteDraft,
} from "./drafts";
import { ChipsInput, ChoiceGroup, Field, FieldError, errorIndexesAt } from "./form-parts";
import type { WorkflowsStrings } from "./strings";
import { numberName } from "./summary";
import { findNumber, type RuleNumberView } from "./types";
import { errorAt, type FieldErrors } from "./validation";

const ANY = "__any__";

interface FieldsProps<D> {
  draft: D;
  onChange: (draft: D) => void;
  errors: FieldErrors;
  strings: WorkflowsStrings;
}

/** Match (keywords, source, channel, number) → action (queue, tags, agent or person, reason). */
export function RouteFields({
  draft,
  onChange,
  errors,
  strings,
  numbers,
}: FieldsProps<RouteDraft> & { numbers: RuleNumberView[] }) {
  const unknownAccount = draft.account !== "" && findNumber(numbers, draft.account) === undefined;
  return (
    <div className="grid gap-6">
      <fieldset className="grid min-w-0 gap-4">
        <legend className="mb-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {strings.matchLegend}
        </legend>
        <p className="text-xs text-muted-foreground">{strings.matchHint}</p>
        <ChipsInput
          label={strings.keywordsLabel}
          hint={strings.keywordsHint}
          placeholder={strings.keywordsPlaceholder}
          values={draft.keywords}
          error={errorAt(errors, "match.keywords")}
          errorIndexes={errorIndexesAt(errors, "match.keywords")}
          removeLabel={strings.removeChipLabel}
          onChange={(keywords) => {
            onChange({ ...draft, keywords });
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={strings.sourceLabel}
            hint={strings.sourceHint}
            error={errorAt(errors, "match.source")}
          >
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                spellCheck={false}
                placeholder="garita"
                value={draft.source}
                onChange={(event) => {
                  onChange({ ...draft, source: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label={strings.channelLabel} error={errorAt(errors, "match.channel")}>
            {(control) => (
              <Select
                value={draft.channel === "" ? ANY : draft.channel}
                onValueChange={(value) => {
                  onChange({ ...draft, channel: value === "whatsapp" ? "whatsapp" : "" });
                }}
              >
                <SelectTrigger {...control} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{strings.channelAny}</SelectItem>
                  <SelectItem value="whatsapp">{strings.channelWhatsApp}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>
        {numbers.length > 1 || draft.account !== "" ? (
          <Field label={strings.matchNumberLabel} error={errorAt(errors, "match.account")}>
            {(control) => (
              <Select
                value={draft.account === "" ? ANY : draft.account}
                onValueChange={(value) => {
                  onChange({ ...draft, account: value === ANY ? "" : value });
                }}
              >
                <SelectTrigger {...control} className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{strings.matchNumberAny}</SelectItem>
                  {unknownAccount && (
                    <SelectItem value={draft.account}>
                      {numberName(numbers, draft.account, strings)}
                    </SelectItem>
                  )}
                  {numbers.map((number) => (
                    <SelectItem key={number.id} value={number.id}>
                      {numberName(numbers, number.id, strings)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        ) : null}
      </fieldset>

      <fieldset className="grid min-w-0 gap-4">
        <legend className="mb-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {strings.actionLegend}
        </legend>
        <ChoiceGroup
          legend={strings.toLegend}
          value={draft.to}
          error={errorAt(errors, "action.to")}
          onChange={(to) => {
            onChange({ ...draft, to });
          }}
          options={(["human", "agent"] as const).map((value) => ({
            value,
            label: strings.toOptions[value].label,
            hint: strings.toOptions[value].hint,
          }))}
        />
        <Field
          label={strings.routeQueueLabel}
          hint={strings.routeQueueHint}
          error={errorAt(errors, "action.queue")}
        >
          {(control) => (
            <Input
              {...control}
              autoComplete="off"
              value={draft.queue}
              onChange={(event) => {
                onChange({ ...draft, queue: event.target.value });
              }}
            />
          )}
        </Field>
        <ChipsInput
          label={strings.tagsLabel}
          hint={strings.tagsHint}
          placeholder={strings.tagsPlaceholder}
          values={draft.tags}
          error={errorAt(errors, "action.tags")}
          errorIndexes={errorIndexesAt(errors, "action.tags")}
          removeLabel={strings.removeChipLabel}
          onChange={(tags) => {
            onChange({ ...draft, tags });
          }}
        />
        {draft.to === "human" && (
          <Field
            label={strings.reasonLabel}
            hint={strings.reasonHint}
            error={errorAt(errors, "action.reason")}
          >
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                value={draft.reason}
                onChange={(event) => {
                  onChange({ ...draft, reason: event.target.value });
                }}
              />
            )}
          </Field>
        )}
      </fieldset>
    </div>
  );
}

/** Any queue (omitted), no queue (`null`) or a named queue. */
function QueueField({
  mode,
  queue,
  error,
  strings,
  onChange,
}: {
  mode: QueueMode;
  queue: string;
  error: string | undefined;
  strings: WorkflowsStrings;
  onChange: (next: { queueMode: QueueMode; queue: string }) => void;
}) {
  return (
    <div className="grid gap-2">
      <ChoiceGroup
        legend={strings.queueLabel}
        value={mode}
        columns={3}
        onChange={(queueMode) => {
          onChange({ queueMode, queue });
        }}
        options={(["any", "none", "named"] as const).map((value) => ({
          value,
          label: strings.queueModes[value],
        }))}
      />
      {mode === "named" && (
        <Input
          aria-label={strings.queueModes.named}
          aria-invalid={error !== undefined}
          autoComplete="off"
          placeholder={strings.queueNamePlaceholder}
          value={queue}
          onChange={(event) => {
            onChange({ queueMode: mode, queue: event.target.value });
          }}
        />
      )}
      {error !== undefined && <FieldError>{error}</FieldError>}
    </div>
  );
}

export function AutoAssignFields({
  draft,
  onChange,
  errors,
  strings,
}: FieldsProps<AutoAssignDraft>) {
  return (
    <div className="grid gap-6">
      <QueueField
        mode={draft.queueMode}
        queue={draft.queue}
        error={errorAt(errors, "queue")}
        strings={strings}
        onChange={(next) => {
          onChange({ ...draft, ...next });
        }}
      />
      <ChoiceGroup
        legend={strings.strategyLegend}
        value={draft.strategy}
        columns={1}
        error={errorAt(errors, "strategy")}
        onChange={(strategy) => {
          onChange({ ...draft, strategy });
        }}
        options={(["least_open", "round_robin"] as const).map((value) => ({
          value,
          label: strings.strategyLabels[value],
          hint: strings.strategyHints[value],
        }))}
      />
    </div>
  );
}

export function EscalateFields({ draft, onChange, errors, strings }: FieldsProps<EscalateDraft>) {
  return (
    <div className="grid gap-6">
      <Field
        label={strings.afterMinutesLabel}
        hint={strings.afterMinutesHint}
        error={errorAt(errors, "afterMinutes")}
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            value={draft.afterMinutes}
            onChange={(event) => {
              onChange({ ...draft, afterMinutes: event.target.value });
            }}
            className="w-32 tabular-nums"
          />
        )}
      </Field>
      <QueueField
        mode={draft.queueMode}
        queue={draft.queue}
        error={errorAt(errors, "queue")}
        strings={strings}
        onChange={(next) => {
          onChange({ ...draft, ...next });
        }}
      />
      <ChoiceGroup
        legend={strings.escalateActionLegend}
        value={draft.action}
        columns={1}
        error={errorAt(errors, "action")}
        onChange={(action) => {
          onChange({ ...draft, action });
        }}
        options={(["reassign", "notify", "return_to_agent"] as const).map((value) => ({
          value,
          label: strings.escalateActionLabels[value].replace(/^./, (first) => first.toUpperCase()),
          hint: strings.escalateActionHints[value],
        }))}
      />
    </div>
  );
}

export function AutoCloseFields({ draft, onChange, errors, strings }: FieldsProps<AutoCloseDraft>) {
  return (
    <Field
      label={strings.afterDaysLabel}
      hint={strings.afterDaysHint}
      error={errorAt(errors, "afterDays")}
    >
      {(control) => (
        <Input
          {...control}
          inputMode="numeric"
          autoComplete="off"
          value={draft.afterDays}
          onChange={(event) => {
            onChange({ afterDays: event.target.value });
          }}
          className="w-32 tabular-nums"
        />
      )}
    </Field>
  );
}
