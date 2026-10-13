import type { AgentMode, OnboardedVia, Role } from "@quami/sendo";
import { PLAYGROUND_TENANT_ID } from "@/lib/playground-env";

/**
 * Numbers screen edge cases (break-ui, AC-NS-3). Each case is its own tenant so the main
 * playground tenant keeps its single number (the "One" case) and the rest of the playground
 * (inbox, replay, send without account) is unaffected:
 * - `demo`: the main tenant, 1 number
 * - `worst`: 6 numbers, every status, an 80-character label, a number without label
 * - `empty`: no numbers
 * - `agent`: the `worst` tenant seen by a user with the `agent` role (read-only list)
 */
export const NUMBERS_FIXTURES = ["demo", "worst", "empty", "agent"] as const;
export type NumbersFixture = (typeof NUMBERS_FIXTURES)[number];

/** Cookie set by `/dev/numbers-fixture?set=<fixture>` (fixtures mode only). */
export const NUMBERS_FIXTURE_COOKIE = "sendo-playground-numbers";

export const NUMBERS_WORST_TENANT_ID = "00000000-0000-4000-8000-00000000a006";
export const NUMBERS_EMPTY_TENANT_ID = "00000000-0000-4000-8000-00000000a000";
/** A teammate with the `agent` role in the `worst` tenant. */
export const NUMBERS_AGENT_USER_ID = "dev-agent";

/** The 80-character label (the screen's `maxLength`). */
export const LONG_NUMBER_LABEL =
  "Cobranza y facturación · Torre Vista, Las Flores, Jardines del Valle y Monte Rey";

export function isNumbersFixture(value: unknown): value is NumbersFixture {
  return typeof value === "string" && (NUMBERS_FIXTURES as readonly string[]).includes(value);
}

/** The user the numbers screen runs as for a fixture. */
export function numbersFixtureUser(
  fixture: NumbersFixture,
  devUser: { userId: string; tenantId: string },
): { userId: string; tenantId: string } {
  switch (fixture) {
    case "demo":
      return devUser;
    case "worst":
      return { userId: devUser.userId, tenantId: NUMBERS_WORST_TENANT_ID };
    case "empty":
      return { userId: devUser.userId, tenantId: NUMBERS_EMPTY_TENANT_ID };
    case "agent":
      return { userId: NUMBERS_AGENT_USER_ID, tenantId: NUMBERS_WORST_TENANT_ID };
  }
}

/** Roles in the fixture tenants (`resolveRole` in lib/sendo.ts); `undefined` = not a fixture. */
export function numbersFixtureRole(
  userId: string,
  tenantId: string | null,
  devUserId: string,
): Role | null | undefined {
  if (tenantId !== NUMBERS_WORST_TENANT_ID && tenantId !== NUMBERS_EMPTY_TENANT_ID) {
    return userId === NUMBERS_AGENT_USER_ID && tenantId === PLAYGROUND_TENANT_ID
      ? "agent"
      : undefined;
  }
  if (userId === devUserId) return "admin";
  if (userId === NUMBERS_AGENT_USER_ID) return "agent";
  return null;
}

/** How the fake Graph API answers for a WABA (billing read, token check). */
export interface FakeWaba {
  /** `ready`: has `primary_funding_id`; `missing`: no funding id; `unknown`: Meta doesn't say. */
  funding: "ready" | "missing" | "unknown";
  /** Meta answers error 190 (expired or revoked token). */
  tokenInvalid?: boolean;
}

export interface FixtureNumber {
  key: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string;
  label: string | null;
  tokenRef: string;
  active: boolean;
  isDefault: boolean;
  coexistence: boolean;
  onboardedVia: OnboardedVia;
  agentPaused: boolean;
  agentMode: AgentMode | null;
  billingReady: boolean | null;
  waba: FakeWaba;
}

/** Every status of the screen, oldest first (the screen's order). */
export const WORST_CASE_NUMBERS: FixtureNumber[] = [
  {
    key: "connected-default",
    phoneNumberId: "300000000000001",
    wabaId: "400000000000001",
    displayPhone: "+502 2200 1001",
    label: "Recepción",
    tokenRef: "vault:00000000-0000-4000-8000-0000000000e1",
    active: true,
    isDefault: true,
    coexistence: false,
    onboardedVia: "embedded_signup",
    agentPaused: false,
    agentMode: "auto",
    billingReady: true,
    waba: { funding: "ready" },
  },
  {
    key: "long-label-billing-missing",
    phoneNumberId: "300000000000002",
    wabaId: "400000000000002",
    displayPhone: "+52 1 55 1234 5678",
    label: LONG_NUMBER_LABEL,
    tokenRef: "vault:00000000-0000-4000-8000-0000000000e2",
    active: true,
    isDefault: false,
    coexistence: true,
    onboardedVia: "embedded_signup",
    agentPaused: true,
    agentMode: null,
    billingReady: false,
    waba: { funding: "missing" },
  },
  {
    key: "no-label-billing-unknown",
    phoneNumberId: "300000000000003",
    wabaId: "400000000000003",
    displayPhone: "+1 555-010-4477",
    label: null,
    tokenRef: "SENDO_TOKEN_SOPORTE",
    active: true,
    isDefault: false,
    coexistence: false,
    onboardedVia: "manual",
    agentPaused: false,
    agentMode: "draft",
    billingReady: null,
    waba: { funding: "unknown" },
  },
  {
    key: "token-invalid",
    phoneNumberId: "300000000000004",
    wabaId: "400000000000004",
    displayPhone: "+502 5512 4433",
    label: "Ventas",
    tokenRef: "vault:00000000-0000-4000-8000-0000000000e4",
    active: true,
    isDefault: false,
    coexistence: true,
    onboardedVia: "embedded_signup",
    agentPaused: false,
    agentMode: null,
    billingReady: true,
    waba: { funding: "ready", tokenInvalid: true },
  },
  {
    key: "disconnected",
    phoneNumberId: "300000000000005",
    wabaId: "400000000000005",
    displayPhone: "+502 4420 9981",
    label: "Mantenimiento",
    tokenRef: "vault:00000000-0000-4000-8000-0000000000e5",
    active: false,
    isDefault: false,
    coexistence: false,
    onboardedVia: "embedded_signup",
    agentPaused: false,
    agentMode: null,
    billingReady: true,
    waba: { funding: "ready" },
  },
  {
    key: "connect-draft",
    phoneNumberId: "300000000000006",
    wabaId: "400000000000006",
    displayPhone: "+502 3301 7720",
    label: "Jo",
    tokenRef: "connect:00000000-0000-4000-8000-0000000000e6",
    active: true,
    isDefault: false,
    coexistence: false,
    onboardedVia: "connect",
    agentPaused: true,
    agentMode: "draft",
    billingReady: true,
    waba: { funding: "ready" },
  },
];

/** Fake Graph API answers per WABA id (lib/fake-meta.ts). */
export const NUMBER_FIXTURE_WABAS: Record<string, FakeWaba> = Object.fromEntries(
  WORST_CASE_NUMBERS.map((number) => [number.wabaId, number.waba]),
);
