/** A component of a Meta message template, as returned by `GET /{waba_id}/message_templates`. */
export interface MetaTemplateComponent {
  type: string;
  format?: string;
  text?: string;
  buttons?: Record<string, unknown>[];
  example?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A message template as returned by Meta (snake_case, raw values). */
export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  /** `APPROVED`, `PENDING`, `REJECTED`, `PAUSED`, `DISABLED`, … */
  status: string;
  /** `MARKETING`, `UTILITY` or `AUTHENTICATION`. */
  category: string;
  components: MetaTemplateComponent[];
  /** `POSITIONAL` or `NAMED`. */
  parameter_format?: string;
}

export interface MetaMediaInfo {
  /** Short-lived download URL; must be fetched with the bearer token. */
  url: string;
  mimeType: string;
  sha256: string | null;
  fileSize: number | null;
}

export interface MetaPhoneNumber {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  /** `GREEN`, `YELLOW`, `RED` or `UNKNOWN`. */
  qualityRating: string | null;
  /** `VERIFIED`, `NOT_VERIFIED`, `EXPIRED`, … */
  codeVerificationStatus: string | null;
  nameStatus: string | null;
  platformType: string | null;
  throughputLevel: string | null;
}

export interface MetaSubscribedApp {
  id: string | null;
  name: string | null;
  link: string | null;
}
