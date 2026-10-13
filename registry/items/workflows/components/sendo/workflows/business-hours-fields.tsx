"use client";

import { WEEKDAYS, type Weekday } from "@quami/sendo/rules";
import { CalendarX2, Copy, Plus, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { BusinessHoursDraft, TimeRangeDraft } from "./drafts";
import { ChoiceGroup, Field, FieldError } from "./form-parts";
import { pressClass } from "./press";
import { useWorkflowsStrings } from "./strings-context";
import { errorAt, type FieldErrors } from "./validation";

const MAX_RANGES_PER_DAY = 12;

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

const smallButton = cn(
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40",
  pressClass,
);

/** Timezone, weekly schedule (several ranges per day), holidays, after-hours message, applies-to. */
export function BusinessHoursFields({
  draft,
  onChange,
  errors,
}: {
  draft: BusinessHoursDraft;
  onChange: (draft: BusinessHoursDraft) => void;
  errors: FieldErrors;
}) {
  const strings = useWorkflowsStrings();
  const zonesId = useId();
  const zones = useMemo(() => timeZones(), []);

  function setDay(day: Weekday, ranges: TimeRangeDraft[]) {
    onChange({ ...draft, schedule: { ...draft.schedule, [day]: ranges } });
  }

  return (
    <div className="grid gap-6">
      <Field
        label={strings.timezoneLabel}
        hint={strings.timezoneHint}
        error={errorAt(errors, "timezone")}
      >
        {(control) => (
          <>
            <Input
              {...control}
              list={zonesId}
              autoComplete="off"
              spellCheck={false}
              value={draft.timezone}
              onChange={(event) => {
                onChange({ ...draft, timezone: event.target.value });
              }}
            />
            <datalist id={zonesId}>
              {zones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </>
        )}
      </Field>

      <fieldset className="grid min-w-0 gap-2">
        <legend className="mb-1 text-sm font-medium">{strings.scheduleLegend}</legend>
        <p className="text-xs text-muted-foreground">{strings.scheduleHint}</p>
        <div className="divide-y rounded-lg border">
          {WEEKDAYS.map((day) => (
            <DayRow
              key={day}
              day={day}
              ranges={draft.schedule[day]}
              errors={errors}
              onChange={(ranges) => {
                setDay(day, ranges);
              }}
            />
          ))}
        </div>
        {errorAt(errors, "schedule") !== undefined &&
          WEEKDAYS.every((day) => errorAt(errors, `schedule.${day}`) === undefined) && (
            <FieldError>{errorAt(errors, "schedule")}</FieldError>
          )}
        <div>
          <button
            type="button"
            className={smallButton}
            disabled={draft.schedule.mon.length === 0}
            onClick={() => {
              const monday = draft.schedule.mon.map((range) => ({ ...range }));
              onChange({
                ...draft,
                schedule: {
                  ...draft.schedule,
                  tue: monday.map((range) => ({ ...range })),
                  wed: monday.map((range) => ({ ...range })),
                  thu: monday.map((range) => ({ ...range })),
                  fri: monday.map((range) => ({ ...range })),
                },
              });
            }}
          >
            <Copy className="size-3.5" aria-hidden />
            {strings.copyMondayToWeekdays}
          </button>
        </div>
      </fieldset>

      <Holidays draft={draft} onChange={onChange} errors={errors} />

      <Field
        label={strings.outsideMessageLabel}
        hint={strings.outsideMessageHint}
        error={errorAt(errors, "outsideMessage")}
      >
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            value={draft.outsideMessage}
            onChange={(event) => {
              onChange({ ...draft, outsideMessage: event.target.value });
            }}
            className="[overflow-wrap:anywhere]"
          />
        )}
      </Field>

      <ChoiceGroup
        legend={strings.appliesToLegend}
        value={draft.appliesTo}
        error={errorAt(errors, "appliesTo")}
        onChange={(appliesTo) => {
          onChange({ ...draft, appliesTo });
        }}
        options={(["human", "all"] as const).map((value) => ({
          value,
          label: strings.appliesToOptions[value].label,
          hint: strings.appliesToOptions[value].hint,
        }))}
      />
    </div>
  );
}

function DayRow({
  day,
  ranges,
  errors,
  onChange,
}: {
  day: Weekday;
  ranges: TimeRangeDraft[];
  errors: FieldErrors;
  onChange: (ranges: TimeRangeDraft[]) => void;
}) {
  const strings = useWorkflowsStrings();
  const name = strings.weekdayLabels[day];
  const open = ranges.length > 0;
  const dayError = errors[`schedule.${day}`];

  function setRange(index: number, patch: Partial<TimeRangeDraft>) {
    onChange(ranges.map((range, other) => (other === index ? { ...range, ...patch } : range)));
  }

  function addRange() {
    const last = ranges.at(-1);
    onChange([
      ...ranges,
      last === undefined ? { start: "09:00", end: "18:00" } : { start: last.end, end: "" },
    ]);
  }

  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-3 py-2.5 max-sm:grid-cols-1">
      <div className="flex h-8 items-center gap-2">
        <Switch
          checked={open}
          aria-label={strings.openDay(name)}
          className="transition-[background-color,box-shadow]"
          onCheckedChange={(checked) => {
            onChange(checked ? [{ start: "09:00", end: "18:00" }] : []);
          }}
        />
        <span className="text-sm font-medium">{name}</span>
      </div>
      <div className="grid min-w-0 gap-1.5">
        {!open && (
          <p className="flex h-8 items-center text-sm text-muted-foreground">{strings.closedDay}</p>
        )}
        {ranges.map((range, index) => {
          // A malformed time says more than "start before end", so it wins.
          const rangeError =
            errors[`schedule.${day}.${String(index)}.0`] ??
            errors[`schedule.${day}.${String(index)}.1`] ??
            errors[`schedule.${day}.${String(index)}`];
          return (
            <div key={index} className="grid gap-1">
              <div className="flex items-center gap-1.5">
                <TimeInput
                  label={strings.rangeStart(name, index)}
                  value={range.start}
                  invalid={rangeError !== undefined}
                  onChange={(start) => {
                    setRange(index, { start });
                  }}
                />
                <span className="text-muted-foreground" aria-hidden>
                  –
                </span>
                <TimeInput
                  label={strings.rangeEnd(name, index)}
                  value={range.end}
                  invalid={rangeError !== undefined}
                  onChange={(end) => {
                    setRange(index, { end });
                  }}
                />
                <button
                  type="button"
                  className={cn(smallButton, "w-8 justify-center px-0")}
                  aria-label={strings.removeRangeLabel(name, index)}
                  onClick={() => {
                    onChange(ranges.filter((_, other) => other !== index));
                  }}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
              {rangeError !== undefined && <FieldError>{rangeError}</FieldError>}
            </div>
          );
        })}
        {open && (
          <div>
            <button
              type="button"
              className={cn(smallButton, "-ml-2")}
              aria-label={strings.addRangeLabel(name)}
              disabled={ranges.length >= MAX_RANGES_PER_DAY}
              onClick={addRange}
            >
              <Plus className="size-3.5" aria-hidden />
              {strings.addRange}
            </button>
          </div>
        )}
        {dayError !== undefined && <FieldError>{dayError}</FieldError>}
      </div>
    </div>
  );
}

/** `HH:MM` as text (a native time input can't hold `24:00`, which the schema allows). */
function TimeInput({
  label,
  value,
  invalid,
  onChange,
}: {
  label: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      aria-label={label}
      aria-invalid={invalid}
      inputMode="numeric"
      autoComplete="off"
      placeholder="09:00"
      maxLength={5}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      className="h-8 w-[4.75rem] px-2 text-center font-mono text-sm tabular-nums"
    />
  );
}

function Holidays({
  draft,
  onChange,
  errors,
}: {
  draft: BusinessHoursDraft;
  onChange: (draft: BusinessHoursDraft) => void;
  errors: FieldErrors;
}) {
  const strings = useWorkflowsStrings();
  const inputId = useId();
  const [date, setDate] = useState("");

  function add() {
    if (date === "" || draft.holidays.includes(date)) return;
    onChange({ ...draft, holidays: [...draft.holidays, date].sort() });
    setDate("");
  }

  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-1 text-sm font-medium">{strings.holidaysLegend}</legend>
      <p className="text-xs text-muted-foreground">{strings.holidaysHint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          {strings.holidayInputLabel}
        </label>
        <Input
          id={inputId}
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          className="h-8 w-auto"
        />
        <button
          type="button"
          className={cn(smallButton, "border")}
          disabled={date === ""}
          onClick={add}
        >
          <Plus className="size-3.5" aria-hidden />
          {strings.addHoliday}
        </button>
      </div>
      {draft.holidays.length === 0 ? (
        <p className="text-xs text-muted-foreground">{strings.noHolidays}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {draft.holidays.map((holiday, index) => {
            const invalid = errors[`holidays.${String(index)}`] !== undefined;
            return (
              <li
                key={`${holiday}-${String(index)}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-xs tabular-nums",
                  invalid && "border-destructive text-destructive",
                )}
              >
                <CalendarX2 className="size-3 text-muted-foreground" aria-hidden />
                {holiday}
                <button
                  type="button"
                  aria-label={strings.removeHolidayLabel(holiday)}
                  className={cn(
                    "grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground",
                    pressClass,
                  )}
                  onClick={() => {
                    onChange({
                      ...draft,
                      holidays: draft.holidays.filter((_, other) => other !== index),
                    });
                  }}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {errorAt(errors, "holidays") !== undefined && (
        <FieldError>{errorAt(errors, "holidays")}</FieldError>
      )}
    </fieldset>
  );
}
