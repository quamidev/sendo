import {
  DuplicateAccountError,
  EmbeddedSignupError,
  MetaApiError,
  createSendo,
  type Account,
  type DeleteToken,
  type StoreToken,
} from "@quami/sendo";
import { memoryAdapter } from "@quami/sendo/adapters/memory";

// #region config
// Keep the business token in your secret store; Sendo only saves the returned reference.
const storeToken: StoreToken = async ({ account, token }) => {
  const id = await saveSecret(
    `sendo/${account.tenantId ?? "default"}/${account.phoneNumberId}`,
    token,
  );
  return `vault:${id}`;
};
// Called on disconnect (and to undo a failed signup). Ignore refs you didn't create.
const deleteToken: DeleteToken = async (tokenRef) => {
  if (tokenRef.startsWith("vault:")) await deleteSecret(tokenRef.slice("vault:".length));
};

export const sendo = createSendo({
  adapter: memoryAdapter(), // your adapter
  appSecret: process.env.SENDO_META_APP_SECRET ?? "",
  verifyToken: process.env.SENDO_VERIFY_TOKEN ?? "",
  resolveToken: (account) =>
    account.tokenRef.startsWith("vault:")
      ? readSecret(account.tokenRef.slice("vault:".length))
      : process.env[account.tokenRef],
  storeToken,
  deleteToken,
  meta: {
    appId: process.env.NEXT_PUBLIC_SENDO_META_APP_ID,
    configId: process.env.NEXT_PUBLIC_SENDO_META_CONFIG_ID,
  },
});
// #endregion config

// #region action
type ConnectResult = { ok: true; account: Account } | { ok: false; message: string };

/** Server action called by the "Conectar WhatsApp" button with what Meta returned. */
export async function connectWhatsApp(input: {
  tenantId: string;
  code: string;
  wabaId: string;
  phoneNumberId: string;
  coexistence?: boolean;
  pin?: string;
}): Promise<ConnectResult> {
  // Check your actor's `numbers.manage` capability first.
  try {
    const account = await sendo.accounts.completeEmbeddedSignup(input);
    return { ok: true, account };
  } catch (error) {
    if (error instanceof DuplicateAccountError) {
      return { ok: false, message: "Este número ya está conectado en otra organización." };
    }
    if (error instanceof EmbeddedSignupError) {
      const messages: Record<EmbeddedSignupError["code"], string> = {
        SIGNUP_CODE_EXPIRED: "El enlace con Meta expiró, intenta de nuevo.",
        META_PERMISSION_MISSING:
          "Tu app de Meta aún no tiene los permisos necesarios. Revisa sendo.dev/docs/embedded-signup.",
        PIN_CONFLICT:
          "Este número tiene un PIN de verificación en dos pasos. Escríbelo para continuar.",
        SIGNUP_FAILED: "No pudimos conectar el número. Intenta de nuevo.",
      };
      return { ok: false, message: messages[error.code] };
    }
    throw error;
  }
}
// #endregion action

// #region billing
export async function sendReminder(tenantId: string, phone: string): Promise<string | null> {
  try {
    await sendo.send.template(phone, "recordatorio_cita", { tenant: tenantId, language: "es" });
    return null;
  } catch (error) {
    if (error instanceof MetaApiError && error.hint === "billing_not_ready") {
      // Meta error 131042: the number is now billingReady = false and account.billing fired.
      return "Este número aún no tiene método de pago en Meta";
    }
    throw error;
  }
}

// "Ya lo agregué, verificar" on the numbers screen.
export async function verifyBilling(accountId: string) {
  const account = await sendo.accounts.refreshBilling(accountId);
  return account.billingReady; // true, false, or null (Meta didn't say)
}
// #endregion billing

// Your secret store (Supabase Vault, AWS Secrets Manager...).
async function saveSecret(_name: string, _value: string): Promise<string> {
  return "secret-id";
}
async function readSecret(_id: string): Promise<string> {
  return "";
}
async function deleteSecret(_id: string): Promise<void> {}
