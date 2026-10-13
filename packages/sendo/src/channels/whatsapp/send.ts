import { PayloadValidationError } from "../../errors/errors";
import type { MediaType } from "../../types/enums";
import type { ChannelSender } from "../types";

/** Meta Cloud API message limits (characters are counted as Unicode code points). */
export const META_MESSAGE_LIMITS = {
  textBody: 4096,
  caption: 1024,
  buttonsMax: 3,
  buttonTitle: 20,
  buttonId: 256,
  interactiveBody: 1024,
  listBody: 4096,
  headerText: 60,
  footerText: 60,
  listButton: 20,
  listSectionsMax: 10,
  listRowsMax: 10,
  listSectionTitle: 24,
  listRowId: 200,
  listRowTitle: 24,
  listRowDescription: 72,
  templateButtonsMax: 10,
} as const;

export interface MessageContext {
  message_id: string;
}

interface BasePayload {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  context?: MessageContext;
}

export interface MediaObject {
  id?: string;
  link?: string;
  caption?: string;
  filename?: string;
}

export type TextPayload = BasePayload & {
  type: "text";
  text: { body: string; preview_url?: boolean };
};

export type MediaPayload = {
  [T in MediaType]: BasePayload & { type: T } & Record<T, MediaObject>;
}[MediaType];

export type InteractiveHeader =
  | { type: "text"; text: string }
  | { type: "image"; image: MediaObject }
  | { type: "video"; video: MediaObject }
  | { type: "document"; document: MediaObject };

export interface InteractiveButtons {
  type: "button";
  header?: InteractiveHeader;
  body: { text: string };
  footer?: { text: string };
  action: { buttons: { type: "reply"; reply: { id: string; title: string } }[] };
}

export interface InteractiveList {
  type: "list";
  header?: { type: "text"; text: string };
  body: { text: string };
  footer?: { text: string };
  action: {
    button: string;
    sections: {
      title?: string;
      rows: { id: string; title: string; description?: string }[];
    }[];
  };
}

export type InteractivePayload = BasePayload & {
  type: "interactive";
  interactive: InteractiveButtons | InteractiveList;
};

export type TemplateParameter =
  | { type: "text"; text: string; parameter_name?: string }
  | { type: "image"; image: MediaObject }
  | { type: "video"; video: MediaObject }
  | { type: "document"; document: MediaObject }
  | { type: "payload"; payload: string };

export type TemplateComponentPayload =
  | { type: "header"; parameters: TemplateParameter[] }
  | { type: "body"; parameters: TemplateParameter[] }
  | {
      type: "button";
      sub_type: TemplateButtonSubType;
      index: string;
      parameters: TemplateParameter[];
    };

export type TemplatePayload = BasePayload & {
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components?: TemplateComponentPayload[];
  };
};

export type ReactionPayload = Omit<BasePayload, "context"> & {
  type: "reaction";
  reaction: { message_id: string; emoji: string };
};

/** Any body accepted by `POST /{phone_number_id}/messages`. */
export type MessagePayload =
  TextPayload | MediaPayload | InteractivePayload | TemplatePayload | ReactionPayload;

export interface ReplyOptions {
  /** Meta message id (`wamid…`) to quote. */
  replyTo?: string;
}

function charLength(value: string): number {
  return Array.from(value).length;
}

function fail(field: string, message: string, limit?: number): never {
  throw new PayloadValidationError({ field, message, limit: limit ?? null });
}

function requireText(field: string, value: string | undefined, max?: number): string {
  if (typeof value !== "string" || value.trim() === "") fail(field, "must be a non-empty string");
  if (max !== undefined && charLength(value) > max) {
    fail(field, `must be at most ${max} characters`, max);
  }
  return value;
}

function optionalText(field: string, value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return requireText(field, value, max);
}

function base(to: string, replyTo?: string): BasePayload {
  const payload: BasePayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: requireText("to", to),
  };
  if (replyTo !== undefined) payload.context = { message_id: requireText("replyTo", replyTo) };
  return payload;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Builds `{ id }` or `{ link }` for a media reference; exactly one is required. */
function mediaRef(field: string, ref: { id?: string; url?: string }): MediaObject {
  const hasId = ref.id !== undefined;
  const hasUrl = ref.url !== undefined;
  if (hasId === hasUrl) fail(field, "needs exactly one of `id` or `url`");
  if (hasId) return { id: requireText(`${field}.id`, ref.id) };
  const link = requireText(`${field}.url`, ref.url);
  if (!isHttpUrl(link)) fail(`${field}.url`, "must be an http(s) URL");
  return { link };
}

export function buildTextPayload(
  to: string,
  body: string,
  opts: ReplyOptions & { previewUrl?: boolean } = {},
): TextPayload {
  const text: TextPayload["text"] = {
    body: requireText("body", body, META_MESSAGE_LIMITS.textBody),
  };
  if (opts.previewUrl !== undefined) text.preview_url = opts.previewUrl;
  return { ...base(to, opts.replyTo), type: "text", text };
}

export interface MediaInput {
  type: MediaType;
  /** Meta media id from a previous upload. */
  id?: string;
  /** Public http(s) URL Meta downloads from. */
  url?: string;
  /** image, video and document only. */
  caption?: string;
  /** document only. */
  filename?: string;
}

const CAPTION_TYPES: ReadonlySet<MediaType> = new Set(["image", "video", "document"]);

export function buildMediaPayload(
  to: string,
  media: MediaInput,
  opts: ReplyOptions = {},
): MediaPayload {
  const object = mediaRef("media", media);
  if (media.caption !== undefined) {
    if (!CAPTION_TYPES.has(media.type)) fail("caption", `is not supported for ${media.type}`);
    object.caption = requireText("caption", media.caption, META_MESSAGE_LIMITS.caption);
  }
  if (media.filename !== undefined) {
    if (media.type !== "document") fail("filename", "is only supported for documents");
    object.filename = requireText("filename", media.filename);
  }
  return { ...base(to, opts.replyTo), type: media.type, [media.type]: object } as MediaPayload;
}

export type HeaderInput =
  | string
  | { type: "text"; text: string }
  | { type: "image" | "video" | "document"; id?: string; url?: string; filename?: string };

export interface ButtonsInput {
  body: string;
  buttons: { id: string; title: string }[];
  header?: HeaderInput;
  footer?: string;
}

function buildHeader(header: HeaderInput): InteractiveHeader {
  if (typeof header === "string" || header.type === "text") {
    const text = typeof header === "string" ? header : header.text;
    return { type: "text", text: requireText("header", text, META_MESSAGE_LIMITS.headerText) };
  }
  const object = mediaRef("header", header);
  if (header.filename !== undefined) {
    if (header.type !== "document") fail("header.filename", "is only supported for documents");
    object.filename = requireText("header.filename", header.filename);
  }
  switch (header.type) {
    case "image":
      return { type: "image", image: object };
    case "video":
      return { type: "video", video: object };
    case "document":
      return { type: "document", document: object };
  }
}

function assertUnique(field: string, values: string[]): void {
  const seen = new Set<string>();
  values.forEach((value, i) => {
    if (seen.has(value)) fail(`${field}[${i}]`, `duplicates "${value}"`);
    seen.add(value);
  });
}

export function buildButtonsPayload(
  to: string,
  input: ButtonsInput,
  opts: ReplyOptions = {},
): InteractivePayload {
  const L = META_MESSAGE_LIMITS;
  if (input.buttons.length === 0) fail("buttons", "needs at least one button");
  if (input.buttons.length > L.buttonsMax) {
    fail("buttons", `allows at most ${L.buttonsMax} buttons`, L.buttonsMax);
  }
  const buttons = input.buttons.map((button, i) => ({
    type: "reply" as const,
    reply: {
      id: requireText(`buttons[${i}].id`, button.id, L.buttonId),
      title: requireText(`buttons[${i}].title`, button.title, L.buttonTitle),
    },
  }));
  assertUnique(
    "buttons.id",
    buttons.map((b) => b.reply.id),
  );
  assertUnique(
    "buttons.title",
    buttons.map((b) => b.reply.title),
  );
  const interactive: InteractiveButtons = {
    type: "button",
    body: { text: requireText("body", input.body, L.interactiveBody) },
    action: { buttons },
  };
  if (input.header !== undefined) interactive.header = buildHeader(input.header);
  const footer = optionalText("footer", input.footer, L.footerText);
  if (footer !== undefined) interactive.footer = { text: footer };
  return { ...base(to, opts.replyTo), type: "interactive", interactive };
}

export interface ListInput {
  body: string;
  /** Label of the button that opens the list. */
  button: string;
  sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[];
  header?: string;
  footer?: string;
}

export function buildListPayload(
  to: string,
  input: ListInput,
  opts: ReplyOptions = {},
): InteractivePayload {
  const L = META_MESSAGE_LIMITS;
  if (input.sections.length === 0) fail("sections", "needs at least one section");
  if (input.sections.length > L.listSectionsMax) {
    fail("sections", `allows at most ${L.listSectionsMax} sections`, L.listSectionsMax);
  }
  const totalRows = input.sections.reduce((sum, section) => sum + section.rows.length, 0);
  if (totalRows > L.listRowsMax) {
    fail("sections.rows", `allows at most ${L.listRowsMax} rows in total`, L.listRowsMax);
  }
  const multiple = input.sections.length > 1;
  const sections = input.sections.map((section, s) => {
    if (section.rows.length === 0) fail(`sections[${s}].rows`, "needs at least one row");
    const out: InteractiveList["action"]["sections"][number] = {
      rows: section.rows.map((row, r) => {
        const field = `sections[${s}].rows[${r}]`;
        const built: { id: string; title: string; description?: string } = {
          id: requireText(`${field}.id`, row.id, L.listRowId),
          title: requireText(`${field}.title`, row.title, L.listRowTitle),
        };
        const description = optionalText(
          `${field}.description`,
          row.description,
          L.listRowDescription,
        );
        if (description !== undefined) built.description = description;
        return built;
      }),
    };
    if (multiple || section.title !== undefined) {
      out.title = requireText(`sections[${s}].title`, section.title, L.listSectionTitle);
    }
    return out;
  });
  assertUnique(
    "rows.id",
    sections.flatMap((section) => section.rows.map((row) => row.id)),
  );
  const interactive: InteractiveList = {
    type: "list",
    body: { text: requireText("body", input.body, L.listBody) },
    action: { button: requireText("button", input.button, L.listButton), sections },
  };
  const header = optionalText("header", input.header, L.headerText);
  if (header !== undefined) interactive.header = { type: "text", text: header };
  const footer = optionalText("footer", input.footer, L.footerText);
  if (footer !== undefined) interactive.footer = { text: footer };
  return { ...base(to, opts.replyTo), type: "interactive", interactive };
}

export type TemplateButtonSubType = "quick_reply" | "url" | "copy_code";

export interface TemplateButtonInput {
  /** Position of the button in the template (0-based). */
  index: number;
  subType: TemplateButtonSubType;
  /** quick_reply: the payload returned in the webhook. */
  payload?: string;
  /** url: the dynamic URL suffix; copy_code: the coupon code. */
  text?: string;
}

export interface TemplateInput extends ReplyOptions {
  name: string;
  language: string;
  /** Positional (`{{1}}`) values as an array, or named (`{{first_name}}`) values as a record. */
  variables?: string[] | Record<string, string>;
  headerMedia?: {
    type: "image" | "video" | "document";
    id?: string;
    url?: string;
    filename?: string;
  };
  buttons?: TemplateButtonInput[];
}

function bodyParameters(variables: string[] | Record<string, string>): TemplateParameter[] {
  if (Array.isArray(variables)) {
    return variables.map((value, i) => ({
      type: "text",
      text: requireText(`variables[${i}]`, value),
    }));
  }
  return Object.entries(variables).map(([name, value]) => ({
    type: "text",
    parameter_name: requireText("variables key", name),
    text: requireText(`variables.${name}`, value),
  }));
}

function buttonComponent(button: TemplateButtonInput, i: number): TemplateComponentPayload {
  const field = `buttons[${i}]`;
  if (!Number.isInteger(button.index) || button.index < 0) {
    fail(`${field}.index`, "must be a non-negative integer");
  }
  if (button.index >= META_MESSAGE_LIMITS.templateButtonsMax) {
    fail(`${field}.index`, "is out of range", META_MESSAGE_LIMITS.templateButtonsMax - 1);
  }
  const parameter: TemplateParameter =
    button.subType === "quick_reply"
      ? { type: "payload", payload: requireText(`${field}.payload`, button.payload) }
      : { type: "text", text: requireText(`${field}.text`, button.text) };
  return {
    type: "button",
    sub_type: button.subType,
    index: String(button.index),
    parameters: [parameter],
  };
}

export function buildTemplatePayload(to: string, input: TemplateInput): TemplatePayload {
  const components: TemplateComponentPayload[] = [];
  if (input.headerMedia !== undefined) {
    const header = buildHeader(input.headerMedia);
    if (header.type === "text") fail("headerMedia", "must be image, video or document");
    components.push({ type: "header", parameters: [header] });
  }
  if (input.variables !== undefined) {
    const parameters = bodyParameters(input.variables);
    if (parameters.length > 0) components.push({ type: "body", parameters });
  }
  if (input.buttons !== undefined) {
    assertUnique(
      "buttons.index",
      input.buttons.map((b) => String(b.index)),
    );
    input.buttons.forEach((button, i) => components.push(buttonComponent(button, i)));
  }
  const template: TemplatePayload["template"] = {
    name: requireText("name", input.name),
    language: { code: requireText("language", input.language) },
  };
  if (components.length > 0) template.components = components;
  return { ...base(to, input.replyTo), type: "template", template };
}

/** Reacts to a message. An empty `emoji` removes a previous reaction. */
export function buildReactionPayload(
  to: string,
  messageId: string,
  emoji: string,
): ReactionPayload {
  const { messaging_product, recipient_type, to: recipient } = base(to);
  return {
    messaging_product,
    recipient_type,
    to: recipient,
    type: "reaction",
    reaction: { message_id: requireText("messageId", messageId), emoji },
  };
}

export const whatsappSender: ChannelSender<MessagePayload> = {
  channel: "whatsapp",
  text: buildTextPayload,
  media: buildMediaPayload,
  buttons: buildButtonsPayload,
  list: buildListPayload,
  template: buildTemplatePayload,
  reaction: buildReactionPayload,
};
