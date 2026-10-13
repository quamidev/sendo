// Installed by `npx shadcn add @sendo/webhook`, then adapted for the playground:
// a mode switch (Supabase or in-memory fixtures), a fake Meta Graph API for local
// runs and the demo agent "recepcion". Server only.
import { createSendo, type Account, type Sendo, type SendoAdapter } from "@quami/sendo";
import { memoryAdapter, type MemoryAdapter } from "@quami/sendo/adapters/memory";
import { supabaseAdapter } from "@quami/sendo/adapters/supabase";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fixtureSnippetVariables } from "@/fixtures/inbox";
import { NUMBER_FIXTURE_WABAS, numbersFixtureRole } from "@/fixtures/numbers";
import { createFixtureClock, seedFixtures, type SeededFixtures } from "@/fixtures/seed";
import { FIXTURE_TEMPLATES } from "@/fixtures/templates";
import { linkDemoContact, recepcionAgent } from "@/lib/demo-agent";
import { createFakeMetaFetch, FAKE_META_APP_ID, FAKE_SIGNUP_TOKEN_PREFIX } from "@/lib/fake-meta";
import { gatedAdapter } from "@/lib/gated-adapter";
import { createMockModel } from "@/lib/mock-model";
import { playgroundUsers } from "@/lib/playground-users";
import { createVaultTokenStore } from "@/lib/sendo-token-store";
import {
  PLAYGROUND_DEFAULT_APP_SECRET,
  PLAYGROUND_DEFAULT_VERIFY_TOKEN,
  PLAYGROUND_TENANT_ID,
  devUserId,
  envValue,
  fakeMetaEnabled,
  playgroundMode,
  supabaseEnv,
  type PlaygroundMode,
} from "@/lib/playground-env";

export interface PlaygroundSendo {
  mode: PlaygroundMode;
  sendo: Sendo;
  /** Resolves when the fixtures are seeded (immediately in Supabase mode). */
  ready: Promise<SeededFixtures | null>;
  /** The in-memory adapter (fixtures mode only). */
  memory: MemoryAdapter | null;
  /** `true` when the deterministic mock model answers (no `SENDO_AGENT_MODEL`). */
  mockModel: boolean;
}

const FAKE_ACCESS_TOKEN = "playground-fake-token";

function createAdapter(mode: PlaygroundMode): {
  adapter: SendoAdapter;
  memory: MemoryAdapter | null;
  ready: Promise<SeededFixtures | null>;
  supabase: SupabaseClient | null;
} {
  if (mode === "supabase") {
    const env = supabaseEnv();
    if (env === null)
      throw new Error(
        "[playground] Supabase mode needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      );
    // Service-role client: server only, never import this file from client components.
    const supabaseAdmin = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const adapter = supabaseAdapter(supabaseAdmin, {
      storageBucket: envValue("SENDO_STORAGE_BUCKET") ?? "sendo-media",
    });
    return { adapter, memory: null, ready: Promise.resolve(null), supabase: supabaseAdmin };
  }

  const clock = createFixtureClock();
  const memory = memoryAdapter({ now: clock.now });
  const ready = seedFixtures(memory, clock).catch((error: unknown) => {
    console.error("[playground] could not seed the fixtures", error);
    return null;
  });
  return { adapter: gatedAdapter(memory, ready), memory, ready, supabase: null };
}

function createPlaygroundSendo(): PlaygroundSendo {
  const mode = playgroundMode();
  const fakeMeta = fakeMetaEnabled();
  const { adapter, memory, ready, supabase } = createAdapter(mode);
  const vault = supabase === null ? null : createVaultTokenStore(supabase);

  /** Env var refs (manual numbers) and `vault:` refs (Embedded Signup with real Meta). */
  async function resolveToken(account: Account): Promise<string> {
    const token = envValue(account.tokenRef);
    if (token !== undefined) return token;
    if (fakeMeta && account.tokenRef.startsWith("playground:")) {
      return `${FAKE_SIGNUP_TOKEN_PREFIX}${account.phoneNumberId ?? account.id}`;
    }
    if (fakeMeta) return FAKE_ACCESS_TOKEN;
    if (supabase !== null && account.tokenRef.startsWith("vault:")) {
      const response = await supabase.rpc("sendo_vault_read_token", {
        secret_id: account.tokenRef.slice("vault:".length),
      });
      const data: unknown = response.data;
      if (typeof data === "string" && data !== "") return data;
    }
    throw new Error(
      `[playground] Missing access token for account ${account.phoneNumberId ?? account.id}: set ${account.tokenRef}.`,
    );
  }

  const sendo = createSendo({
    adapter,
    appSecret: envValue("SENDO_META_APP_SECRET") ?? PLAYGROUND_DEFAULT_APP_SECRET,
    verifyToken: envValue("SENDO_VERIFY_TOKEN") ?? PLAYGROUND_DEFAULT_VERIFY_TOKEN,
    // Each sendo_accounts row stores the NAME of the env var holding its access token (SENDO_TOKEN_MAIN).
    resolveToken,
    ...(fakeMeta
      ? {
          fetch: createFakeMetaFetch({
            templates: FIXTURE_TEMPLATES.map((template) => ({
              id: `fake-${template.name}`,
              ...template,
            })),
            wabas: NUMBER_FIXTURE_WABAS,
          }),
          // Embedded Signup against the fake SDK and Graph API: tokens are never stored.
          meta: { appId: FAKE_META_APP_ID },
          storeToken: ({ account }) =>
            Promise.resolve(`playground:${account.phoneNumberId ?? "unknown"}`),
          deleteToken: () => Promise.resolve(),
        }
      : {
          ...(vault ?? {}),
          meta: {
            appId: envValue("NEXT_PUBLIC_SENDO_META_APP_ID"),
            configId:
              envValue("SENDO_META_CONFIG_ID") ?? envValue("NEXT_PUBLIC_SENDO_META_CONFIG_ID"),
          },
        }),
    linkContact: linkDemoContact,
    resolveHandoffTargets: () => [devUserId()],
    // Names for assignees, system lines and {{agente}} (lib/playground-users.ts).
    resolveUsers: playgroundUsers,
    // App values for snippets: {{saldo}} of linked residents (fixtures/inbox/snippets.ts).
    resolveSnippetVariables: ({ contact }) => Promise.resolve(fixtureSnippetVariables(contact)),
    // Single-user playground: the dev user is the tenant's admin (inbox, numbers, links).
    // The numbers fixture tenants add an admin and an agent (fixtures/numbers).
    resolveRole: ({ userId, tenantId }) => {
      const fixtureRole = numbersFixtureRole(userId, tenantId, devUserId());
      if (fixtureRole !== undefined) {
        return Promise.resolve(fixtureRole === null ? null : { role: fixtureRole });
      }
      return Promise.resolve(
        userId === devUserId() && tenantId === PLAYGROUND_TENANT_ID
          ? { role: "admin" as const }
          : null,
      );
    },
    agentDefaults: { historyLimit: 20, maxStepsPerTurn: 5, maxMessagesPerMinutePerContact: 10 },
    eventRetentionDays: 30,
    logger: console,
  });

  const configuredModel = envValue("SENDO_AGENT_MODEL");
  sendo.agent(recepcionAgent(configuredModel ?? createMockModel()));

  return { mode, sendo, ready, memory, mockModel: configuredModel === undefined };
}

// One instance per server process: `next dev` re-evaluates modules on hot reload, and
// the in-memory fixtures would be lost without this cache.
const globalForSendo = globalThis as typeof globalThis & {
  __sendoPlayground?: PlaygroundSendo;
};

export const playground: PlaygroundSendo = (globalForSendo.__sendoPlayground ??=
  createPlaygroundSendo());

export const sendo: Sendo = playground.sendo;
