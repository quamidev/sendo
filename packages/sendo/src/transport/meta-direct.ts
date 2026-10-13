import {
  createGraphClient,
  type GraphClient,
  type GraphClientOptions,
} from "../client/graph-client";
import { ConfigError } from "../errors/errors";
import type { Account } from "../types/entities";
import { requirePhoneNumberId } from "../utils/channel-ids";
import type { Logger } from "../utils/logger";
import type { FetchedMedia, Transport, TransportUploadInput } from "./types";

export type ResolveToken = (
  account: Account,
) => string | null | undefined | Promise<string | null | undefined>;

export interface MetaDirectOptions {
  /** Meta app secret, used to verify `X-Hub-Signature-256`. */
  appSecret: string;
  /** Token Meta echoes during the webhook GET challenge. */
  verifyToken: string;
  /** Returns the account's access token at call time. Never stored or logged. */
  resolveToken: ResolveToken;
  /** Pre-built Graph client (tests, custom fetch). Overrides `version`, `fetch`, `logger`. */
  graph?: GraphClient;
  version?: GraphClientOptions["version"];
  fetch?: GraphClientOptions["fetch"];
  logger?: Logger;
}

export interface MetaDirectTransport extends Transport {
  readonly kind: "meta-direct";
  readonly appSecret: string;
  readonly verifyToken: string;
  /** The underlying Graph client, for calls outside `Transport` (templates, doctor). */
  readonly graph: GraphClient;
  /** Resolves the account token or throws `ConfigError`. */
  resolveToken(account: Account): Promise<string>;
  uploadMedia(account: Account, input: TransportUploadInput): Promise<{ mediaId: string }>;
  markRead(account: Account, metaMessageId: string): Promise<void>;
}

/** Talks to the Meta Graph API directly with each account's own token. */
export function metaDirect(options: MetaDirectOptions): MetaDirectTransport {
  const graph =
    options.graph ??
    createGraphClient({ version: options.version, fetch: options.fetch, logger: options.logger });

  async function resolveToken(account: Account): Promise<string> {
    const token = await options.resolveToken(account);
    if (typeof token !== "string" || token.trim() === "") {
      throw new ConfigError(
        `resolveToken returned no access token for account ${account.id} (tokenRef "${account.tokenRef}").`,
      );
    }
    return token;
  }

  return {
    kind: "meta-direct",
    appSecret: options.appSecret,
    verifyToken: options.verifyToken,
    graph,
    resolveToken,

    async send(account, payload) {
      return graph.sendMessage(await resolveToken(account), requirePhoneNumberId(account), payload);
    },

    async fetchMedia(account, mediaId): Promise<FetchedMedia> {
      const token = await resolveToken(account);
      const info = await graph.getMediaUrl(token, mediaId);
      const bytes = await graph.downloadMedia(token, info.url);
      return {
        bytes,
        mimeType: info.mimeType,
        sha256: info.sha256,
        fileSize: info.fileSize ?? bytes.byteLength,
      };
    },

    async uploadMedia(account, input) {
      return graph.uploadMedia(
        await resolveToken(account),
        requirePhoneNumberId(account),
        input.file,
        input.mimeType,
        { filename: input.filename, mediaType: input.mediaType },
      );
    },

    async markRead(account, metaMessageId) {
      await graph.markRead(
        await resolveToken(account),
        requirePhoneNumberId(account),
        metaMessageId,
      );
    },
  };
}
