/**
 * Pipeline source attribution (tech spec "Widgets"): a trailing `[#code]` on an inbound text
 * message marks where the conversation started (a widget, a QR, a campaign link).
 *
 * The stored message keeps the code; the pipeline records it as `conversation.source` (when
 * unset) and `message.metadata.source`, and the agent prompt receives the stripped text.
 */

/** Trailing `[#code]`, lowercase `a-z0-9-`, 1..32 chars, optional surrounding whitespace. */
export const SOURCE_CODE_RE = /\s*\[#([a-z0-9-]{1,32})\]\s*$/;

/**
 * Splits a trailing `[#code]` off `text`. Returns the text unchanged and `source: null` when
 * there is no valid code (uppercase, too long, or not at the end).
 */
export function stripSourceCode(text: string): { text: string; source: string | null } {
  const match = SOURCE_CODE_RE.exec(text);
  if (!match) return { text, source: null };
  return { text: text.slice(0, match.index), source: match[1] ?? null };
}
