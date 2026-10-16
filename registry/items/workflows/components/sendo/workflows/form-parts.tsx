"use client";

import { X } from "lucide-react";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { addChips, splitChips } from "./drafts";
import { pressClass } from "./press";

/** Label, hint and error around one control; the control gets `id` and `aria-describedby`. */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: (control: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error !== undefined ? errorId : null, hint !== undefined ? hintId : null]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        "aria-describedby": describedBy === "" ? undefined : describedBy,
        "aria-invalid": error !== undefined,
      })}
      {error !== undefined && <FieldError id={errorId}>{error}</FieldError>}
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-xs font-medium text-destructive [overflow-wrap:anywhere]">
      {children}
    </p>
  );
}

/** A fieldset of radio cards (small enums: who handles, strategy, applies-to...). */
export function ChoiceGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
  error,
  columns = 2,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  error?: string;
  columns?: 1 | 2 | 3;
}) {
  const name = useId();
  return (
    <fieldset className="grid min-w-0 gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div
        className={cn(
          "grid gap-2",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-3",
        )}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex min-w-0 cursor-pointer gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-[color,background-color,border-color] duration-[var(--sendo-dur-fast,160ms)] hover:border-ring hover:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
              option.value === value && "border-foreground/70 bg-accent",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => {
                onChange(option.value);
              }}
              className="mt-0.5 size-4 shrink-0 accent-foreground"
            />
            <span className="grid min-w-0 gap-0.5">
              <span className="font-medium">{option.label}</span>
              {option.hint !== undefined && (
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      {error !== undefined && <FieldError>{error}</FieldError>}
    </fieldset>
  );
}

/**
 * A list of short values as removable chips plus an input: Enter or comma adds, pasting a
 * comma-separated list adds them all, Backspace on the empty input removes the last chip.
 * Chips with an error (`errorIndexes`) are outlined in red.
 */
export function ChipsInput({
  label,
  hint,
  placeholder,
  values,
  onChange,
  error,
  errorIndexes = [],
  removeLabel,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  values: string[];
  onChange: (values: string[]) => void;
  error?: string;
  errorIndexes?: number[];
  removeLabel: (value: string) => string;
}) {
  const [typed, setTyped] = useState("");

  function commit(input: string) {
    const added = splitChips(input);
    if (added.length > 0) onChange(addChips(values, added));
    setTyped("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(typed);
    } else if (event.key === "Backspace" && typed === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <Field label={label} hint={hint} error={error}>
      {(control) => (
        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5 shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
            error !== undefined && "border-destructive",
          )}
        >
          {values.map((value, index) => (
            <span
              key={`${value}-${String(index)}`}
              className={cn(
                "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border bg-background py-0.5 pr-1 pl-2.5 text-xs",
                errorIndexes.includes(index) && "border-destructive text-destructive",
              )}
            >
              <span className="truncate" title={value}>
                {value}
              </span>
              <button
                type="button"
                aria-label={removeLabel(value)}
                onClick={() => {
                  onChange(values.filter((_, other) => other !== index));
                }}
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground",
                  pressClass,
                )}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          <input
            {...control}
            value={typed}
            placeholder={values.length === 0 ? placeholder : undefined}
            onChange={(event) => {
              const next = event.target.value;
              if (/[,\n]/.test(next)) commit(next);
              else setTyped(next);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              if (typed.trim() !== "") commit(typed);
            }}
            className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}
    </Field>
  );
}

/** Indexes of list items with an error under `path` (`match.keywords.3` → 3). */
export function errorIndexesAt(errors: Record<string, string>, path: string): number[] {
  const indexes: number[] = [];
  for (const key of Object.keys(errors)) {
    if (!key.startsWith(`${path}.`)) continue;
    const index = Number(key.slice(path.length + 1).split(".")[0]);
    if (Number.isInteger(index)) indexes.push(index);
  }
  return indexes;
}
