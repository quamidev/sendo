import { buildWhatsAppLink, createSendo, type Actor } from "@quami/sendo";
import { memoryAdapter } from "@quami/sendo/adapters/memory";

const sendo = createSendo({
  adapter: memoryAdapter(),
  appSecret: process.env.SENDO_META_APP_SECRET ?? "",
  verifyToken: process.env.SENDO_VERIFY_TOKEN ?? "",
  resolveToken: (account) => process.env[account.tokenRef],
});
declare const tenantId: string;
declare const admin: Actor;

// #region create
// The tenant's default number (or pass `account`: its id or Meta phone number id).
const link = await sendo.links.create({
  tenant: tenantId,
  text: "Hola, quiero información",
  source: "garita",
});
// link.url   → "https://wa.me/50255551234?text=Hola%2C%20quiero%20informaci%C3%B3n%20%5B%23garita%5D"
// link.text  → "Hola, quiero información [#garita]"
// link.code  → "[#garita]"
// link.phone → "+50255551234"
// #endregion create

// #region build
// No lookup at all when you already know the number.
const direct = buildWhatsAppLink({ phone: "+502 5555 1234", text: "Hola", source: "factura" });
// #endregion build

// #region sources
// Admin only (`numbers.manage`); scoped to the actor's tenant. `source: null` = direct.
const sources = await sendo.links.sources({ actor: admin, from: new Date("2026-10-01") });
// [{ source: "garita", conversations: 42 }, { source: null, conversations: 17 }, ...]
// #endregion sources

export { direct, link, sources };
