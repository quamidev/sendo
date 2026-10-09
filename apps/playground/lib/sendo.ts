// Installed by `shadcn add sendo-webhook`, then adapted for the playground:
// a mode switch (Supabase or in-memory fixtures), a fake Meta Graph API for local
// runs and the demo agent "recepcion". Server only.
import { createSendo, type Sendo, type SendoAdapter } from "@quami/sendo";
import { memoryAdapter, type MemoryAdapter } from "@quami/sendo/adapters/memory";
import { supabaseAdapter } from "@quami/sendo/adapters/supabase";
import { createClient } from "@supabase/supabase-js";
import { createFixtureClock, seedFixtures, type SeededFixtures } from "@/fixtures/seed";
import { FIXTURE_TEMPLATES } from "@/fixtures/templates";
import { linkDemoContact, recepcionAgent } from "@/lib/demo-agent";
import { createFakeMetaFetch } from "@/lib/fake-meta";
import { gatedAdapter } from "@/lib/gated-adapter";
import { createMockModel } from "@/lib/mock-model";
import {
  PLAYGROUND_DEFAULT_APP_SECRET,
  PLAYGROUND_DEFAULT_VERIFY_TOKEN,
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
    return { adapter, memory: null, ready: Promise.resolve(null) };
  }

  const clock = createFixtureClock();
  const memory = memoryAdapter({ now: clock.now });
  const ready = seedFixtures(memory, clock).catch((error: unknown) => {
    console.error("[playground] could not seed the fixtures", error);
    return null;
  });
  return { adapter: gatedAdapter(memory, ready), memory, ready };
}

function createPlaygroundSendo(): PlaygroundSendo {
  const mode = playgroundMode();
  const fakeMeta = fakeMetaEnabled();
  const { adapter, memory, ready } = createAdapter(mode);

  const sendo = createSendo({
    adapter,
    appSecret: envValue("SENDO_META_APP_SECRET") ?? PLAYGROUND_DEFAULT_APP_SECRET,
    verifyToken: envValue("SENDO_VERIFY_TOKEN") ?? PLAYGROUND_DEFAULT_VERIFY_TOKEN,
    // Each sendo_accounts row stores the NAME of the env var holding its access token (SENDO_TOKEN_MAIN).
    resolveToken: (account) => {
      const token = envValue(account.tokenRef);
      if (token !== undefined) return token;
      if (fakeMeta) return FAKE_ACCESS_TOKEN;
      throw new Error(
        `[playground] Missing access token for account ${account.phoneNumberId}: set ${account.tokenRef}.`,
      );
    },
    ...(fakeMeta
      ? {
          fetch: createFakeMetaFetch({
            templates: FIXTURE_TEMPLATES.map((template) => ({
              id: `fake-${template.name}`,
              ...template,
            })),
          }),
        }
      : {}),
    linkContact: linkDemoContact,
    resolveHandoffTargets: () => [devUserId()],
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
