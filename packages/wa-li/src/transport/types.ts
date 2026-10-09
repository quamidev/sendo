import type { MessagePayload } from "../client/payloads";
import type { Account } from "../types/entities";
import type { MediaType } from "../types/enums";

export interface FetchedMedia {
  bytes: Uint8Array;
  mimeType: string;
  sha256: string | null;
  fileSize: number | null;
}

export interface TransportUploadInput {
  file: Blob | Uint8Array;
  mimeType: string;
  /** Used for Meta's size limit check; inferred from `mimeType` when omitted. */
  mediaType?: MediaType;
  filename?: string;
}

/** Raw webhook body delivered by a push-based transport (V3 `quamiCloud`). */
export type TransportWebhookHandler = (payload: unknown) => void | Promise<void>;

/**
 * How messages reach Meta. `metaDirect` calls the Graph API with the account's
 * own token; `quamiCloud` (V3, reserved) relays through Quami.
 */
export interface Transport {
  readonly kind: string;
  send(account: Account, payload: MessagePayload): Promise<{ metaMessageId: string }>;
  fetchMedia(account: Account, mediaId: string): Promise<FetchedMedia>;
  uploadMedia?(account: Account, input: TransportUploadInput): Promise<{ mediaId: string }>;
  markRead?(account: Account, metaMessageId: string): Promise<void>;
  handleWebhook?(req: Request): Promise<Response>;
  /** Push-based delivery of webhook payloads. Returns an unsubscribe function. */
  subscribe?(handler: TransportWebhookHandler): () => void;
}
