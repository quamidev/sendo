"use client";

import { CheckIcon, ChevronDownIcon, UserMinusIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AssigneeAvatar } from "./assignee-avatar";
import { InlineMenu, InlineMenuItem } from "./inline-menu";
import { personName, useInboxPeople } from "./people";
import { useInboxStrings } from "./strings-context";
import type { InboxActionResult, InboxAssigneeView, InboxConversationView } from "./types";

export interface AssignMenuProps {
  conversation: InboxConversationView;
  /** People the conversation can be assigned to (`resolveAssignees` for its queue). */
  listAssignees: () => Promise<InboxActionResult<InboxAssigneeView[]>>;
  /** `null` unassigns. Resolves `true` when it was saved. */
  onAssign: (userId: string | null) => Promise<boolean>;
  className?: string;
}

/**
 * The assignee card of the context panel as a menu (supervisor and admin, AC-IB-5): assign to
 * myself, to anyone `listAssignees` returns, or remove the assignment.
 */
export function AssignMenu({ conversation, listAssignees, onAssign, className }: AssignMenuProps) {
  const strings = useInboxStrings();
  const people = useInboxPeople();
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [assignees, setAssignees] = useState<InboxAssigneeView[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const loadSeq = useRef(0);

  const { assignee, assignedTo } = conversation;
  const assigneeName =
    assignee === null ? null : (assignee.name ?? personName(assignee.id, people, strings));
  const me = people.currentUserId;

  async function load() {
    loadSeq.current += 1;
    const seq = loadSeq.current;
    setLoadFailed(false);
    const result = await listAssignees();
    if (seq !== loadSeq.current) return;
    if (result.ok) setAssignees(result.data);
    else setLoadFailed(true);
  }

  function toggle() {
    if (!open) void load();
    setOpen(!open);
  }

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  async function choose(userId: string | null) {
    if (userId === assignedTo) {
      close();
      return;
    }
    setPending(true);
    const saved = await onAssign(userId);
    setPending(false);
    if (saved) close();
  }

  const others = (assignees ?? []).filter((person) => person.id !== me);

  return (
    <div className={cn("flex flex-col", className)} data-slot="assign-menu">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${strings.assignMenuLabel}: ${assigneeName ?? strings.unassigned}`}
        onClick={toggle}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-xl border p-2 text-left outline-none transition-[color,background-color,border-color] duration-[var(--sendo-dur-fast)] hover:border-ring hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent/70 aria-expanded:border-ring"
      >
        {assignee === null ? (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs text-muted-foreground">
            —
          </span>
        ) : (
          <AssigneeAvatar
            id={assignee.id}
            name={assigneeName}
            avatarUrl={assignee.avatarUrl}
            size="sm"
          />
        )}
        <span className="min-w-0 flex-1 text-sm">
          <span className="block truncate">{assigneeName ?? strings.unassigned}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {strings.queueLabel(conversation.queue)}
          </span>
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <InlineMenu id={menuId} label={strings.assignMenuLabel} open={open} onClose={close}>
        <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {strings.assignMenuLabel}
        </p>
        <InlineMenuItem
          checked={assignedTo === me}
          disabled={pending}
          onSelect={() => {
            void choose(me);
          }}
        >
          <AssigneeAvatar id={me} name={people.currentUserName} size="sm" className="size-6" />
          <span className="min-w-0 flex-1 truncate">{strings.assignToMe}</span>
          {assignedTo === me && <CheckIcon className="size-4 shrink-0" aria-hidden />}
        </InlineMenuItem>
        {assignees === null && !loadFailed ? (
          <p className="px-2 py-1.5 text-[12.5px] text-muted-foreground" role="status">
            {strings.assigneesLoading}
          </p>
        ) : loadFailed ? (
          <p className="px-2 py-1.5 text-[12.5px] text-destructive" role="status">
            {strings.loadFailed}
          </p>
        ) : assignees?.length === 0 ? (
          <p className="px-2 py-1.5 text-[12.5px] text-muted-foreground">
            {strings.assigneesEmpty}
          </p>
        ) : (
          others.map((person) => {
            const name = person.name ?? personName(person.id, people, strings);
            return (
              <InlineMenuItem
                key={person.id}
                checked={assignedTo === person.id}
                disabled={pending}
                title={name}
                onSelect={() => {
                  void choose(person.id);
                }}
              >
                <AssigneeAvatar
                  id={person.id}
                  name={name}
                  avatarUrl={person.avatarUrl}
                  size="sm"
                  className="size-6"
                />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {assignedTo === person.id && <CheckIcon className="size-4 shrink-0" aria-hidden />}
              </InlineMenuItem>
            );
          })
        )}
        {assignedTo !== null && (
          <InlineMenuItem
            disabled={pending}
            onSelect={() => {
              void choose(null);
            }}
          >
            <span className="grid size-6 shrink-0 place-items-center text-muted-foreground">
              <UserMinusIcon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate">{strings.unassign}</span>
          </InlineMenuItem>
        )}
      </InlineMenu>
    </div>
  );
}
