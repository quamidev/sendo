"use client";

import type { InboxConversationCost } from "@quami/sendo";
import { ExternalLinkIcon, QrCodeIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AssigneeAvatar, ContactAvatar } from "./assignee-avatar";
import { ChannelBadge } from "./channel-badge";
import { personName, useInboxPeople } from "./people";
import { useInboxFormat, useInboxLocale, useInboxStrings } from "./strings-context";
import { TagChip } from "./tag-chip";
import type { InboxConversationView, InboxMessageView, InboxNumberView } from "./types";
import { formatCostCents } from "./utils";
import { WindowIndicator } from "./window-indicator";

export interface ContextPanelProps {
  conversation: InboxConversationView;
  /** The conversation's number (label in "Número"). */
  number: InboxNumberView | null;
  /** Loaded thread messages, for the agent cost when `cost` is not known. */
  messages: readonly InboxMessageView[];
  /** Agent turns and cost of the whole conversation (`sendo.inbox.cost`), when loaded. */
  cost?: InboxConversationCost | null;
  /** Admins see the agent cost (`costs.view`). */
  showCost: boolean;
  /** Removes a tag from the conversation; omit to show the tags read-only. */
  onRemoveTag?: (tagId: string) => void;
  /**
   * SND-3.6 slots: the assign menu (supervisor/admin, `listAssignees` + `assign`) replaces the
   * read-only assignee card, and the tag picker (add from the catalog) replaces the tag list.
   */
  assignmentSlot?: ReactNode;
  tagsSlot?: ReactNode;
  className?: string;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1.5 text-right">{children}</dd>
    </>
  );
}

interface CostSummary {
  turns: number;
  cents: number | null;
  /** Turns with no known cost. */
  unpriced: number;
}

/**
 * The conversation's agent cost: the server total when known, else the agent turns of the loaded
 * pages (replies and drafts, like `sendo.inbox.cost`).
 */
export function agentCost(
  messages: readonly InboxMessageView[],
  total: InboxConversationCost | null = null,
): CostSummary {
  if (total !== null) {
    return { turns: total.turns, cents: total.costCents, unpriced: total.unpricedTurns };
  }
  const summary: CostSummary = { turns: 0, cents: null, unpriced: 0 };
  for (const message of messages) {
    if (message.sender !== "agent" || message.internal || message.direction !== "out") continue;
    summary.turns += 1;
    if (message.costCents === null) summary.unpriced += 1;
    else summary.cents = (summary.cents ?? 0) + message.costCents;
  }
  return summary;
}

/**
 * The 300 px context panel (mockup option A): identity and app link, assignment with queue, tags,
 * channel, number, origin, window and, for admins, the agent cost.
 */
export function ContextPanel({
  conversation,
  number,
  messages,
  cost: total = null,
  showCost,
  onRemoveTag,
  assignmentSlot,
  tagsSlot,
  className,
}: ContextPanelProps) {
  const strings = useInboxStrings();
  const format = useInboxFormat();
  const { formatLocale } = useInboxLocale();
  const people = useInboxPeople();
  const { contact, assignee } = conversation;
  const assigneeName =
    assignee === null ? null : (assignee.name ?? personName(assignee.id, people, strings));
  const cost = showCost ? agentCost(messages, total) : null;

  return (
    <div className={cn("flex flex-col gap-6 px-5 py-5", className)} data-slot="context-panel">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <ContactAvatar
          id={contact.id}
          name={contact.displayName}
          channel={conversation.channel}
          size="lg"
        />
        <p className="mt-1 max-w-full font-semibold break-words">{contact.displayName}</p>
        {contact.phone !== null && contact.phone !== contact.displayName && (
          <p className="text-[13px] text-muted-foreground tabular-nums">{contact.phone}</p>
        )}
        {contact.appRef === null ? (
          <p className="text-[13px] text-muted-foreground">{strings.notLinked}</p>
        ) : conversation.appHref === null ? (
          <p
            className="max-w-full truncate text-[13px] text-muted-foreground"
            title={contact.appRef}
          >
            {contact.appRef}
          </p>
        ) : (
          <a
            href={conversation.appHref}
            className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] transition-[color,background-color,border-color] hover:border-ring hover:bg-accent active:bg-accent/70"
            title={contact.appRef}
          >
            <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{strings.openInApp(contact.appRef)}</span>
          </a>
        )}
      </div>

      <Section title={strings.sectionAssignment}>
        {assignmentSlot ?? (
          <div className="flex min-w-0 items-center gap-2.5 rounded-xl border p-2">
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
            <div className="min-w-0 text-sm">
              <p className="truncate">{assigneeName ?? strings.unassigned}</p>
              <p className="truncate text-xs text-muted-foreground">
                {strings.queueLabel(conversation.queue)}
              </p>
            </div>
          </div>
        )}
      </Section>

      <Section title={strings.sectionTags}>
        {tagsSlot ??
          (conversation.tags.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{strings.tagsEmpty}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {conversation.tags.map((tag) => (
                <TagChip
                  key={tag.id}
                  tag={tag}
                  onRemove={
                    onRemoveTag === undefined
                      ? undefined
                      : () => {
                          onRemoveTag(tag.id);
                        }
                  }
                />
              ))}
            </div>
          ))}
      </Section>

      <Section title={strings.sectionConversation}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
          <Field label={strings.fieldChannel}>
            <ChannelBadge channel={conversation.channel} variant="label" />
          </Field>
          {number !== null && (
            <Field label={strings.fieldNumber}>
              <span className="truncate" title={number.displayPhone}>
                {number.active ? number.label : strings.numberDisconnected(number.label)}
              </span>
            </Field>
          )}
          <Field label={strings.fieldOrigin}>
            {conversation.source === null ? (
              strings.originDirect
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                <QrCodeIcon className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{conversation.source}</span>
              </span>
            )}
          </Field>
          <Field label={strings.fieldWindow}>
            <WindowIndicator status={conversation.window} />
          </Field>
        </dl>
      </Section>

      {cost !== null && cost.turns > 0 && (
        <Section title={strings.sectionCost}>
          <p className="flex items-center justify-between gap-3 rounded-lg bg-muted px-2.5 py-2 text-[13px] text-muted-foreground">
            <span className="min-w-0">
              {strings.costTurns(cost.turns, format)}
              {cost.unpriced > 0 && cost.cents !== null && (
                <span className="text-xs"> · {strings.costUnpriced(cost.unpriced, format)}</span>
              )}
            </span>
            <b className="shrink-0 font-semibold text-foreground tabular-nums">
              {cost.cents === null
                ? strings.costUnknown
                : formatCostCents(cost.cents, formatLocale)}
            </b>
          </p>
        </Section>
      )}
    </div>
  );
}
