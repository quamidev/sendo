"use client";

import type { RuleType } from "@quami/sendo/rules";
import { AlertCircle, Plus, Workflow, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { pressClass } from "./press";
import { RuleEditor } from "./rule-editor";
import { RuleRow } from "./rule-row";
import { resolveWorkflowsStrings, type WorkflowsStrings } from "./strings";
import type {
  RuleNumberView,
  RuleRowView,
  RulesActions,
  SaveRuleInput,
  WorkflowsActionResult,
} from "./types";
import { useReorderMotion } from "./use-reorder-motion";

export interface RulesScreenProps {
  initialRules: RuleRowView[];
  /** The tenant's numbers (including disconnected ones, to name the rules that point at them). */
  numbers: RuleNumberView[];
  actions: RulesActions;
  /** The signed-in user, to say "Editada por ti". */
  currentUserId?: string | null;
  className?: string;
  strings?: Partial<WorkflowsStrings>;
}

type EditorState = { open: boolean; rule: RuleRowView | null; type: RuleType; key: number };

/** The "Reglas" screen: ordered rules with on/off, move up/down, edit, delete and create. */
export function RulesScreen({
  initialRules,
  numbers,
  actions,
  currentUserId = null,
  className,
  strings: overrides,
}: RulesScreenProps) {
  const strings = resolveWorkflowsStrings(overrides);
  const [rules, setRules] = useState(initialRules);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [editor, setEditor] = useState<EditorState>({
    open: false,
    rule: null,
    type: "business_hours",
    key: 0,
  });
  const [deleting, setDeleting] = useState<RuleRowView | null>(null);
  const rowRef = useReorderMotion(rules.map((rule) => rule.id));

  function setBusy(id: string, busy: boolean) {
    setPending((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function failure(result: Extract<WorkflowsActionResult<unknown>, { ok: false }>): string {
    return result.code === "INVALID" ? result.message : strings.errorMessages[result.code];
  }

  /** Optimistic change, then the server's list (or a rollback and the error). */
  async function mutate(
    id: string,
    optimistic: RuleRowView[] | null,
    call: () => Promise<WorkflowsActionResult<RuleRowView[]>>,
    done?: string,
  ): Promise<boolean> {
    const before = rules;
    if (optimistic !== null) setRules(optimistic);
    setBusy(id, true);
    setError(null);
    const result = await call();
    setBusy(id, false);
    if (result.ok) {
      setRules(result.data);
      if (done !== undefined) setAnnouncement(done);
      return true;
    }
    setRules(before);
    setError(failure(result));
    return false;
  }

  function toggle(rule: RuleRowView, enabled: boolean) {
    void mutate(
      rule.id,
      rules.map((other) => (other.id === rule.id ? { ...other, active: enabled } : other)),
      () => actions.toggleRule(rule.id, enabled),
    );
  }

  function move(rule: RuleRowView, direction: -1 | 1) {
    const from = rules.findIndex((other) => other.id === rule.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= rules.length) return;
    const next = [...rules];
    next.splice(from, 1);
    next.splice(to, 0, rule);
    setAnnouncement(strings.moved(rule.key, to + 1, next.length));
    // Keep the keyboard on the moved rule: the same arrow, or the other one at the ends.
    const atEnd = to === 0 || to === next.length - 1;
    const arrow = atEnd ? (direction === -1 ? "down" : "up") : direction === -1 ? "up" : "down";
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-move="${CSS.escape(`${rule.id}:${arrow}`)}"]`)
        ?.focus();
    });
    void mutate(rule.id, next, () => actions.reorderRules(next.map((other) => other.id)));
  }

  async function save(input: SaveRuleInput) {
    const result = await actions.saveRule(input);
    if (result.ok) {
      setRules(result.data);
      setError(null);
      setAnnouncement(strings.saved(input.key));
    }
    return result;
  }

  async function confirmDelete(rule: RuleRowView) {
    const ok = await mutate(
      rule.id,
      null,
      () => actions.deleteRule(rule.id),
      strings.deleted(rule.key),
    );
    if (ok) setDeleting(null);
  }

  async function reload() {
    setError(null);
    const result = await actions.listRules();
    if (result.ok) setRules(result.data);
    else setError(failure(result));
  }

  function openEditor(rule: RuleRowView | null, type: RuleType = "business_hours") {
    setEditor((current) => ({ open: true, rule, type, key: current.key + 1 }));
  }

  return (
    <div className={cn("mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 md:p-8", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex max-w-2xl min-w-0 flex-col gap-1">
          <h1 className="text-[17px] font-[650] tracking-[-0.01em]">{strings.pageTitle}</h1>
          <p className="text-sm text-muted-foreground">{strings.pageDescription}</p>
        </div>
        {rules.length > 0 && (
          <Button
            className={pressClass}
            onClick={() => {
              openEditor(null);
            }}
          >
            <Plus aria-hidden />
            {strings.newRule}
          </Button>
        )}
      </header>

      {error !== null && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">{error}</p>
          <button
            type="button"
            className={cn(
              "shrink-0 rounded-md px-2 text-xs font-medium underline-offset-2 hover:underline",
              pressClass,
            )}
            onClick={() => void reload()}
          >
            {strings.retry}
          </button>
          <button
            type="button"
            aria-label={strings.dismiss}
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-md hover:bg-destructive/10",
              pressClass,
            )}
            onClick={() => {
              setError(null);
            }}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}

      {rules.length === 0 ? (
        <EmptyState
          strings={strings}
          onCreate={() => {
            openEditor(null);
          }}
        />
      ) : (
        <section className="overflow-hidden rounded-xl border bg-background">
          <p className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            {strings.orderHint}
          </p>
          <ol aria-label={strings.listLabel} className="relative divide-y">
            {rules.map((rule, index) => (
              <li key={rule.id} ref={rowRef(rule.id)} className="relative bg-background">
                <RuleRow
                  rule={rule}
                  index={index}
                  total={rules.length}
                  numbers={numbers}
                  currentUserId={currentUserId}
                  pending={pending.has(rule.id)}
                  strings={strings}
                  onToggle={(enabled) => {
                    toggle(rule, enabled);
                  }}
                  onMove={(direction) => {
                    move(rule, direction);
                  }}
                  onEdit={() => {
                    openEditor(rule);
                  }}
                  onDelete={() => {
                    setDeleting(rule);
                  }}
                />
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <RuleEditor
        key={editor.key}
        open={editor.open}
        rule={editor.rule}
        initialType={editor.type}
        numbers={numbers}
        takenKeys={rules.map((rule) => rule.key)}
        strings={strings}
        onOpenChange={(open) => {
          setEditor((current) => ({ ...current, open }));
        }}
        onSave={save}
      />

      <DeleteRuleDialog
        rule={deleting}
        pending={deleting !== null && pending.has(deleting.id)}
        strings={strings}
        onCancel={() => {
          setDeleting(null);
        }}
        onConfirm={(rule) => void confirmDelete(rule)}
      />
    </div>
  );
}

function EmptyState({ strings, onCreate }: { strings: WorkflowsStrings; onCreate: () => void }) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-background px-6 py-12 text-center">
      <div
        className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground"
        aria-hidden
      >
        <Workflow className="size-5" />
      </div>
      <h2 className="text-[15px] font-[650]">{strings.emptyTitle}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{strings.emptyBody}</p>
      <Button className={cn("mt-1", pressClass)} onClick={onCreate}>
        <Plus aria-hidden />
        {strings.createFirst}
      </Button>
      <p className="max-w-md text-xs text-muted-foreground">{strings.emptyCodeHint}</p>
    </section>
  );
}

function DeleteRuleDialog({
  rule,
  pending,
  strings,
  onCancel,
  onConfirm,
}: {
  rule: RuleRowView | null;
  pending: boolean;
  strings: WorkflowsStrings;
  onCancel: () => void;
  onConfirm: (rule: RuleRowView) => void;
}) {
  return (
    <Dialog
      open={rule !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md motion-reduce:[--tw-enter-scale:1] motion-reduce:[--tw-exit-scale:1]">
        <DialogHeader>
          <DialogTitle className="break-words [overflow-wrap:anywhere]">
            {rule === null ? "" : strings.deleteTitle(rule.key)}
          </DialogTitle>
          <DialogDescription>
            {rule?.origin === "code" ? strings.deleteCodeBody : strings.deleteBody}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={pending} className={pressClass} onClick={onCancel}>
            {strings.cancel}
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            className={pressClass}
            onClick={() => {
              if (rule !== null) onConfirm(rule);
            }}
          >
            {strings.deleteConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Full-page message (no access). */
export function RulesNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-[17px] font-[650]">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
