// #region transport
import type { Account, FetchedMedia, MessagePayload, Transport } from "@quami/sendo";

// The interface metaDirect implements. Pass any object implementing it as `transport`.
export class GatewayTransport implements Transport {
  readonly kind = "gateway";

  async send(account: Account, payload: MessagePayload): Promise<{ metaMessageId: string }> {
    return gateway("send", { phoneNumberId: account.phoneNumberId, payload });
  }

  async fetchMedia(account: Account, mediaId: string): Promise<FetchedMedia> {
    return gateway("media", { phoneNumberId: account.phoneNumberId, mediaId });
  }

  // Optional: uploadMedia?(account, input), markRead?(account, metaMessageId),
  // handleWebhook?(request) → Response, subscribe?(handler) → unsubscribe.
}
// #endregion transport

declare function gateway<T>(op: string, body: unknown): Promise<T>;
