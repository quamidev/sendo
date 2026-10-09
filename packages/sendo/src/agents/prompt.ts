import type { ImagePart, ModelMessage, TextPart } from "ai";
import type { SendoAdapter } from "../adapters/types";
import type { Contact, MessageWithMedia } from "../types/entities";
import type { AgentHandoffConfig } from "./types";

export const HANDOFF_TOOL_NAME = "transferir_a_humano";
export const HUMAN_PREFIX = "[operador] ";
const DEFAULT_TIMEZONE = "America/Guatemala";

/** The clause appended to the instructions when `handoff` is set. */
export function handoffClause(handoff: AgentHandoffConfig): string {
  return [
    "## Transferencia a una persona",
    `Llama a la herramienta \`${HANDOFF_TOOL_NAME}\` con un \`motivo\` breve cuando: ${handoff.when.trim()}`,
    "Después de transferir, no sigas atendiendo la conversación.",
  ].join("\n");
}

export function formatNow(now: Date, timezone: string): { text: string; timezone: string } {
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat("es-GT", { dateStyle: "full", timeStyle: "short", timeZone }).format(
      now,
    );
  try {
    return { text: format(timezone), timezone };
  } catch {
    return { text: format(DEFAULT_TIMEZONE), timezone: DEFAULT_TIMEZONE };
  }
}

export interface SystemPromptInput {
  instructions: string;
  handoff?: AgentHandoffConfig;
  contact: Contact;
  timezone: string;
  now: Date;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const { contact } = input;
  const now = formatNow(input.now, input.timezone);
  const sections = [input.instructions.trim()];
  if (input.handoff) sections.push(handoffClause(input.handoff));
  sections.push(
    [
      "## Contacto",
      `- Nombre: ${contact.profileName ?? "desconocido"}`,
      `- Teléfono: ${contact.phone}`,
      `- ID en la aplicación: ${contact.appRef ?? "sin vincular"}`,
    ].join("\n"),
  );
  sections.push(["## Fecha y hora actual", `${now.text} (${now.timezone})`].join("\n"));
  return sections.join("\n\n");
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function withText(label: string, text: string | null): string {
  return text === null ? label : `${label} ${text}`;
}

/** Text used for a message the model can't see natively (media, location, reactions...). */
export function describeMessage(message: MessageWithMedia): string {
  const { content } = message;
  const text = str(message.text);
  switch (message.type) {
    case "text":
    case "interactive":
    case "button":
      return text ?? "";
    case "image":
      return withText("[imagen]", text);
    case "video":
      return withText("[video]", text);
    case "audio":
      return "[audio]";
    case "sticker":
      return "[sticker]";
    case "document": {
      const name = str(content.filename);
      return withText(name === null ? "[documento]" : `[documento: ${name}]`, text);
    }
    case "location": {
      const lat = num(content.latitude);
      const lng = num(content.longitude);
      const coords = lat !== null && lng !== null ? `: ${String(lat)}, ${String(lng)}` : "";
      const place = [str(content.name), str(content.address)].filter((v) => v !== null).join(", ");
      return withText(`[ubicación${coords}]`, place === "" ? null : place);
    }
    case "contacts":
      return withText("[contacto compartido]", text);
    case "reaction":
      return text === null ? "[reacción eliminada]" : `[reacción: ${text}]`;
    case "template":
      return text ?? withText("[plantilla]", str(content.name));
    case "unsupported":
      return "[mensaje no soportado]";
    case "status_placeholder":
      return "";
  }
}

type UserPart = TextPart | ImagePart;

interface Entry {
  role: "user" | "assistant";
  parts: UserPart[];
}

async function imagePart(
  adapter: SendoAdapter,
  message: MessageWithMedia,
): Promise<ImagePart | null> {
  const media = message.media;
  if (media?.downloadStatus !== "done" || media.storagePath === null) return null;
  try {
    const bytes = await adapter.storage.get(media.storagePath);
    if (bytes === null) return null;
    return { type: "image", image: bytes, mediaType: media.mimeType ?? "image/jpeg" };
  } catch {
    return null;
  }
}

export interface HistoryOptions {
  vision: boolean;
}

/**
 * Maps stored messages (oldest first) to AI SDK messages: contact → `user`;
 * agent, human (prefixed "[operador] ") and system → `assistant`. Consecutive
 * messages with the same role are merged into one message.
 */
export async function toModelMessages(
  adapter: SendoAdapter,
  history: readonly MessageWithMedia[],
  opts: HistoryOptions,
): Promise<ModelMessage[]> {
  const entries: Entry[] = [];
  for (const message of history) {
    if (message.type === "status_placeholder") continue;
    const role = message.direction === "in" ? "user" : "assistant";
    const parts: UserPart[] = [];
    if (role === "user" && message.type === "image" && opts.vision) {
      const image = await imagePart(adapter, message);
      if (image) {
        parts.push(image);
        const caption = str(message.text);
        if (caption !== null) parts.push({ type: "text", text: caption });
      }
    }
    if (parts.length === 0) {
      const described = describeMessage(message);
      if (described === "") continue;
      const prefix = message.sender === "human" ? HUMAN_PREFIX : "";
      parts.push({ type: "text", text: prefix + described });
    }
    const last = entries.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else entries.push({ role, parts });
  }
  return entries.map((entry): ModelMessage => {
    if (entry.role === "user") return { role: "user", content: entry.parts };
    const text = entry.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter((part) => part !== "")
      .join("\n");
    return { role: "assistant", content: text };
  });
}
