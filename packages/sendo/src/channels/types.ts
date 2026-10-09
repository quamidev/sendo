import type { ParsedMessagesChange } from "./whatsapp/schemas";
import type {
  ButtonsInput,
  ListInput,
  MediaInput,
  ReplyOptions,
  TemplateInput,
} from "./whatsapp/send";

/** Messaging channel. Widened later: `| "instagram" | "messenger"`. */
export type Channel = "whatsapp";

/**
 * One normalized change from a webhook body, discriminated by `kind`.
 * New variants (echoes, imported history, other channels) are added to this union.
 */
export type ParsedChange = ParsedMessagesChange;

/** Turns a verified webhook body for one Meta product (`object`) into parsed changes. */
export interface ChannelParser {
  channel: Channel;
  /** The webhook body's `object`, e.g. `"whatsapp_business_account"`. */
  object: string;
  /** Throws when the envelope is malformed. */
  parse(body: unknown): ParsedChange[];
}

/** Builds and validates the channel's outbound request bodies. */
export interface ChannelSender<Payload = unknown> {
  channel: Channel;
  text(to: string, body: string, opts?: ReplyOptions & { previewUrl?: boolean }): Payload;
  media(to: string, media: MediaInput, opts?: ReplyOptions): Payload;
  buttons(to: string, input: ButtonsInput, opts?: ReplyOptions): Payload;
  list(to: string, input: ListInput, opts?: ReplyOptions): Payload;
  template(to: string, input: TemplateInput): Payload;
  reaction(to: string, messageId: string, emoji: string): Payload;
}

export interface ChannelModule {
  channel: Channel;
  parser: ChannelParser;
  sender: ChannelSender;
}
