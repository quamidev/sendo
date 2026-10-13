import { createSendo, type Actor } from "@quami/sendo";
import type { TranscriptionModel } from "ai";
import { memoryAdapter } from "@quami/sendo/adapters/memory";

// Any AI SDK transcription model, e.g. `openai.transcription("whisper-1")` from `@ai-sdk/openai`.
declare const whisper: TranscriptionModel;
declare const userId: string;
declare const tenantId: string;
declare const conversationId: string;

// #region config
const sendo = createSendo({
  adapter: memoryAdapter(),
  appSecret: process.env.SENDO_META_APP_SECRET ?? "",
  verifyToken: process.env.SENDO_VERIFY_TOKEN ?? "",
  resolveToken: (account) => process.env[account.tokenRef],
  // Inbound voice notes are transcribed after the download and before the agent turn.
  transcribe: { model: whisper },
});
// #endregion config

// #region cost
// Admins only (`costs.view`); everyone else gets FORBIDDEN.
const actor: Actor = await sendo.actor(userId, tenantId);
const cost = await sendo.inbox.cost(conversationId, { actor });
// { turns: 12, tokensIn: 13_480, tokensOut: 702, costCents: 2.71, unpricedTurns: 0 }
console.log(cost);
// #endregion cost
