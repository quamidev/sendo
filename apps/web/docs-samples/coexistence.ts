import { createSendo } from "@quami/sendo";
import { memoryAdapter } from "@quami/sendo/adapters/memory";

// #region config
export const sendo = createSendo({
  adapter: memoryAdapter(),
  appSecret: process.env.SENDO_META_APP_SECRET ?? "",
  verifyToken: process.env.SENDO_VERIFY_TOKEN ?? "",
  resolveToken: (account) => process.env[account.tokenRef],
  coexistence: {
    // An owner's reply from the phone pauses the AI on that conversation (default true).
    pauseAgentOnPhoneReply: true,
    // Store the phone app's chat history when Meta sends it (default false).
    importHistory: true,
  },
});
// #endregion config

// #region events
sendo.on("conversation.agent_paused", ({ conversation, paused, by }) => {
  if (by === "business_app" && paused) {
    console.log(`The owner answered ${conversation.id} from the phone; the AI is paused there.`);
  }
});
// #endregion events
