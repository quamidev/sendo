"use client";

import type { SnippetVisibility } from "@quami/sendo";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useId, useState, type SyntheticEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ConfirmRow, ManagerSheet } from "./manager-sheet";
import { SNIPPET_BODY_MAX_LENGTH, SNIPPET_SHORTCUT } from "@quami/sendo/snippets";
import { useInboxStrings } from "./strings-context";
import { pressClass } from "./transitions";
import type {
  InboxActionResult,
  InboxNumberView,
  InboxSnippetInput,
  InboxSnippetView,
} from "./types";

const ALL_NUMBERS = "__all__";

export interface SnippetsManagerActions {
  listSnippets: (conversationId: null) => Promise<InboxActionResult<InboxSnippetView[]>>;
  upsertSnippet: (input: InboxSnippetInput) => Promise<InboxActionResult<InboxSnippetView>>;
  deleteSnippet: (snippetId: string) => Promise<InboxActionResult<null>>;
}

export interface SnippetsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: SnippetsManagerActions;
  /** Admin (`snippets.manage_tenant`): team snippets. Everyone manages their own personal ones. */
  canManageTenant: boolean;
  /** The tenant's numbers, for the optional number scope. */
  numbers?: readonly InboxNumberView[];
}

/** Shortcuts are ASCII identifiers (`SNIPPET_SHORTCUT`), so code-point order is the same in every language. */
function byShortcut(a: InboxSnippetView, b: InboxSnippetView): number {
  return a.shortcut < b.shortcut ? -1 : a.shortcut > b.shortcut ? 1 : 0;
}

interface SnippetFormProps {
  initial: InboxSnippetView | null;
  canManageTenant: boolean;
  numbers: readonly InboxNumberView[];
  onSave: (input: InboxSnippetInput) => Promise<InboxActionResult<InboxSnippetView>>;
  onDone: (saved: InboxSnippetView | null) => void;
}

function SnippetForm({ initial, canManageTenant, numbers, onSave, onDone }: SnippetFormProps) {
  const strings = useInboxStrings();
  const formId = useId();
  const [shortcut, setShortcut] = useState(initial?.shortcut ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [visibility, setVisibility] = useState<SnippetVisibility>(
    initial?.visibility ?? (canManageTenant ? "tenant" : "personal"),
  );
  const [accountId, setAccountId] = useState<string | null>(initial?.accountId ?? null);
  const [taken, setTaken] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const cleanShortcut = shortcut.trim().replace(/^\//, "");
  const shortcutValid = SNIPPET_SHORTCUT.test(cleanShortcut);
  const bodyValid = body.trim() !== "" && body.length <= SNIPPET_BODY_MAX_LENGTH;

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!shortcutValid || !bodyValid || saving) return;
    setSaving(true);
    const result = await onSave({
      ...(initial !== null && { id: initial.id }),
      shortcut: cleanShortcut,
      body,
      visibility,
      accountId,
    });
    setSaving(false);
    if (result.ok) {
      onDone(result.data);
      return;
    }
    if (result.code === "CONFLICT") setTaken(true);
    else toast.error(strings.managerSaveFailed, { description: result.message });
  }

  const shortcutError = taken
    ? strings.snippetShortcutTaken
    : touched && !shortcutValid
      ? strings.snippetShortcutHint
      : null;
  // Only the team snippet the operator can't manage stays as it is.
  const scopeLocked = !canManageTenant;
  const scopes: SnippetVisibility[] = ["tenant", "personal"];

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-3"
      aria-label={initial === null ? strings.snippetNew : `/${initial.shortcut}`}
      data-slot="snippet-form"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-shortcut`} className="text-xs font-medium">
          {strings.snippetShortcut}
        </label>
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground" aria-hidden>
            /
          </span>
          <Input
            id={`${formId}-shortcut`}
            value={shortcut}
            onChange={(event) => {
              setShortcut(event.target.value.toLowerCase());
              setTaken(false);
            }}
            maxLength={33}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            aria-invalid={shortcutError !== null || undefined}
            aria-describedby={`${formId}-shortcut-hint`}
            className="h-8 font-mono text-sm"
          />
        </div>
        <p
          id={`${formId}-shortcut-hint`}
          className={cn(
            "text-xs",
            shortcutError === null ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {shortcutError ?? strings.snippetShortcutHint}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-body`} className="text-xs font-medium">
          {strings.snippetBody}
        </label>
        <Textarea
          id={`${formId}-body`}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
          }}
          rows={4}
          maxLength={SNIPPET_BODY_MAX_LENGTH}
          aria-invalid={(touched && !bodyValid) || undefined}
          aria-describedby={`${formId}-body-hint`}
          className="max-h-60 min-h-24 text-sm"
        />
        <p id={`${formId}-body-hint`} className="text-xs text-muted-foreground">
          {strings.snippetBodyHint}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium">{strings.snippetVisibility}</legend>
          <div className="inline-flex rounded-lg bg-muted p-0.5" role="radiogroup">
            {scopes.map((scope) => (
              <button
                key={scope}
                type="button"
                role="radio"
                aria-checked={visibility === scope}
                disabled={scopeLocked}
                onClick={() => {
                  setVisibility(scope);
                }}
                className="rounded-md px-2.5 py-1 text-[12.5px] text-muted-foreground outline-none transition-colors duration-[var(--sendo-dur-fast)] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-[0_1px_2px_rgb(0_0_0/0.08)] disabled:aria-[checked=false]:opacity-50"
              >
                {scope === "tenant" ? strings.snippetScopeTenant : strings.snippetScopePersonal}
              </button>
            ))}
          </div>
        </fieldset>
        {numbers.length > 1 && (
          <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1.5">
            <label htmlFor={`${formId}-number`} className="text-xs font-medium">
              {strings.numberLabel}
            </label>
            <Select
              value={accountId ?? ALL_NUMBERS}
              onValueChange={(value) => {
                setAccountId(value === ALL_NUMBERS ? null : value);
              }}
            >
              <SelectTrigger id={`${formId}-number`} size="sm" className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_NUMBERS}>{strings.numberAll}</SelectItem>
                {numbers.map((number) => (
                  <SelectItem key={number.id} value={number.id}>
                    <span className="truncate">{number.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="active:bg-accent/70"
          onClick={() => {
            onDone(null);
          }}
        >
          {strings.managerCancel}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={saving}
          className={cn("active:bg-primary/80", pressClass)}
        >
          {strings.managerSave}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Respuestas rápidas" (AC-SN-1): team snippets for admins, personal ones for everyone. The
 * package checks every change again (`snippets.manage_tenant`, owner, unique shortcut).
 */
export function SnippetsManager({
  open,
  onOpenChange,
  actions,
  canManageTenant,
  numbers = [],
}: SnippetsManagerProps) {
  const strings = useInboxStrings();
  const [snippets, setSnippets] = useState<InboxSnippetView[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  /** `"new"`, a snippet id being edited, or nothing. */
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { listSnippets } = actions;

  useEffect(() => {
    if (!open) return;
    let active = true;
    void listSnippets(null).then(
      (result) => {
        if (!active) return;
        setLoadFailed(!result.ok);
        if (result.ok) setSnippets([...result.data].sort(byShortcut));
      },
      () => {
        if (active) setLoadFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [open, listSnippets]);

  function changeOpen(next: boolean) {
    if (!next) {
      setEditing(null);
      setConfirming(null);
    }
    onOpenChange(next);
  }

  function saved(snippet: InboxSnippetView | null) {
    setEditing(null);
    if (snippet === null) return;
    setSnippets((current) =>
      [...(current ?? []).filter((item) => item.id !== snippet.id), snippet].sort(byShortcut),
    );
  }

  async function remove(snippet: InboxSnippetView) {
    setDeleting(true);
    const result = await actions.deleteSnippet(snippet.id);
    setDeleting(false);
    if (!result.ok && result.code !== "NOT_FOUND") {
      toast.error(strings.managerSaveFailed, { description: result.message });
      return;
    }
    setConfirming(null);
    setSnippets((current) => (current ?? []).filter((item) => item.id !== snippet.id));
  }

  const numberLabel = (accountId: string | null) =>
    accountId === null ? null : (numbers.find((number) => number.id === accountId)?.label ?? null);

  return (
    <ManagerSheet
      open={open}
      onOpenChange={changeOpen}
      title={strings.snippetsManagerTitle}
      description={strings.snippetsManagerDescription}
      actions={
        <Button
          type="button"
          size="sm"
          className={cn("active:bg-primary/80", pressClass)}
          disabled={editing === "new"}
          onClick={() => {
            setConfirming(null);
            setEditing("new");
          }}
        >
          <PlusIcon aria-hidden />
          {strings.snippetNew}
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-slot="snippets-manager">
        {editing === "new" && (
          <SnippetForm
            initial={null}
            canManageTenant={canManageTenant}
            numbers={numbers}
            onSave={actions.upsertSnippet}
            onDone={saved}
          />
        )}
        {snippets === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            {loadFailed ? strings.loadFailed : strings.loadingOlder}
          </p>
        ) : snippets.length === 0 && editing !== "new" ? (
          <p className="text-sm text-muted-foreground">{strings.snippetsEmpty}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {snippets.map((snippet) => {
              const editable = snippet.visibility === "personal" ? snippet.own : canManageTenant;
              const number = numberLabel(snippet.accountId);
              if (editing === snippet.id) {
                return (
                  <li key={snippet.id} className="py-3">
                    <SnippetForm
                      initial={snippet}
                      canManageTenant={canManageTenant}
                      numbers={numbers}
                      onSave={actions.upsertSnippet}
                      onDone={saved}
                    />
                  </li>
                );
              }
              return (
                <li key={snippet.id} className="py-3" data-snippet-id={snippet.id}>
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <b className="min-w-0 truncate font-mono text-[13px] font-semibold">
                          /{snippet.shortcut}
                        </b>
                        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {snippet.visibility === "personal"
                            ? strings.snippetScopePersonal
                            : strings.snippetScopeTenant}
                        </span>
                        {number !== null && (
                          <span
                            className="max-w-40 truncate rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground"
                            title={number}
                          >
                            {number}
                          </span>
                        )}
                      </p>
                      <p className="mt-1 line-clamp-2 text-[13px] break-words whitespace-pre-line text-muted-foreground">
                        {snippet.body}
                      </p>
                    </div>
                    {editable && confirming !== snippet.id && (
                      <div className="flex shrink-0 gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground transition-colors active:bg-accent/70"
                          aria-label={`${strings.draftEdit} /${snippet.shortcut}`}
                          title={strings.draftEdit}
                          onClick={() => {
                            setConfirming(null);
                            setEditing(snippet.id);
                          }}
                        >
                          <PencilIcon aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground transition-colors hover:text-destructive active:bg-accent/70"
                          aria-label={`${strings.managerDelete} /${snippet.shortcut}`}
                          title={strings.managerDelete}
                          onClick={() => {
                            setEditing(null);
                            setConfirming(snippet.id);
                          }}
                        >
                          <Trash2Icon aria-hidden />
                        </Button>
                      </div>
                    )}
                  </div>
                  {confirming === snippet.id && (
                    <ConfirmRow
                      text={strings.snippetDeleteConfirm(snippet.shortcut)}
                      confirmLabel={strings.managerDelete}
                      cancelLabel={strings.managerCancel}
                      pending={deleting}
                      onCancel={() => {
                        setConfirming(null);
                      }}
                      onConfirm={() => {
                        void remove(snippet);
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ManagerSheet>
  );
}
