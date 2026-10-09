import type { Account, Conversation } from "../../types/entities";
import { NO_MEDIA_STORE_MESSAGE } from "../../media";
import { mediaPath } from "../../utils/media";
import type { InboundMediaMessage, InboundMessage } from "../../channels/whatsapp/schemas";
import type { SendoContext } from "../context";

/** Shared steps of the per-change processors (`process-event.ts`, `coexistence.ts`). */

export interface ChangeOutcome {
  routed: boolean;
  errors: string[];
}

export interface ChangeSource {
  object: string;
  raw: unknown;
}

const MEDIA_TYPES = new Set<InboundMessage["type"]>([
  "image",
  "audio",
  "video",
  "document",
  "sticker",
]);
/** One retry after the first failed download. */
const MEDIA_ATTEMPTS = 2;

export function isMediaMessage(message: InboundMessage): message is InboundMediaMessage {
  return MEDIA_TYPES.has(message.type);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * The active account for a change's `phone_number_id`, or null after logging and emitting
 * `event.unrouted` (`unknown_account`).
 */
export async function routeAccount(
  ctx: SendoContext,
  phoneNumberId: string,
  source: ChangeSource,
): Promise<Account | null> {
  const account = await ctx.adapter.accounts.getByPhoneNumberId(phoneNumberId);
  if (account !== null && account.active) return account;
  ctx.logger.warn(
    `[sendo] webhook for unknown phone_number_id ${phoneNumberId}; event left unrouted`,
  );
  await ctx.emitter.emit("event.unrouted", {
    reason: "unknown_account",
    object: source.object,
    phoneNumberId,
    raw: source.raw,
  });
  return null;
}

/**
 * Downloads a message's media into the `MediaStore` (one retry); a final failure, or no store
 * configured, stores a `failed` row.
 */
export async function downloadMedia(
  ctx: SendoContext,
  account: Account,
  conversation: Conversation,
  messageId: string,
  message: InboundMediaMessage,
): Promise<void> {
  const { adapter, transport } = ctx;
  const media = ctx.config.media;
  let lastError: unknown;
  if (media === null) {
    ctx.logger.error(
      `[sendo] media ${message.mediaId} was not downloaded. ${NO_MEDIA_STORE_MESSAGE}`,
    );
  }
  for (let attempt = 1; media !== null && attempt <= MEDIA_ATTEMPTS; attempt++) {
    try {
      const fetched = await ctx.callTransport(account, () =>
        transport.fetchMedia(account, message.mediaId),
      );
      const mimeType = fetched.mimeType || message.mimeType;
      const storagePath = mediaPath({
        tenantId: account.tenantId,
        accountId: account.id,
        conversationId: conversation.id,
        metaMediaId: message.mediaId,
        mime: mimeType,
      });
      await media.put(storagePath, fetched.bytes, mimeType);
      await adapter.media.insert({
        tenantId: account.tenantId,
        messageId,
        metaMediaId: message.mediaId,
        mimeType,
        sizeBytes: fetched.fileSize ?? fetched.bytes.byteLength,
        sha256: fetched.sha256 ?? message.sha256 ?? null,
        storagePath,
        downloadStatus: "done",
      });
      return;
    } catch (error) {
      lastError = error;
      ctx.logger.warn(
        `[sendo] media ${message.mediaId} download attempt ${attempt}/${MEDIA_ATTEMPTS} failed`,
        error,
      );
    }
  }
  if (media !== null) {
    ctx.logger.error(`[sendo] media ${message.mediaId} could not be downloaded`, lastError);
  }
  await adapter.media.insert({
    tenantId: account.tenantId,
    messageId,
    metaMediaId: message.mediaId,
    mimeType: message.mimeType,
    sha256: message.sha256 ?? null,
    downloadStatus: "failed",
  });
}
