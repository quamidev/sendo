"use server";

import {
  assertCan,
  isSendoError,
  type Actor,
  type BroadcastCreateInput,
  type BroadcastRecipientInput,
} from "@quami/sendo";
import {
  MAX_RATE,
  RECIPIENT_STATUS_ORDER,
  RECIPIENTS_PAGE,
  serializeBroadcast,
  serializePreview,
  serializeRecipient,
  serializeTemplate,
  type BroadcastAudienceView,
  type BroadcastDraft,
  type BroadcastPreviewView,
  type BroadcastRecipientRowView,
  type BroadcastsActionResult,
  type BroadcastsErrorCode,
  type BroadcastSummaryView,
  type BroadcastTemplateView,
  type PageView,
  type RecipientsQuery,
} from "@/components/sendo/broadcasts/types";
import { sendo } from "@/lib/sendo";
import {
  broadcastAudiences,
  requireUser,
  type BroadcastAudienceContext,
  type BroadcastsUser,
} from "./broadcasts-config";

class InvalidInputError extends Error {}
class AudienceError extends Error {
  constructor(
    message: string,
    readonly empty = false,
  ) {
    super(message);
  }
}

function errorCode(error: unknown): BroadcastsErrorCode {
  if (error instanceof InvalidInputError) return "INVALID";
  if (error instanceof AudienceError) return error.empty ? "EMPTY_AUDIENCE" : "AUDIENCE";
  if (!isSendoError(error)) return "UNKNOWN";
  switch (error.code) {
    case "FORBIDDEN":
      return "FORBIDDEN";
    case "RECORD_NOT_FOUND":
    case "ACCOUNT_NOT_FOUND":
      return "NOT_FOUND";
    case "TEMPLATE_NOT_FOUND":
      return "TEMPLATE";
    case "TEMPLATE_VARIABLES":
      return "VARIABLES";
    case "INVALID_PAYLOAD":
    case "AMBIGUOUS_ACCOUNT":
      return "INVALID";
    default:
      return "UNKNOWN";
  }
}

/** Runs `fn` and turns errors into `{ ok: false }`. Library errors carry user-safe messages. */
async function attempt<T>(fn: () => Promise<T>): Promise<BroadcastsActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    const code = errorCode(error);
    if (code === "UNKNOWN" || code === "AUDIENCE") console.error("[sendo broadcasts]", error);
    const message =
      error instanceof Error && (code !== "UNKNOWN" || isSendoError(error))
        ? error.message
        : "Unexpected error";
    const expected =
      isSendoError(error) && error.code === "TEMPLATE_VARIABLES" && "expected" in error
        ? Number(error.expected)
        : undefined;
    return { ok: false, code, message, ...(expected !== undefined && { expected }) };
  }
}

/** Broadcasts are an admin tool (`broadcasts.manage`), scoped to the user's tenant. */
async function actorOf(user: BroadcastsUser): Promise<Actor> {
  const actor = await sendo.actor(user.userId, user.tenantId);
  assertCan(actor, "broadcasts.manage");
  return actor;
}

function requireString(value: unknown, field: string, max = 512): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new InvalidInputError(`Invalid ${field}`);
  }
  return value;
}

function optionalCursor(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, "cursor", 2048);
}

function parseDraft(draft: BroadcastDraft): BroadcastDraft {
  if (typeof draft !== "object") throw new InvalidInputError("Invalid broadcast");
  const variables: unknown = draft.variables;
  if (
    variables !== null &&
    (!Array.isArray(variables) ||
      variables.length > 100 ||
      !variables.every((value) => typeof value === "string" && value.length <= 1024))
  ) {
    throw new InvalidInputError("Invalid variables");
  }
  const rate: unknown = draft.ratePerMinute;
  if (typeof rate !== "number" || !Number.isInteger(rate) || rate < 1 || rate > MAX_RATE) {
    throw new InvalidInputError("Invalid ratePerMinute");
  }
  return {
    account: requireString(draft.account, "number", 200),
    template: requireString(draft.template, "template"),
    language: requireString(draft.language, "language", 32),
    audience: requireString(draft.audience, "audience"),
    variables: variables as string[] | null,
    ratePerMinute: rate,
  };
}

/** The draft as `sendo.broadcasts` input; the audience is resolved here, on the server. */
async function broadcastInput(
  user: BroadcastsUser,
  actor: Actor,
  raw: BroadcastDraft,
): Promise<BroadcastCreateInput> {
  const draft = parseDraft(raw);
  const ctx: BroadcastAudienceContext = { user, actor, accountId: draft.account };
  let recipients: BroadcastRecipientInput[];
  try {
    const offered = await broadcastAudiences.list(ctx);
    if (!offered.some((audience) => audience.id === draft.audience)) {
      throw new InvalidInputError("Unknown audience");
    }
    recipients = await broadcastAudiences.recipients(draft.audience, ctx);
  } catch (error) {
    if (error instanceof InvalidInputError) throw error;
    throw new AudienceError(error instanceof Error ? error.message : "Audience failed");
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new AudienceError("The audience has no recipients", true);
  }
  return {
    actor,
    account: draft.account,
    tenant: actor.tenantId,
    template: draft.template,
    language: draft.language,
    recipients,
    ...(draft.variables !== null && { variables: draft.variables }),
    ratePerMinute: draft.ratePerMinute,
  };
}

async function withCounts(actor: Actor, id: string): Promise<BroadcastSummaryView> {
  return serializeBroadcast(await sendo.broadcasts.get(id, { actor }));
}

/** The tenant's broadcasts, newest first, each with its recipient counts. */
export async function listBroadcasts(
  cursor?: string | null,
): Promise<BroadcastsActionResult<PageView<BroadcastSummaryView>>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    const page = await sendo.broadcasts.list({ actor, cursor: optionalCursor(cursor), limit: 20 });
    return {
      items: await Promise.all(page.items.map((broadcast) => withCounts(actor, broadcast.id))),
      nextCursor: page.nextCursor,
    };
  });
}

/** One broadcast with its counts (the progress view polls it). */
export async function getBroadcast(
  id: string,
): Promise<BroadcastsActionResult<BroadcastSummaryView>> {
  const user = await requireUser();
  return attempt(async () => withCounts(await actorOf(user), requireString(id, "id", 200)));
}

/** One page of per-recipient results, optionally of one state. */
export async function listRecipients(
  id: string,
  query: RecipientsQuery = {},
): Promise<BroadcastsActionResult<PageView<BroadcastRecipientRowView>>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    const status = query.status ?? null;
    if (status !== null && !RECIPIENT_STATUS_ORDER.includes(status)) {
      throw new InvalidInputError("Invalid status");
    }
    const page = await sendo.broadcasts.recipients(requireString(id, "id", 200), {
      actor,
      ...(status !== null && { status }),
      cursor: optionalCursor(query.cursor),
      limit: RECIPIENTS_PAGE,
    });
    return { items: page.items.map(serializeRecipient), nextCursor: page.nextCursor };
  });
}

/** APPROVED, active templates of one of the tenant's numbers. */
export async function listTemplates(
  accountId: string,
): Promise<BroadcastsActionResult<BroadcastTemplateView[]>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    const templates = await sendo.templates.list({
      account: requireString(accountId, "number", 200),
      tenant: actor.tenantId,
      status: "APPROVED",
    });
    return templates.map(serializeTemplate);
  });
}

/** The app's contact lists and filters for one number (`broadcastAudiences.list`). */
export async function listAudiences(
  accountId: string,
): Promise<BroadcastsActionResult<BroadcastAudienceView[]>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    const account = requireString(accountId, "number", 200);
    let audiences;
    try {
      audiences = await broadcastAudiences.list({ user, actor, accountId: account });
    } catch (error) {
      throw new AudienceError(error instanceof Error ? error.message : "Audience failed");
    }
    return audiences.map((audience) => ({
      id: audience.id,
      label: audience.label,
      description: audience.description ?? null,
      size: audience.size ?? null,
    }));
  });
}

/** Counts (total / eligible / skipped by reason) for the review step. Writes nothing. */
export async function previewBroadcast(
  draft: BroadcastDraft,
): Promise<BroadcastsActionResult<BroadcastPreviewView>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    return serializePreview(
      await sendo.broadcasts.preview(await broadcastInput(user, actor, draft)),
    );
  });
}

/** Stores the broadcast as `queued`; the every-minute tick sends it. */
export async function createBroadcast(
  draft: BroadcastDraft,
): Promise<BroadcastsActionResult<BroadcastSummaryView>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    const broadcast = await sendo.broadcasts.create(await broadcastInput(user, actor, draft));
    return withCounts(actor, broadcast.id);
  });
}

/** Pending recipients become `cancelled`; messages already sent stay sent. */
export async function cancelBroadcast(
  id: string,
): Promise<BroadcastsActionResult<BroadcastSummaryView>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    const broadcast = await sendo.broadcasts.cancel(requireString(id, "id", 200), { actor });
    return withCounts(actor, broadcast.id);
  });
}
