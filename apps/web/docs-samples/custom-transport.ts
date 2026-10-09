// #region transport
import type { Account, FetchedMedia, MessagePayload, Transport } from "@quami/wa-li";

// The V1 Transport interface, shared by metaDirect (V1) and quamiCloud (V3, reserved).
export class RelayTransport implements Transport {
  readonly kind = "relay";

  async send(account: Account, payload: MessagePayload): Promise<{ metaMessageId: string }> {
    return relay("send", { phoneNumberId: account.phoneNumberId, payload });
  }

  async fetchMedia(account: Account, mediaId: string): Promise<FetchedMedia> {
    return relay("media", { phoneNumberId: account.phoneNumberId, mediaId });
  }

  // Optional: uploadMedia?(account, input), markRead?(account, metaMessageId),
  // handleWebhook?(request) → Response, subscribe?(handler) → unsubscribe.
}
// #endregion transport

declare function relay<T>(op: string, body: unknown): Promise<T>;
