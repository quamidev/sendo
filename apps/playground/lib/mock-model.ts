import type { LanguageModel } from "ai";
import { HANDOFF_TOOL_NAME } from "@quami/wa-li";

type LanguageModelV3 = Extract<LanguageModel, { specificationVersion: "v3" }>;
type CallOptions = Parameters<LanguageModelV3["doGenerate"]>[0];
type GenerateResult = Awaited<ReturnType<LanguageModelV3["doGenerate"]>>;
type PromptMessage = CallOptions["prompt"][number];

export const MOCK_REPLY_PREFIX = "Hola, soy el agente de prueba. Recibí:";

const usage: GenerateResult["usage"] = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};

function textOf(message: PromptMessage | undefined): string {
  if (message === undefined || message.role === "system") return "";
  return message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

function lastUserText(prompt: CallOptions["prompt"]): string {
  const user = prompt.findLast((message) => message.role === "user");
  return textOf(user);
}

function toolCall(toolName: string, input: Record<string, string>): GenerateResult {
  return {
    content: [
      { type: "tool-call", toolCallId: `mock-${toolName}`, toolName, input: JSON.stringify(input) },
    ],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage,
    warnings: [],
  };
}

function text(value: string): GenerateResult {
  return {
    content: [{ type: "text", text: value }],
    finishReason: { unified: "stop", raw: undefined },
    usage,
    warnings: [],
  };
}

function lastToolOutput(prompt: CallOptions["prompt"]): string | null {
  const last = prompt.at(-1);
  if (last?.role !== "tool") return null;
  const result = last.content.find((part) => part.type === "tool-result");
  if (result === undefined) return null;
  const output = result.output;
  if (output.type === "json") return JSON.stringify(output.value);
  if (output.type === "text" || output.type === "error-text") return output.value;
  return null;
}

function hasTool(options: CallOptions, name: string): boolean {
  return (options.tools ?? []).some((tool) => tool.name === name);
}

/**
 * Deterministic model for fixtures mode (no API key):
 * - "persona" → calls the handoff tool;
 * - "mi cita" / "buscar cita" → calls `buscar_cita` with the contact's text, then reports the result;
 * - anything else → "Hola, soy el agente de prueba. Recibí: <último texto>".
 */
export function createMockModel(): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "playground",
    modelId: "mock-recepcion",
    supportedUrls: {},
    async doGenerate(options) {
      const userText = lastUserText(options.prompt);
      const toolOutput = lastToolOutput(options.prompt);
      if (toolOutput !== null) {
        return text(`${MOCK_REPLY_PREFIX} ${userText}\nResultado: ${toolOutput}`);
      }
      const lower = userText.toLowerCase();
      if (lower.includes("persona") && hasTool(options, HANDOFF_TOOL_NAME)) {
        return toolCall(HANDOFF_TOOL_NAME, { motivo: "El usuario pidió hablar con una persona" });
      }
      if (
        (lower.includes("mi cita") || lower.includes("buscar cita")) &&
        hasTool(options, "buscar_cita")
      ) {
        return toolCall("buscar_cita", { consulta: userText });
      }
      return text(`${MOCK_REPLY_PREFIX} ${userText}`);
    },
    doStream() {
      return Promise.reject(new Error("The playground mock model does not stream."));
    },
  };
}
