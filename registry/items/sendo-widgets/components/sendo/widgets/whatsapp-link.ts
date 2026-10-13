/**
 * Browser-safe copy of `buildWhatsAppLink` from `@quami/sendo` (same format, no package import,
 * so the chat bubble also works on a site that doesn't run Sendo). The server-side
 * `sendo.links.create` / `buildWhatsAppLink` stay the reference; keep both in sync.
 */
const SOURCE_RE = /^[a-z0-9-]{1,32}$/;

export interface WhatsAppLinkInput {
  phone: string;
  text?: string;
  source?: string;
}

/** `https://wa.me/<digits>?text=<text [#source]>`, or `null` when the phone isn't 7–15 digits. */
export function whatsappLink({ phone, text, source }: WhatsAppLinkInput): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  const code = source !== undefined && SOURCE_RE.test(source) ? `[#${source}]` : "";
  const message = [text?.trim() ?? "", code].filter((part) => part !== "").join(" ");
  return message === ""
    ? `https://wa.me/${digits}`
    : `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function isValidSource(source: string): boolean {
  return SOURCE_RE.test(source);
}
