import { experimental_transcribe, NoTranscriptGeneratedError, type TranscriptionModel } from "ai";
import type { JsonObject, MessageWithMedia } from "../../types/entities";
import { UNTRANSCRIBED_VOICE_NOTE } from "../../agents/prompt";
import type { SendoContext } from "../context";

/** Longest wait for the transcription model (AC-VN-1). */
export const TRANSCRIBE_TIMEOUT_MS = 30_000;
/** Larger voice notes are not sent to the model (the usual provider limit). */
export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Why a voice note has no transcript (`metadata.transcription.error`): `too_large` (over
 * 25 MB), `timeout` (no answer in time), `no_audio` (the download failed or the bytes are
 * gone), `empty` (the model heard nothing), `failed` (the model threw).
 */
export type TranscriptionError = "too_large" | "timeout" | "no_audio" | "empty" | "failed";

class TranscriptionTimeout extends Error {}

/** Name stored in `metadata.transcription.model`. */
export function transcriptionModelName(model: TranscriptionModel): string {
  return typeof model === "string" ? model : model.modelId;
}

async function audioBytes(
  ctx: SendoContext,
  message: MessageWithMedia,
): Promise<Uint8Array | TranscriptionError> {
  const media = message.media;
  const store = ctx.config.media;
  if (media?.downloadStatus !== "done" || media.storagePath === null || store === null) {
    return "no_audio";
  }
  if (media.sizeBytes !== null && media.sizeBytes > TRANSCRIBE_MAX_BYTES) return "too_large";
  const bytes = await store.get(media.storagePath);
  if (bytes === null) return "no_audio";
  return bytes.byteLength > TRANSCRIBE_MAX_BYTES ? "too_large" : bytes;
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TranscriptionTimeout());
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pipeline step after the media download (AC-VN-1/2): with `createSendo({ transcribe })`, an
 * inbound `audio` message is transcribed with `experimental_transcribe` from `ai` (30 s, 25 MB).
 * The transcript goes into `text` with `metadata.transcription = { model, ms }`; otherwise `text`
 * stays null and `metadata.transcription.error` says why. Never throws; returns the stored row.
 */
export async function transcribeVoiceNote(
  ctx: SendoContext,
  message: MessageWithMedia,
): Promise<MessageWithMedia> {
  const config = ctx.team.transcribe;
  if (config === null || message.type !== "audio" || message.direction !== "in") return message;
  const model = transcriptionModelName(config.model);
  const started = Date.now();
  let text: string | null = null;
  let error: TranscriptionError | null = null;
  let failure: unknown;
  try {
    const audio = await audioBytes(ctx, message);
    if (typeof audio === "string") {
      error = audio;
    } else {
      const result = await withTimeout(config.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS, (abortSignal) =>
        experimental_transcribe({ model: config.model, audio, abortSignal }),
      );
      text = result.text.trim();
      if (text === "") {
        text = null;
        error = "empty";
      }
    }
  } catch (cause) {
    error =
      cause instanceof TranscriptionTimeout
        ? "timeout"
        : NoTranscriptGeneratedError.isInstance(cause)
          ? "empty"
          : "failed";
    failure = cause;
  }
  if (error !== null) {
    ctx.logger.warn(
      `[sendo] voice note ${message.id} was not transcribed (${error}); the agent reads "${UNTRANSCRIBED_VOICE_NOTE}"`,
      ...(failure === undefined ? [] : [failure]),
    );
  }
  const transcription: JsonObject = { model, ms: Date.now() - started };
  if (error !== null) transcription.error = error;
  try {
    await ctx.adapter.messages.update(message.id, {
      ...(text === null ? {} : { text }),
      metadata: { transcription },
    });
    return (await ctx.adapter.messages.get(message.id)) ?? message;
  } catch (cause) {
    ctx.logger.error(`[sendo] could not store the transcript of ${message.id}`, cause);
    return message;
  }
}
