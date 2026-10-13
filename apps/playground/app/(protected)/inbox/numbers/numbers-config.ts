// Installed by `shadcn add sendo-numbers`, then adapted for the playground: the user comes
// from the playground's auth; in fixtures mode the `sendo-playground-numbers` cookie (set by
// /dev/numbers-fixture) switches to the numbers edge-case tenants; Embedded Signup runs against
// the fake SDK and Graph API when Meta is fake. Kept on reinstall (scripts/registry-install.mjs).
import { GRAPH_API_VERSION, type TenantId } from "@quami/sendo";
import { cookies } from "next/headers";
import type { EmbeddedSignupClientConfig, NumbersLinks } from "@/components/sendo/numbers/types";
import { isNumbersFixture, NUMBERS_FIXTURE_COOKIE, numbersFixtureUser } from "@/fixtures/numbers";
import { requireUser as requireAppUser } from "@/lib/auth";
import { FAKE_META_APP_ID, FAKE_META_CONFIG_ID } from "@/lib/fake-meta";
import { envValue, fakeMetaEnabled, playgroundMode } from "@/lib/playground-env";
import { playground } from "@/lib/sendo";

export interface NumbersUser {
  /** Passed to `sendo.actor()` (your `resolveRole` decides the role) and stored as `by`. */
  userId: string;
  /** The tenant whose numbers the user manages; `null` for single-tenant apps. */
  tenantId: TenantId;
}

async function fixtureCookie(): Promise<string | undefined> {
  try {
    return (await cookies()).get(NUMBERS_FIXTURE_COOKIE)?.value;
  } catch {
    // Outside a request (tests calling the actions directly).
    return undefined;
  }
}

/** The signed-in user (redirects to /login), once the fixtures are seeded. */
export async function requireUser(): Promise<NumbersUser> {
  const user = await requireAppUser();
  await playground.ready;
  if (playgroundMode() !== "fixtures") return user;
  const fixture = await fixtureCookie();
  return isNumbersFixture(fixture) ? numbersFixtureUser(fixture, user) : user;
}

export interface NumbersConfig {
  /** Users without `numbers.manage` (non-admins) see a read-only list; `false` hides the numbers. */
  numbersVisibleToNonAdmins: boolean;
  /**
   * Re-check every connected number on Meta when the screen loads (`refreshBilling`): updates
   * the payment state and marks numbers whose token Meta rejects ("Token inválido · reconectar").
   */
  checkTokensOnLoad: boolean;
  /** Longest the page waits for those checks; slower numbers keep their stored state. */
  tokenCheckTimeoutMs: number;
  links: NumbersLinks;
}

export const numbersConfig: NumbersConfig = {
  numbersVisibleToNonAdmins: true,
  checkTokensOnLoad: true,
  tokenCheckTimeoutMs: 6000,
  links: {
    inbox: "/inbox",
    metaBilling: "https://business.facebook.com/settings/whatsapp-business-accounts/{wabaId}",
    metaRequirements: "https://sendo.dev/docs/embedded-signup",
  },
};

/** Fake Meta: the fake SDK in public/; real Meta: the env vars, as in the registry template. */
export function embeddedSignupConfig(): EmbeddedSignupClientConfig | null {
  if (fakeMetaEnabled()) {
    return {
      appId: FAKE_META_APP_ID,
      configId: FAKE_META_CONFIG_ID,
      graphVersion: GRAPH_API_VERSION,
      coexistence: true,
      sdkUrl: "/fake-facebook-sdk.js",
      trustedOrigins: ["self"],
    };
  }
  const appId = envValue("NEXT_PUBLIC_SENDO_META_APP_ID") ?? "";
  const configId = envValue("NEXT_PUBLIC_SENDO_META_CONFIG_ID") ?? "";
  if (appId === "" || configId === "") return null;
  return { appId, configId, graphVersion: GRAPH_API_VERSION, coexistence: true };
}
