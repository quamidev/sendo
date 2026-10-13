import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Demo limits: a signed counter token per browser session, and counters per IP per day, for all
// visitors per day (`SENDO_DEMO_DAILY_CAP`) and per month of spend. The counters live in Upstash / Vercel KV (Redis REST) when configured,
// otherwise in this server instance's memory.

export interface DemoLimitsEnv {
  KV_REST_API_URL?: string | undefined;
  KV_REST_API_TOKEN?: string | undefined;
  UPSTASH_REDIS_REST_URL?: string | undefined;
  UPSTASH_REDIS_REST_TOKEN?: string | undefined;
  SENDO_DEMO_SECRET?: string | undefined;
}

export interface CounterStore {
  readonly kind: "kv" | "memory";
  /** Adds `amount` and returns the new value; the key expires about `ttlSeconds` later. */
  incrBy(key: string, amount: number, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<number>;
}

interface MemoryEntry {
  value: number;
  expiresAt: number;
}

const memory = new Map<string, MemoryEntry>();

function memoryStore(): CounterStore {
  function live(key: string): MemoryEntry | undefined {
    const entry = memory.get(key);
    if (entry !== undefined && entry.expiresAt <= Date.now()) {
      memory.delete(key);
      return undefined;
    }
    return entry;
  }
  return {
    kind: "memory",
    incrBy(key, amount, ttlSeconds) {
      const entry = live(key) ?? { value: 0, expiresAt: Date.now() + ttlSeconds * 1000 };
      entry.value += amount;
      memory.set(key, entry);
      return Promise.resolve(entry.value);
    },
    get(key) {
      return Promise.resolve(live(key)?.value ?? 0);
    },
  };
}

function kvStore(url: string, token: string): CounterStore {
  async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
    const response = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`demo KV answered ${String(response.status)}`);
    const results = (await response.json()) as { result?: unknown; error?: string }[];
    return results.map((entry) => {
      if (entry.error !== undefined) throw new Error(`demo KV: ${entry.error}`);
      return entry.result;
    });
  }
  return {
    kind: "kv",
    async incrBy(key, amount, ttlSeconds) {
      const [value] = await pipeline([
        ["INCRBY", key, amount],
        // Keys carry their day or month, so refreshing the TTL on every write is harmless.
        ["EXPIRE", key, ttlSeconds],
      ]);
      return Number(value);
    },
    async get(key) {
      const [value] = await pipeline([["GET", key]]);
      return value === null || value === undefined ? 0 : Number(value);
    },
  };
}

/** KV when `KV_REST_API_URL`/`_TOKEN` (or the `UPSTASH_REDIS_REST_*` pair) are set, else memory. */
export function counterStore(env: DemoLimitsEnv): CounterStore {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (url !== undefined && url !== "" && token !== undefined && token !== "") {
    return kvStore(url, token);
  }
  return memoryStore();
}

// ---------------------------------------------------------------------------
// Session counter (signed token, no cookie: AC-ST-15)

const PROCESS_SECRET = randomBytes(32).toString("hex");

function secretOf(env: DemoLimitsEnv): string {
  const configured = env.SENDO_DEMO_SECRET?.trim();
  return configured === undefined || configured === "" ? PROCESS_SECRET : configured;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(`sendo-demo-session:${value}`).digest("base64url");
}

/** Messages already sent in this session; a missing, malformed or forged token counts as 0. */
export function readSessionToken(token: string | null, env: DemoLimitsEnv): number {
  if (token === null) return 0;
  const [count, signature, ...rest] = token.trim().split(".");
  if (rest.length > 0 || count === undefined || signature === undefined) return 0;
  if (!/^\d{1,4}$/.test(count)) return 0;
  const expected = Buffer.from(sign(count, secretOf(env)));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 0;
  return Number(count);
}

/** `<count>.<signature>`: the browser keeps it in `sessionStorage` and sends it back in a header. */
export function sessionToken(count: number, env: DemoLimitsEnv): string {
  const value = String(count);
  return `${value}.${sign(value, secretOf(env))}`;
}

// ---------------------------------------------------------------------------
// Keys

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded !== undefined && forwarded !== "") return forwarded;
  return headers.get("x-real-ip")?.trim() ?? "unknown";
}

export function ipKey(ip: string, now: Date): string {
  return `sendo-demo:ip:${now.toISOString().slice(0, 10)}:${ip}`;
}

export function dailyKey(now: Date): string {
  return `sendo-demo:day:${now.toISOString().slice(0, 10)}`;
}

export function budgetKey(now: Date): string {
  return `sendo-demo:budget:${now.toISOString().slice(0, 7)}`;
}

/** `SENDO_DEMO_BUDGET_USD` in micro-dollars; unset, invalid or zero means no spending. */
export function budgetMicroUsd(raw: string | undefined): number {
  const usd = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(usd) && usd > 0 ? Math.floor(usd * 1_000_000) : 0;
}

/** `SENDO_DEMO_DAILY_CAP`: model-answered messages per UTC day for all visitors; unset or invalid means no cap. */
export function dailyCap(raw: string | undefined): number | null {
  const value = raw?.trim();
  return value === undefined || !/^\d+$/.test(value) ? null : Number(value);
}

/** Cents (possibly fractional) → micro-dollars, rounded up. */
export function centsToMicroUsd(cents: number): number {
  return Math.ceil(cents * 10_000);
}
