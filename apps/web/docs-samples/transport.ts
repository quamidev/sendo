// #region metaDirect
import { GRAPH_API_VERSION, createSendo, metaDirect, quamiCloud } from "@quami/sendo";
import { memoryAdapter } from "@quami/sendo/adapters/memory";

// Same as the appSecret / verifyToken / resolveToken shorthand, plus transport options.
const transport = metaDirect({
  appSecret: process.env.SENDO_META_APP_SECRET ?? "",
  verifyToken: process.env.SENDO_VERIFY_TOKEN ?? "",
  resolveToken: (account) => process.env[account.tokenRef],
  version: GRAPH_API_VERSION, // pinned Graph API version, e.g. "v26.0"
});

export const sendo = createSendo({ adapter: memoryAdapter(), transport });
// #endregion metaDirect

// #region quamiCloud
// V3, reserved: every method rejects with NotImplementedError("quamiCloud") today.
export const hosted = createSendo({
  adapter: memoryAdapter(),
  transport: quamiCloud({ apiKey: process.env.QUAMI_API_KEY ?? "" }),
});
// #endregion quamiCloud
