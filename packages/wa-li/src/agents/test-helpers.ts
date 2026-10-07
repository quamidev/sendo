import { MockLanguageModelV3 } from "ai/test";
import { FIXTURE_IDS, loadWebhookFixtureText } from "../../test/support/fixtures";
import { signFixture } from "../../test/support/sign";
import type { WhatsAppContext } from "../core/context";
import type { Account, Contact, Conversation, MessageWithMedia } from "../types/entities";

export type GenerateResult = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>;
export type CallOptions = Parameters<MockLanguageModelV3["doGenerate"]>[0];
type Step = GenerateResult | ((options: CallOptions) => GenerateResult | Promise<GenerateResult>);

const usage: GenerateResult["usage"] = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

export function textResult(text: string): GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage,
    warnings: [],
  };
}

export function toolCallResult(toolName: string, input: unknown, id = "call-1"): GenerateResult {
  return {
    content: [{ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage,
    warnings: [],
  };
}

/** A mock model answering with `steps` in order (the last one repeats). */
export function scriptedModel(...steps: Step[]): MockLanguageModelV3 {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      const step = steps[Math.min(i, steps.length - 1)];
      i++;
      if (step === undefined) throw new Error("scriptedModel needs at least one step");
      return typeof step === "function" ? step(options) : step;
    },
  });
}

export function failingModel(error = new Error("model exploded")): MockLanguageModelV3 {
  return new MockLanguageModelV3({ doGenerate: () => Promise.reject(error) });
}

/** The prompt of one model call. */
export function promptOf(model: MockLanguageModelV3, call = 0): CallOptions["prompt"] {
  const options = model.doGenerateCalls[call];
  if (!options) throw new Error(`no model call #${String(call)}`);
  return options.prompt;
}

export function systemOf(model: MockLanguageModelV3, call = 0): string {
  const system = promptOf(model, call).find((m) => m.role === "system");
  return system?.role === "system" ? system.content : "";
}

/** Text of every user/assistant part, prefixed with the role. */
export function transcript(model: MockLanguageModelV3, call = 0): string[] {
  return promptOf(model, call).flatMap((message) => {
    if (message.role === "system") return [];
    return message.content.flatMap((part) =>
      part.type === "text" ? [`${message.role}: ${part.text}`] : [],
    );
  });
}

export interface WebhookTextPatch {
  id: string;
  body: string;
  /** Default now. */
  timestamp?: Date;
  phoneNumberId?: string;
}

/** The `text` fixture with another message id/body (timestamp now so the window is open). */
export function textWebhook(patch: WebhookTextPatch): string {
  const json = JSON.parse(loadWebhookFixtureText("text")) as {
    entry: { changes: { value: Record<string, unknown> }[] }[];
  };
  const value = json.entry[0]?.changes[0]?.value as {
    metadata: { phone_number_id: string };
    messages: { id: string; timestamp: string; text: { body: string } }[];
  };
  const message = value.messages[0];
  if (!message) throw new Error("text fixture changed");
  message.id = patch.id;
  message.text.body = patch.body;
  message.timestamp = String(Math.floor((patch.timestamp ?? new Date()).getTime() / 1000));
  if (patch.phoneNumberId) value.metadata.phone_number_id = patch.phoneNumberId;
  return JSON.stringify(json);
}

export function webhookRequest(body: string, secret = "app-secret-value"): Request {
  const signed = signFixture(body, secret);
  return new Request("https://app.example/api/whatsapp", {
    method: "POST",
    headers: signed.headers,
    body: signed.body,
  });
}

let inboundSeq = 0;

/** Stores an inbound text (or another type) the way the pipeline does, without dispatching. */
export async function storeInbound(
  ctx: WhatsAppContext,
  account: Account,
  opts: {
    phone?: string;
    text?: string | null;
    type?: MessageWithMedia["type"];
    content?: Record<string, unknown>;
  } = {},
): Promise<{ contact: Contact; conversation: Conversation; message: MessageWithMedia }> {
  const { contact } = await ctx.services.contacts.ensure({
    account,
    phone: opts.phone ?? `+${FIXTURE_IDS.waId}`,
  });
  const at = new Date();
  const { conversation: open } = await ctx.services.conversations.ensure({ account, contact });
  const type = opts.type ?? "text";
  const inserted = await ctx.adapter.messages.insertInbound({
    tenantId: account.tenantId,
    conversationId: open.id,
    type: type === "status_placeholder" ? "text" : type,
    content: opts.content ?? { body: opts.text ?? "" },
    text: opts.text === undefined ? "hola" : opts.text,
    metaMessageId: `wamid.STORED${String(++inboundSeq)}`,
    sentAt: at,
  });
  if (!inserted) throw new Error("duplicate inbound");
  const { conversation } = await ctx.services.conversations.ensure({
    account,
    contact,
    inbound: { at },
  });
  const message = await ctx.adapter.messages.get(inserted.id);
  if (!message) throw new Error("message not stored");
  return { contact, conversation, message };
}
