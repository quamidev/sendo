import type { Account, SendoAdapter } from "@quami/sendo";
import { NUMBERS_WORST_TENANT_ID, WORST_CASE_NUMBERS } from "./index";

/** Seeds the `worst` numbers tenant (the `empty` tenant has no rows). Fixture key → account. */
export async function seedNumberFixtures(
  adapter: SendoAdapter,
  checkedAt: Date,
): Promise<Record<string, Account>> {
  const seeded: Record<string, Account> = {};
  for (const number of WORST_CASE_NUMBERS) {
    seeded[number.key] = await adapter.accounts.insert({
      tenantId: NUMBERS_WORST_TENANT_ID,
      channel: "whatsapp",
      label: number.label,
      phoneNumberId: number.phoneNumberId,
      wabaId: number.wabaId,
      displayPhone: number.displayPhone,
      tokenRef: number.tokenRef,
      active: number.active,
      isDefault: number.isDefault,
      coexistence: number.coexistence,
      onboardedVia: number.onboardedVia,
      agentPaused: number.agentPaused,
      agentMode: number.agentMode,
      billingReady: number.billingReady,
      billingCheckedAt: number.billingReady === null ? null : checkedAt,
    });
  }
  return seeded;
}
