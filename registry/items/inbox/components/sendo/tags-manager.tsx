"use client";

import type { TagColor } from "@quami/sendo";
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ConfirmRow, ManagerSheet } from "./manager-sheet";
import { TAG_NAME_MAX_LENGTH } from "@quami/sendo/snippets";
import { useInboxFormat, useInboxStrings } from "./strings-context";
import { TAG_DOT_CLASS } from "./tag-chip";

/** The fixed palette (`TAG_COLORS`), in the package's order. */
const TAG_COLORS = Object.keys(TAG_DOT_CLASS) as TagColor[];
import { pressClass } from "./transitions";
import type { InboxActionResult, InboxTagInput, InboxTagView } from "./types";

export interface TagsManagerActions {
  upsertTag: (input: InboxTagInput) => Promise<InboxActionResult<InboxTagView>>;
  deleteTag: (tagId: string) => Promise<InboxActionResult<null>>;
  tagUsage: (tagId: string) => Promise<InboxActionResult<number>>;
}

export interface TagsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tenant's catalog (owned by the inbox, so filters and chips update with it). */
  catalog: readonly InboxTagView[];
  actions: TagsManagerActions;
  onSaved: (tag: InboxTagView) => void;
  onDeleted: (tagId: string) => void;
}

/** The fixed palette as a radio group of swatches; arrows move the choice. */
function ColorPalette({
  value,
  onChange,
  labelledBy,
}: {
  value: TagColor;
  onChange: (color: TagColor) => void;
  labelledBy: string;
}) {
  const strings = useInboxStrings();

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next =
      TAG_COLORS[(TAG_COLORS.indexOf(value) + step + TAG_COLORS.length) % TAG_COLORS.length];
    if (next === undefined) return;
    onChange(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-color="${next}"]`)?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="flex flex-wrap gap-1.5"
      onKeyDown={onKeyDown}
    >
      {TAG_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={strings.tagColorName(color)}
          title={strings.tagColorName(color)}
          tabIndex={value === color ? 0 : -1}
          data-color={color}
          onClick={() => {
            onChange(color);
          }}
          className={cn(
            "grid size-7 place-items-center rounded-full border border-transparent outline-none hover:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-checked:border-foreground",
            pressClass,
          )}
        >
          <span className={cn("grid size-4 place-items-center rounded-full", TAG_DOT_CLASS[color])}>
            {value === color && <CheckIcon className="size-3 text-white" aria-hidden />}
          </span>
        </button>
      ))}
    </div>
  );
}

function TagForm({
  initial,
  onSave,
  onDone,
}: {
  initial: InboxTagView | null;
  onSave: TagsManagerActions["upsertTag"];
  onDone: (saved: InboxTagView | null) => void;
}) {
  const strings = useInboxStrings();
  const formId = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState<TagColor>(initial?.color ?? "gray");
  const [taken, setTaken] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const valid = name.trim() !== "" && name.trim().length <= TAG_NAME_MAX_LENGTH;

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!valid || saving) return;
    setSaving(true);
    const result = await onSave({
      ...(initial !== null && { id: initial.id }),
      name: name.trim(),
      color,
    });
    setSaving(false);
    if (result.ok) {
      onDone(result.data);
      return;
    }
    if (result.code === "CONFLICT") setTaken(true);
    else toast.error(strings.managerSaveFailed, { description: result.message });
  }

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-3"
      aria-label={initial === null ? strings.tagNew : initial.name}
      data-slot="tag-form"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-name`} className="text-xs font-medium">
          {strings.tagName}
        </label>
        <Input
          id={`${formId}-name`}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setTaken(false);
          }}
          maxLength={TAG_NAME_MAX_LENGTH}
          autoComplete="off"
          autoFocus
          aria-invalid={taken || (touched && !valid) || undefined}
          aria-describedby={taken ? `${formId}-taken` : undefined}
          className="h-8 text-sm"
        />
        {taken && (
          <p id={`${formId}-taken`} className="text-xs text-destructive">
            {strings.tagNameTaken}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span id={`${formId}-color`} className="text-xs font-medium">
          {strings.tagColor}
        </span>
        <ColorPalette value={color} onChange={setColor} labelledBy={`${formId}-color`} />
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
 * "Etiquetas" (AC-TG-1/4): the tenant's catalog with a name and a palette colour. Deleting asks
 * first and shows how many conversations carry the tag.
 */
export function TagsManager({
  open,
  onOpenChange,
  catalog,
  actions,
  onSaved,
  onDeleted,
}: TagsManagerProps) {
  const strings = useInboxStrings();
  const format = useInboxFormat();
  const [editing, setEditing] = useState<string | null>(null);
  /** The tag being deleted and how many conversations carry it (`null` while counting). */
  const [confirming, setConfirming] = useState<{ id: string; usage: number | null } | null>(null);
  const [deleting, setDeleting] = useState(false);

  function changeOpen(next: boolean) {
    if (!next) {
      setEditing(null);
      setConfirming(null);
    }
    onOpenChange(next);
  }

  function saved(tag: InboxTagView | null) {
    setEditing(null);
    if (tag !== null) onSaved(tag);
  }

  async function askDelete(tag: InboxTagView) {
    setEditing(null);
    setConfirming({ id: tag.id, usage: null });
    const result = await actions.tagUsage(tag.id);
    if (!result.ok) {
      setConfirming(null);
      toast.error(strings.loadFailed, { description: result.message });
      return;
    }
    setConfirming((current) =>
      current?.id === tag.id ? { id: tag.id, usage: result.data } : current,
    );
  }

  async function remove(tag: InboxTagView) {
    setDeleting(true);
    const result = await actions.deleteTag(tag.id);
    setDeleting(false);
    if (!result.ok && result.code !== "NOT_FOUND") {
      toast.error(strings.managerSaveFailed, { description: result.message });
      return;
    }
    setConfirming(null);
    onDeleted(tag.id);
  }

  return (
    <ManagerSheet
      open={open}
      onOpenChange={changeOpen}
      title={strings.tagsManagerTitle}
      description={strings.tagsManagerDescription}
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
          {strings.tagNew}
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-slot="tags-manager">
        {editing === "new" && <TagForm initial={null} onSave={actions.upsertTag} onDone={saved} />}
        {catalog.length === 0 && editing !== "new" ? (
          <p className="text-sm text-muted-foreground">{strings.tagsCatalogEmpty}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {catalog.map((tag) =>
              editing === tag.id ? (
                <li key={tag.id} className="py-3">
                  <TagForm initial={tag} onSave={actions.upsertTag} onDone={saved} />
                </li>
              ) : (
                <li key={tag.id} className="py-2.5" data-tag-id={tag.id}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn("size-2.5 shrink-0 rounded-full", TAG_DOT_CLASS[tag.color])}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-sm" title={tag.name}>
                      {tag.name}
                    </span>
                    <span className="sr-only">{strings.tagColorName(tag.color)}</span>
                    {confirming?.id !== tag.id && (
                      <div className="flex shrink-0 gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground transition-colors active:bg-accent/70"
                          aria-label={`${strings.draftEdit} ${tag.name}`}
                          title={strings.draftEdit}
                          onClick={() => {
                            setConfirming(null);
                            setEditing(tag.id);
                          }}
                        >
                          <PencilIcon aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground transition-colors hover:text-destructive active:bg-accent/70"
                          aria-label={`${strings.managerDelete} ${tag.name}`}
                          title={strings.managerDelete}
                          onClick={() => {
                            void askDelete(tag);
                          }}
                        >
                          <Trash2Icon aria-hidden />
                        </Button>
                      </div>
                    )}
                  </div>
                  {confirming?.id === tag.id &&
                    (confirming.usage === null ? (
                      <p className="mt-2 text-[13px] text-muted-foreground" role="status">
                        {strings.loadingOlder}
                      </p>
                    ) : (
                      <ConfirmRow
                        text={strings.tagDeleteConfirm(tag.name, confirming.usage, format)}
                        confirmLabel={strings.managerDelete}
                        cancelLabel={strings.managerCancel}
                        pending={deleting}
                        onCancel={() => {
                          setConfirming(null);
                        }}
                        onConfirm={() => {
                          void remove(tag);
                        }}
                      />
                    ))}
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </ManagerSheet>
  );
}
