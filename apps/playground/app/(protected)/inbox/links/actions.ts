"use server";

import { assertCan, isSendoError, type Actor } from "@quami/sendo";
import {
  LINK_TEXT_MAX,
  type CreateLinkInput,
  type WidgetLinkView,
  type WidgetsActionResult,
  type WidgetsErrorCode,
  type WidgetSourceView,
} from "@/components/sendo/widgets/types";
import { sendo } from "@/lib/sendo";
import { requireUser, type LinksUser } from "./links-config";

class InvalidInputError extends Error {}

function errorCode(error: unknown): WidgetsErrorCode {
  if (error instanceof InvalidInputError) return "INVALID";
  if (!isSendoError(error)) return "UNKNOWN";
  switch (error.code) {
    case "FORBIDDEN":
      return "FORBIDDEN";
    case "ACCOUNT_NOT_FOUND":
    case "RECORD_NOT_FOUND":
      return "NOT_FOUND";
    case "INVALID_PAYLOAD":
    case "INVALID_PHONE":
    case "AMBIGUOUS_ACCOUNT":
      return "INVALID";
    default:
      return "UNKNOWN";
  }
}

/** Runs `fn` and turns errors into `{ ok: false }`. Library errors carry user-safe messages. */
async function attempt<T>(fn: () => Promise<T>): Promise<WidgetsActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    const code = errorCode(error);
    if (code === "UNKNOWN" && !isSendoError(error)) console.error("[sendo links]", error);
    const message =
      error instanceof InvalidInputError || isSendoError(error)
        ? error.message
        : "Unexpected error";
    return { ok: false, code, message };
  }
}

/** Links and sources are admin tools (`numbers.manage`), scoped to the user's tenant. */
async function requireAdmin(user: LinksUser): Promise<Actor> {
  const actor = await sendo.actor(user.userId, user.tenantId);
  assertCan(actor, "numbers.manage");
  return actor;
}

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.length > max) {
    throw new InvalidInputError(`Invalid ${field}`);
  }
  return value;
}

/** `sendo.links.create` for one of the tenant's numbers (pure: nothing is stored). */
export async function createLink(
  input: CreateLinkInput,
): Promise<WidgetsActionResult<WidgetLinkView>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await requireAdmin(user);
    return sendo.links.create({
      account: requireString(input.account, "number", 200),
      tenant: actor.tenantId,
      text: requireString(input.text, "text", LINK_TEXT_MAX),
      source: requireString(input.source, "source", 32),
    });
  });
}

/** Conversations per source in the tenant; `account` narrows it to one number. */
export async function listSources(
  account?: string | null,
): Promise<WidgetsActionResult<WidgetSourceView[]>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await sendo.actor(user.userId, user.tenantId);
    const number =
      account == null || account === "" ? undefined : requireString(account, "number", 200);
    return sendo.links.sources({ actor, ...(number !== undefined && { account: number }) });
  });
}
