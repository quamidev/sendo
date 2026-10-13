"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { menuEnterClass, pressClass } from "./press";
import type { MetricsStrings } from "./strings";
import { TAG_DOT_CLASS } from "./tables";
import {
  presetRange,
  RANGE_PRESETS,
  rangeError,
  type MetricsFilters,
  type MetricsNumberView,
  type MetricsTagView,
} from "./types";

const ALL = "__all";

export interface MetricsFilterBarProps {
  filters: MetricsFilters;
  numbers: MetricsNumberView[];
  tags: MetricsTagView[];
  /** "Today" for the presets (the report's timezone). */
  today: string;
  onChange: (filters: MetricsFilters) => void;
  strings: MetricsStrings;
}

function numberLabel(number: MetricsNumberView, strings: MetricsStrings): string {
  const base = number.label ? `${number.label} · ${number.displayPhone}` : number.displayPhone;
  return number.active ? base : `${base} (${strings.disconnected})`;
}

/** One row above everything it scopes: period, number, tags. */
export function MetricsFilterBar({
  filters,
  numbers,
  tags,
  today,
  onChange,
  strings,
}: MetricsFilterBarProps) {
  const id = useId();
  const preset = RANGE_PRESETS.find((days) => {
    const range = presetRange(days, today);
    return range.from === filters.from && range.to === filters.to;
  });
  const [custom, setCustom] = useState(preset === undefined);
  const [draft, setDraft] = useState({ from: filters.from, to: filters.to });
  const draftError = rangeError(draft.from, draft.to, strings);

  // A preset picked after a custom range resets the inputs (state adjusted during render).
  const [synced, setSynced] = useState(`${filters.from}/${filters.to}`);
  if (synced !== `${filters.from}/${filters.to}`) {
    setSynced(`${filters.from}/${filters.to}`);
    setDraft({ from: filters.from, to: filters.to });
  }

  const chip = (selected: boolean) =>
    cn(
      pressClass,
      "h-8 rounded-full px-3 text-[13px]",
      selected
        ? "bg-foreground text-background hover:bg-foreground/90 hover:text-background"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    <div role="group" aria-label={strings.filtersLabel} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={strings.rangeLabel}
          className="flex flex-wrap items-center gap-1 rounded-full border bg-background p-0.5"
        >
          {RANGE_PRESETS.map((days) => (
            <Button
              key={days}
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={!custom && preset === days}
              className={chip(!custom && preset === days)}
              onClick={() => {
                setCustom(false);
                onChange({ ...filters, ...presetRange(days, today) });
              }}
            >
              {strings.presetDays(days)}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={custom || preset === undefined}
            aria-expanded={custom}
            aria-controls={`${id}-custom`}
            className={chip(custom || preset === undefined)}
            onClick={() => {
              setCustom(true);
            }}
          >
            {strings.customRange}
          </Button>
        </div>

        {numbers.length > 1 && (
          <Select
            value={filters.account ?? ALL}
            onValueChange={(value) => {
              onChange({ ...filters, account: value === ALL ? null : value });
            }}
          >
            <SelectTrigger
              size="sm"
              className="h-9 max-w-72 min-w-0 rounded-full"
              aria-label={strings.numberLabel}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value={ALL}>{strings.allNumbers}</SelectItem>
              {numbers.map((number) => (
                <SelectItem key={number.id} value={number.id}>
                  <span className="truncate">{numberLabel(number, strings)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {tags.length > 0 && (
          <TagFilter
            tags={tags}
            selected={filters.tagIds}
            onChange={(tagIds) => {
              onChange({ ...filters, tagIds });
            }}
            strings={strings}
          />
        )}
      </div>

      {custom && (
        <form
          id={`${id}-custom`}
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (draftError === null) onChange({ ...filters, ...draft });
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {strings.fromLabel}
            <Input
              type="date"
              value={draft.from}
              max={draft.to || undefined}
              className="h-9 w-40"
              onChange={(event) => {
                setDraft({ ...draft, from: event.target.value });
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {strings.toLabel}
            <Input
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              className="h-9 w-40"
              onChange={(event) => {
                setDraft({ ...draft, to: event.target.value });
              }}
            />
          </label>
          <Button
            type="submit"
            size="sm"
            className={cn(pressClass, "h-9")}
            disabled={draftError !== null}
          >
            {strings.apply}
          </Button>
          {draftError !== null && draft.from !== "" && draft.to !== "" && (
            <p role="alert" className="basis-full text-sm text-destructive">
              {draftError}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function TagFilter({
  tags,
  selected,
  onChange,
  strings,
}: {
  tags: MetricsTagView[];
  selected: string[];
  onChange: (tagIds: string[]) => void;
  strings: MetricsStrings;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const selectedTags = tags.filter((tag) => selected.includes(tag.id));
  const summary =
    selectedTags.length === 0
      ? strings.allTags
      : selectedTags.length === 1
        ? (selectedTags[0]?.name ?? strings.tagsSelected(1))
        : strings.tagsSelected(selectedTags.length);

  useEffect(() => {
    function close(event: PointerEvent | KeyboardEvent) {
      const details = ref.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        details.open = false;
        details.querySelector("summary")?.focus();
        return;
      }
      if (event.target instanceof Node && details.contains(event.target)) return;
      details.open = false;
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="group relative">
      <summary
        aria-label={`${strings.tagsLabel}: ${summary}`}
        className={cn(
          pressClass,
          "flex h-9 max-w-64 cursor-pointer list-none items-center gap-1.5 rounded-full border bg-background px-3 text-[13px] hover:bg-muted [&::-webkit-details-marker]:hidden",
          selectedTags.length > 0 && "border-foreground/40",
        )}
      >
        <span className="text-muted-foreground">{strings.tagsLabel}:</span>
        <span className="min-w-0 truncate">{summary}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </summary>
      <div
        className={cn(
          menuEnterClass,
          "absolute top-full left-0 z-20 mt-1 flex max-h-72 w-64 flex-col overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md",
        )}
      >
        {tags.map((tag) => {
          const checked = selected.includes(tag.id);
          return (
            <label
              key={tag.id}
              className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted has-[:focus-visible]:bg-muted"
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => {
                  onChange(
                    checked ? selected.filter((id) => id !== tag.id) : [...selected, tag.id],
                  );
                }}
              />
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", TAG_DOT_CLASS[tag.color])}
              />
              <span className="min-w-0 flex-1 truncate" title={tag.name}>
                {tag.name}
              </span>
              <Check
                aria-hidden
                strokeWidth={3}
                className={cn("size-4 shrink-0", checked ? "opacity-100" : "opacity-0")}
              />
            </label>
          );
        })}
        {selected.length > 0 && (
          <button
            type="button"
            className="mt-1 rounded-md border-t px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              onChange([]);
            }}
          >
            {strings.clearTags}
          </button>
        )}
      </div>
    </details>
  );
}
