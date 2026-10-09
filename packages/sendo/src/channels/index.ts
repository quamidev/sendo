import type { Channel, ChannelModule, ChannelParser } from "./types";
import { whatsappParser } from "./whatsapp/parse";
import { whatsappSender } from "./whatsapp/send";

export type { Channel, ChannelModule, ChannelParser, ChannelSender, ParsedChange } from "./types";
export type { EchoMessage, HistoryMessage, ParsedEcho, ParsedHistory } from "./whatsapp/schemas";
export { whatsappParser } from "./whatsapp/parse";
export { whatsappSender } from "./whatsapp/send";

/** Every supported channel, keyed by name. */
export const CHANNELS: Readonly<Record<Channel, ChannelModule>> = {
  whatsapp: { channel: "whatsapp", parser: whatsappParser, sender: whatsappSender },
};

/** The parser for a webhook body's `object`, or null when no channel handles it. */
export function parserForObject(object: unknown): ChannelParser | null {
  if (typeof object !== "string") return null;
  return Object.values(CHANNELS).find((module) => module.parser.object === object)?.parser ?? null;
}
