import {
  GRAPH_API_VERSION,
  META_MEDIA_LIMITS,
  SENDO_SCHEMA_VERSION,
  isValidPhone,
  normalizePhone,
  parseWebhook,
  verifySignature,
  windowStatus,
} from "@quami/sendo";

export function examples(rawBody: string, signature: string | null, lastInboundAt: Date | null) {
  // #region utils
  normalizePhone("+502 5555-1234"); // "+50255551234"
  normalizePhone("5555 1234", { defaultCountry: "GT" }); // "+50255551234"
  isValidPhone("123"); // false (normalizePhone throws InvalidPhoneError)

  windowStatus(lastInboundAt); // { open, expiresAt } — 24 h after the last inbound message

  // Lower-level webhook helpers (sendo.handleWebhook already does this for you).
  if (verifySignature(rawBody, signature, process.env.SENDO_META_APP_SECRET ?? "")) {
    for (const change of parseWebhook(JSON.parse(rawBody))) {
      console.log(change.phoneNumberId, change.messages.length, change.statuses.length);
    }
  }

  console.log(GRAPH_API_VERSION, SENDO_SCHEMA_VERSION, META_MEDIA_LIMITS.image); // "v26.0", 1, bytes
  // #endregion utils
}
