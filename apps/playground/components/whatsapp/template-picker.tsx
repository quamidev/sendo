"use client";

import { LoaderIcon, SendIcon } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useInboxStrings } from "./strings";
import type { InboxTemplateView } from "./types";

export interface TemplateSendInput {
  name: string;
  language: string;
  variables: string[];
}

export interface TemplatePickerProps {
  /** `null` while loading. */
  templates: InboxTemplateView[] | null;
  loadFailed?: boolean;
  /** Resolves `true` when the template was sent (the form resets). */
  onSend: (input: TemplateSendInput) => Promise<boolean>;
  /** Hides the explanation (when the caller already shows it). */
  hideExplanation?: boolean;
  className?: string;
}

function fillPreview(body: string, variables: string[]): string {
  let index = 0;
  return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (placeholder, key: string) => {
    const position = /^\d+$/.test(key) ? Number(key) - 1 : index++;
    const value = variables[position];
    return value === undefined || value.trim() === "" ? placeholder : value;
  });
}

/** Approved templates with one input per variable; the only way to write once the window closed. */
export function TemplatePicker({
  templates,
  loadFailed = false,
  onSend,
  hideExplanation = false,
  className,
}: TemplatePickerProps) {
  const strings = useInboxStrings();
  const formId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [variables, setVariables] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const selected = templates?.find((template) => template.id === selectedId) ?? null;
  const complete =
    selected !== null &&
    variables.length === selected.variableCount &&
    variables.every((value) => value.trim() !== "");

  function select(id: string) {
    const template = templates?.find((candidate) => candidate.id === id);
    setSelectedId(id);
    setVariables(Array.from({ length: template?.variableCount ?? 0 }, () => ""));
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected === null || !complete || sending) return;
    setSending(true);
    const sent = await onSend({
      name: selected.name,
      language: selected.language,
      variables: variables.map((value) => value.trim()),
    });
    setSending(false);
    if (sent) {
      setSelectedId(null);
      setVariables([]);
    }
  }

  return (
    <form
      className={cn("flex flex-col gap-3", className)}
      onSubmit={(event) => {
        void submit(event);
      }}
      aria-label={strings.templateChoose}
      data-slot="template-picker"
    >
      {!hideExplanation && (
        <p className="text-sm text-pretty text-muted-foreground">{strings.templateExplanation}</p>
      )}

      {templates === null && !loadFailed ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderIcon className="size-4" aria-hidden />
          {strings.templateLoading}
        </p>
      ) : loadFailed ? (
        <p className="text-sm text-destructive">{strings.templatesLoadFailed}</p>
      ) : templates !== null && templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.templateNone}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${formId}-template`}
              className="text-xs font-medium text-muted-foreground"
            >
              {strings.templateLabel}
            </label>
            <Select value={selectedId ?? ""} onValueChange={select}>
              <SelectTrigger
                id={`${formId}-template`}
                className="w-full transition-colors hover:bg-accent/50 active:bg-accent"
              >
                <SelectValue placeholder={strings.templatePlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {templates?.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    <span className="truncate">{template.name}</span>
                    <span className="text-xs text-muted-foreground">{template.language}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selected !== null && selected.body !== null && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap">
              {fillPreview(selected.body, variables)}
            </p>
          )}

          {selected !== null && selected.variableCount > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {variables.map((value, index) => (
                <div key={index} className="flex flex-col gap-1.5">
                  <label
                    htmlFor={`${formId}-var-${String(index)}`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {strings.templateVariable(index + 1)}
                  </label>
                  <Input
                    id={`${formId}-var-${String(index)}`}
                    value={value}
                    onChange={(event) => {
                      const next = [...variables];
                      next[index] = event.target.value;
                      setVariables(next);
                    }}
                    autoComplete="off"
                  />
                </div>
              ))}
            </div>
          )}

          <Button
            type="submit"
            disabled={!complete || sending}
            className="self-end transition-colors active:bg-primary/80"
          >
            {sending ? <LoaderIcon aria-hidden /> : <SendIcon aria-hidden />}
            {sending ? strings.sending : strings.templateSend}
          </Button>
        </>
      )}
    </form>
  );
}
