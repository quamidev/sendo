// #region metaDirect
import { GRAPH_API_VERSION, createWhatsApp, metaDirect, quamiCloud } from "@quami/wa-li";
import { memoryAdapter } from "@quami/wa-li/adapters/memory";

// Same as the appSecret / verifyToken / resolveToken shorthand, plus transport options.
const transport = metaDirect({
  appSecret: process.env.WA_APP_SECRET ?? "",
  verifyToken: process.env.WA_VERIFY_TOKEN ?? "",
  resolveToken: (account) => process.env[account.tokenRef],
  version: GRAPH_API_VERSION, // pinned Graph API version, e.g. "v26.0"
});

export const wa = createWhatsApp({ adapter: memoryAdapter(), transport });
// #endregion metaDirect

// #region quamiCloud
// V3, reserved: every method rejects with NotImplementedError("quamiCloud") today.
export const hosted = createWhatsApp({
  adapter: memoryAdapter(),
  transport: quamiCloud({ apiKey: process.env.QUAMI_API_KEY ?? "" }),
});
// #endregion quamiCloud
