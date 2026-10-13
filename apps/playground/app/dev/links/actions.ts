"use server";

import { buildWhatsAppLink, isSendoError } from "@quami/sendo";
import type {
  CreateLinkInput,
  WidgetLinkView,
  WidgetsActionResult,
  WidgetSourceView,
} from "@/components/sendo/widgets/types";
import { widgetsFixture } from "@/fixtures/widgets";

// Dev-only stand-ins for app/(protected)/inbox/links/actions.ts: same result shapes, fixture data,
// links built by the package's pure `buildWhatsAppLink` (nothing stored).

export async function createFixtureLink(
  data: string,
  input: CreateLinkInput,
): Promise<WidgetsActionResult<WidgetLinkView>> {
  const { fixture } = widgetsFixture(data);
  const number = fixture.numbers.find((candidate) => candidate.id === input.account);
  if (number === undefined) return { ok: false, code: "NOT_FOUND", message: "Unknown number" };
  try {
    return {
      ok: true,
      data: buildWhatsAppLink({
        phone: number.displayPhone,
        text: input.text,
        source: input.source,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      code: "INVALID",
      message: isSendoError(error) ? error.message : "Unexpected error",
    };
  }
}

export async function listFixtureSources(
  data: string,
  account?: string | null,
): Promise<WidgetsActionResult<WidgetSourceView[]>> {
  const { fixture } = widgetsFixture(data);
  // Per-number counts aren't modelled: one number gets a third of each count.
  const sources =
    account == null
      ? fixture.sources
      : fixture.sources.map((row) => ({ ...row, conversations: Math.ceil(row.conversations / 3) }));
  return { ok: true, data: sources };
}
