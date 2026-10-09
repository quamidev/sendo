import { gateway, wrapLanguageModel, type LanguageModel } from "ai";
import { DEMO_FALLBACK_TEXT, DEMO_MAX_OUTPUT_TOKENS } from "./protocol";

type LanguageModelV3 = Extract<LanguageModel, { specificationVersion: "v3" }>;
type GenerateResult = Awaited<ReturnType<LanguageModelV3["doGenerate"]>>;

/**
 * `SENDO_DEMO_MODEL` (e.g. `openai/gpt-5-mini`) resolved like the AI SDK resolves string ids
 * (`globalThis.AI_SDK_DEFAULT_PROVIDER`, else the AI Gateway), with every call capped at
 * `maxOutputTokens: 300`. `null` when the variable is unset.
 */
export function demoModel(modelId: string | undefined): LanguageModelV3 | null {
  const id = modelId?.trim();
  if (id === undefined || id === "") return null;
  const provider = globalThis.AI_SDK_DEFAULT_PROVIDER ?? gateway;
  return wrapLanguageModel({
    model: provider.languageModel(id),
    middleware: {
      specificationVersion: "v3",
      transformParams: ({ params }) =>
        Promise.resolve({
          ...params,
          maxOutputTokens: Math.min(
            params.maxOutputTokens ?? DEMO_MAX_OUTPUT_TOKENS,
            DEMO_MAX_OUTPUT_TOKENS,
          ),
        }),
    },
  });
}

const NO_USAGE: GenerateResult["usage"] = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};

/** The scripted fallback: always answers `DEMO_FALLBACK_TEXT`, costs nothing. */
export function fallbackModel(): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "sendo-demo",
    modelId: "scripted-fallback",
    supportedUrls: {},
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: "text", text: DEMO_FALLBACK_TEXT }],
        finishReason: { unified: "stop", raw: undefined },
        usage: NO_USAGE,
        warnings: [],
      }),
    doStream: () => Promise.reject(new Error("The demo fallback model does not stream.")),
  };
}
