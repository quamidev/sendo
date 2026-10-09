"use client";

import type { RuleType } from "@quami/sendo/rules";
import { AlertTriangle, Code2, LoaderCircle } from "lucide-react";
import { useId, useState, type SyntheticEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { BusinessHoursFields } from "./business-hours-fields";
import {
  draftsFromRule,
  emptyDrafts,
  paramsFromDraft,
  RULE_TYPE_ORDER,
  type RuleDrafts,
} from "./drafts";
import { Field, FieldError } from "./form-parts";
import { pressClass, sheetMotionClass } from "./press";
import { AutoAssignFields, AutoCloseFields, EscalateFields, RouteFields } from "./rule-fields";
import { RULE_ICONS } from "./rule-row";
import type { WorkflowsStrings } from "./strings";
import { numberName } from "./summary";
import {
  findNumber,
  type RuleNumberView,
  type RuleRowView,
  type SaveRuleInput,
  type WorkflowsActionResult,
} from "./types";
import { validateRule, type FieldErrors } from "./validation";

const ALL = "__all__";

export interface RuleEditorProps {
  open: boolean;
  /** The rule to edit; `null` creates one. Remount (`key`) to edit another rule. */
  rule: RuleRowView | null;
  /** Type preselected when creating. */
  initialType?: RuleType;
  numbers: RuleNumberView[];
  /** Names already used by other rules (create only). */
  takenKeys: readonly string[];
  strings: WorkflowsStrings;
  onOpenChange: (open: boolean) => void;
  onSave: (input: SaveRuleInput) => Promise<WorkflowsActionResult<unknown>>;
}

function initialErrors(rule: RuleRowView | null, strings: WorkflowsStrings): FieldErrors {
  if (rule === null || rule.valid) return {};
  const result = validateRule({ key: rule.key, type: rule.type, params: rule.params }, strings);
  return result.ok ? {} : result.errors;
}

/** Side sheet with the typed form of one rule; validates with the package schemas before saving. */
export function RuleEditor({
  open,
  rule,
  initialType = "business_hours",
  numbers,
  takenKeys,
  strings,
  onOpenChange,
  onSave,
}: RuleEditorProps) {
  const creating = rule === null;
  const formId = useId();
  const [type, setType] = useState<RuleType>(rule?.type ?? initialType);
  const [key, setKey] = useState(rule?.key ?? "");
  const [account, setAccount] = useState(rule?.accountId ?? "");
  const [drafts, setDrafts] = useState<RuleDrafts>(() =>
    rule === null ? emptyDrafts() : draftsFromRule(rule.type, rule.params),
  );
  const [errors, setErrors] = useState<FieldErrors>(() => initialErrors(rule, strings));
  const [submitted, setSubmitted] = useState(rule !== null && !rule.valid);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function validate(next: { key: string; type: RuleType; drafts: RuleDrafts }) {
    return validateRule(
      { key: next.key, type: next.type, params: paramsFromDraft(next.type, next.drafts) },
      strings,
      creating ? takenKeys : [],
    );
  }

  /** After the first save attempt, errors follow every edit. */
  function revalidate(next: { key: string; type: RuleType; drafts: RuleDrafts }) {
    if (!submitted) return;
    const result = validate(next);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) setFormError(null);
  }

  function changeDrafts<T extends RuleType>(ruleType: T, draft: RuleDrafts[T]) {
    const next = { ...drafts, [ruleType]: draft };
    setDrafts(next);
    revalidate({ key, type, drafts: next });
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);
    const result = validate({ key, type, drafts });
    if (!result.ok) {
      setErrors(result.errors);
      setFormError(strings.fixErrors);
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    const saved = await onSave({
      id: rule?.id ?? null,
      key: result.key,
      type,
      params: result.params,
      account: account === "" ? null : account,
    });
    setPending(false);
    if (saved.ok) {
      onOpenChange(false);
      return;
    }
    if (saved.code === "DUPLICATE") {
      setErrors({ key: strings.keyDuplicate });
      setFormError(strings.fixErrors);
    } else if (saved.code === "INVALID" && saved.fieldErrors !== undefined) {
      setErrors(saved.fieldErrors);
      setFormError(strings.fixErrors);
    } else {
      setFormError(saved.code === "INVALID" ? saved.message : strings.errorMessages[saved.code]);
    }
  }

  const unknownAccount = account !== "" && findNumber(numbers, account) === undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <SheetContent
        className={cn("w-full gap-0 p-0 outline-none sm:max-w-xl", sheetMotionClass)}
        onOpenAutoFocus={(event) => {
          // Editing: the name is read-only, so focus the sheet itself instead of selecting it.
          if (creating) return;
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
        }}
      >
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-[17px] font-[650] tracking-[-0.01em]">
            {creating ? strings.editorCreateTitle : strings.editorEditTitle}
          </SheetTitle>
          <SheetDescription>{strings.typeDescriptions[type]}</SheetDescription>
        </SheetHeader>

        <form
          id={formId}
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="grid flex-1 content-start gap-6 overflow-y-auto px-5 py-5">
            {rule !== null && !rule.valid && (
              <p
                role="note"
                className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px] text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {strings.invalidStoredNote}
              </p>
            )}
            {rule?.origin === "code" && (
              <p
                role="note"
                className="flex gap-2 rounded-lg bg-violet-50 px-3 py-2.5 text-[13px] text-violet-800 dark:bg-violet-500/15 dark:text-violet-200"
              >
                <Code2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                {strings.codeOriginNote}
              </p>
            )}

            {creating && (
              <fieldset className="grid min-w-0 gap-2">
                <legend className="mb-1 text-sm font-medium">{strings.editorTypeLegend}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {RULE_TYPE_ORDER.map((option) => {
                    const Icon = RULE_ICONS[option];
                    return (
                      <label
                        key={option}
                        className={cn(
                          "flex min-w-0 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-[color,background-color,border-color] duration-[var(--sendo-dur-fast,160ms)] hover:border-ring hover:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                          option === type && "border-foreground/70 bg-accent",
                        )}
                      >
                        <input
                          type="radio"
                          name={`${formId}-type`}
                          value={option}
                          checked={option === type}
                          onChange={() => {
                            setType(option);
                            revalidate({ key, type: option, drafts });
                          }}
                          className="sr-only"
                        />
                        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <span className="grid min-w-0 gap-0.5">
                          <span className="font-medium">{strings.typeLabels[option]}</span>
                          <span className="text-xs text-muted-foreground">
                            {strings.typeDescriptions[option]}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={strings.keyLabel}
                hint={creating ? strings.keyHint : strings.keyLockedHint}
                error={errors.key}
              >
                {(control) => (
                  <Input
                    {...control}
                    autoComplete="off"
                    maxLength={64}
                    readOnly={!creating}
                    value={key}
                    onChange={(event) => {
                      setKey(event.target.value);
                      revalidate({ key: event.target.value, type, drafts });
                    }}
                    className={cn(!creating && "bg-muted/50 text-muted-foreground")}
                  />
                )}
              </Field>
              <Field label={strings.numberLabel} hint={strings.numberHint}>
                {(control) => (
                  <Select
                    value={account === "" ? ALL : account}
                    onValueChange={(value) => {
                      setAccount(value === ALL ? "" : value);
                    }}
                  >
                    <SelectTrigger {...control} className="w-full min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>{strings.allNumbers}</SelectItem>
                      {unknownAccount && (
                        <SelectItem value={account}>
                          {numberName(numbers, account, strings)}
                        </SelectItem>
                      )}
                      {numbers
                        .filter((number) => number.active || number.id === account)
                        .map((number) => (
                          <SelectItem key={number.id} value={number.id}>
                            {numberName(numbers, number.id, strings)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </div>

            <div className="h-px bg-border" aria-hidden />

            {type === "business_hours" && (
              <BusinessHoursFields
                draft={drafts.business_hours}
                errors={errors}
                strings={strings}
                onChange={(draft) => {
                  changeDrafts("business_hours", draft);
                }}
              />
            )}
            {type === "route" && (
              <RouteFields
                draft={drafts.route}
                errors={errors}
                strings={strings}
                numbers={numbers}
                onChange={(draft) => {
                  changeDrafts("route", draft);
                }}
              />
            )}
            {type === "auto_assign" && (
              <AutoAssignFields
                draft={drafts.auto_assign}
                errors={errors}
                strings={strings}
                onChange={(draft) => {
                  changeDrafts("auto_assign", draft);
                }}
              />
            )}
            {type === "escalate" && (
              <EscalateFields
                draft={drafts.escalate}
                errors={errors}
                strings={strings}
                onChange={(draft) => {
                  changeDrafts("escalate", draft);
                }}
              />
            )}
            {type === "auto_close" && (
              <AutoCloseFields
                draft={drafts.auto_close}
                errors={errors}
                strings={strings}
                onChange={(draft) => {
                  changeDrafts("auto_close", draft);
                }}
              />
            )}
          </div>

          <SheetFooter className="flex-row items-center justify-end gap-2 border-t px-5 py-3">
            <div className="mr-auto min-w-0" aria-live="polite">
              {formError !== null && <FieldError>{formError}</FieldError>}
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              className={pressClass}
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {strings.cancel}
            </Button>
            <Button type="submit" disabled={pending} className={pressClass}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden />}
              {pending ? strings.saving : strings.save}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
