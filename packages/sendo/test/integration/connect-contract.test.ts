/**
 * The package ↔ Sendo Connect contract, checked from this repo against the Connect code itself
 * (SNL-7.3). Runs when the private repo is checked out next to this one (`../sendo-connect`),
 * and skips with that reason otherwise (CI of this repo has no access to it). No Docker, no
 * database: it imports Connect's pure modules in-process (`lib/relay/routing.ts`,
 * `lib/relay/http.ts` and `lib/contract.ts`, which re-exports the package build Connect links)
 * and hands their output to the package's own client and webhook handler. Connect's DB-backed
 * routes are covered by its own suites (`pnpm test:e2e` / `pnpm test:supabase` there).
 *
 * Ways it could fail (one test each):
 * [CC-CONNECT-1] An error envelope Connect answers (`connectError`, every `CONNECT_ERROR_CODES`
 *                value) doesn't parse into `ConnectRequestError` with its status, code, step and
 *                Meta codes, or `isUnauthorized` / `isProjectSuspended` misread it (AC-CN-1).
 * [CC-CONNECT-2] A body the relay plans for a customer (Connect's routing of a multi-number Meta
 *                body) and signs (Connect's `signConnectBody`, two secrets during rotation) is
 *                rejected by the customer's `handleWebhook`, carries another customer's
 *                messages, or is accepted by another customer (AC-CN-2).
 * [CC-CONNECT-3] Connect imports a name from `@quami/sendo` that the package no longer exports
 *                (from source or from the build Connect links), or the build is stale against
 *                the source for the shared constants.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createConnectClient, ConnectRequestError } from "../../src/connect/client";
import { CONNECT_ERROR_CODES } from "../../src/connect/contract";
import { accountInput, makeClient } from "../../src/core/test-utils";
import * as entry from "../../src/index";
import { verifyConnectSignature } from "../../src/webhook/verify";
import { FIXTURE_IDS } from "../support/fixtures";
import { WEBHOOK_URL, freshFixture } from "./harness";

const CONNECT_ROOT = resolve(import.meta.dirname, "../../../../../sendo-connect");
const present = existsSync(join(CONNECT_ROOT, "lib/relay/routing.ts"));

// Connect's modules import `@/lib/*` (its own alias): point them at Connect's real contract module
// and a fixed env (the pure helpers used here read none of it).
const connectDir = vi.hoisted(() => `${import.meta.dirname}/../../../../../sendo-connect`);
vi.mock("@/lib/contract", async () => {
  const nodePath = await import("node:path");
  return (await import(
    /* @vite-ignore */ nodePath.resolve(connectDir, "lib/contract.ts")
  )) as Record<string, unknown>;
});
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ CRON_SECRET: "connect-contract-cron-secret", VERCEL_ENV: undefined }),
}));

interface RoutingModule {
  parseMetaPayload: (raw: Uint8Array) => Record<string, unknown> | null;
  planDeliveries: (
    raw: Uint8Array,
    payload: Record<string, unknown>,
    table: {
      byPhoneNumberId: ReadonlyMap<string, { projectId: string; numberId: string }>;
      byWabaId: ReadonlyMap<string, readonly string[]>;
    },
  ) => {
    deliveries: { target: { projectId: string; numberId: string | null }; body: Buffer }[];
    dropped: unknown[];
  };
}
interface HttpModule {
  connectError: (
    status: number,
    code: string,
    message: string,
    details?: { step?: string; metaCode?: number; subcode?: number; fbtraceId?: string },
  ) => Response;
}
interface ContractModule {
  signConnectBody: (rawBody: string | Uint8Array, secret: string | readonly string[]) => string;
  CONNECT_ERROR_CODES: Record<string, string>;
  CONNECT_SIGNATURE_HEADER: string;
  CONNECT_SIGNATURE_TOLERANCE_SEC: number;
}

const connectModule = <T>(path: string) =>
  import(/* @vite-ignore */ join(CONNECT_ROOT, path)) as Promise<T>;

describe.skipIf(!present)(
  `Sendo Connect contract (${present ? "../sendo-connect found" : "skipped: ../sendo-connect is not checked out next to this repo"})`,
  () => {
    it("[CC-CONNECT-1] every Connect error envelope parses into ConnectRequestError", async () => {
      const { connectError } = await connectModule<HttpModule>("lib/relay/http.ts");
      const cases: {
        status: number;
        code: string;
        details?: { step: string; metaCode?: number; subcode?: number; fbtraceId?: string };
        unauthorized: boolean;
        suspended: boolean;
      }[] = [
        {
          status: 401,
          code: CONNECT_ERROR_CODES.unauthorized,
          unauthorized: true,
          suspended: false,
        },
        {
          status: 403,
          code: CONNECT_ERROR_CODES.projectSuspended,
          unauthorized: false,
          suspended: true,
        },
        {
          status: 404,
          code: CONNECT_ERROR_CODES.numberNotFound,
          unauthorized: false,
          suspended: false,
        },
        {
          status: 409,
          code: CONNECT_ERROR_CODES.numberInUse,
          unauthorized: false,
          suspended: false,
        },
        {
          status: 403,
          code: CONNECT_ERROR_CODES.earlyAccess,
          details: { step: "exchange_code" },
          unauthorized: false,
          suspended: false,
        },
        {
          status: 400,
          code: CONNECT_ERROR_CODES.invalidRequest,
          unauthorized: false,
          suspended: false,
        },
        {
          status: 502,
          code: CONNECT_ERROR_CODES.metaError,
          details: { step: "register_phone", metaCode: 133005, subcode: 2388001, fbtraceId: "AbC" },
          unauthorized: false,
          suspended: false,
        },
        { status: 500, code: CONNECT_ERROR_CODES.internal, unauthorized: false, suspended: false },
      ];
      expect(new Set(cases.map((c) => c.code))).toEqual(
        new Set(Object.values(CONNECT_ERROR_CODES)),
      );

      for (const c of cases) {
        const answer = connectError(c.status, c.code, `Connect says ${c.code}`, c.details);
        expect(answer.headers.get("cache-control")).toBe("no-store");
        const client = createConnectClient({
          config: { apiKey: "sk_connect_contract_key", baseUrl: "https://connect.sendo.test" },
          fetch: () => Promise.resolve(answer),
        });
        const error = await client.getWebhook().then(
          () => expect.fail(`${c.code} resolved`),
          (e: unknown) => e,
        );
        expect(error, c.code).toBeInstanceOf(ConnectRequestError);
        expect(error, c.code).toMatchObject({
          status: c.status,
          errorCode: c.code,
          step: c.details?.step ?? null,
          metaCode: c.details?.metaCode ?? null,
          subcode: c.details?.subcode ?? null,
          fbtraceId: c.details?.fbtraceId ?? null,
          isUnauthorized: c.unauthorized,
          isProjectSuspended: c.suspended,
        });
        expect((error as Error).message).toContain(`Connect says ${c.code}`);
      }
    });

    it("[CC-CONNECT-2] relay-planned, relay-signed bodies reach only their customer's handleWebhook", async () => {
      const { parseMetaPayload, planDeliveries } =
        await connectModule<RoutingModule>("lib/relay/routing.ts");
      const { signConnectBody } = await connectModule<ContractModule>("lib/contract.ts");

      const OLD = "scsec_customer_a_old_secret_0001";
      const NEW = "scsec_customer_a_new_secret_0002";
      const B_SECRET = "scsec_customer_b_secret_0003";
      const customers = {
        a: {
          projectId: "project-a",
          phoneNumberId: FIXTURE_IDS.phoneNumberId,
          wabaId: FIXTURE_IDS.wabaId,
          relaySecrets: [NEW, OLD],
          // Mid-rotation: this customer still verifies with the old secret.
          signingSecret: OLD,
        },
        b: {
          projectId: "project-b",
          phoneNumberId: FIXTURE_IDS.secondPhoneNumberId,
          wabaId: FIXTURE_IDS.secondWabaId,
          relaySecrets: [B_SECRET],
          signingSecret: B_SECRET,
        },
      };

      const raw = Buffer.from(freshFixture("multi-entry"), "utf8");
      const payload = parseMetaPayload(raw);
      if (payload === null) throw new Error("Connect refused the multi-entry fixture");
      const plan = planDeliveries(raw, payload, {
        byPhoneNumberId: new Map(
          Object.values(customers).map((c) => [
            c.phoneNumberId,
            { projectId: c.projectId, numberId: `number-${c.projectId}` },
          ]),
        ),
        byWabaId: new Map(Object.values(customers).map((c) => [c.wabaId, [c.projectId]])),
      });
      expect(plan.dropped).toEqual([]);
      expect(plan.deliveries.map((d) => d.target.projectId).sort()).toEqual([
        "project-a",
        "project-b",
      ]);

      const apps = await Promise.all(
        Object.values(customers).map(async (customer) => {
          const app = makeClient({
            connect: {
              apiKey: `sk_connect_${customer.projectId}`,
              signingSecret: customer.signingSecret,
            },
          });
          await app.adapter.accounts.insert(
            accountInput({ phoneNumberId: customer.phoneNumberId, wabaId: customer.wabaId }),
          );
          const delivery = plan.deliveries.find((d) => d.target.projectId === customer.projectId);
          if (delivery === undefined) throw new Error(`no delivery for ${customer.projectId}`);
          const header = signConnectBody(delivery.body, customer.relaySecrets);
          expect(header.match(/v1=/g)).toHaveLength(customer.relaySecrets.length);
          expect(
            verifyConnectSignature(delivery.body.toString("utf8"), header, customer.signingSecret),
          ).toBe(true);
          return { customer, app, delivery, header };
        }),
      );

      const post = (body: Buffer, header: string) =>
        new Request(WEBHOOK_URL, {
          method: "POST",
          headers: { "content-type": "application/json", "x-sendo-signature": header },
          body: new Uint8Array(body),
        });

      for (const { app, delivery, header, customer } of apps) {
        const tasks: Promise<unknown>[] = [];
        const response = await app.sendo.handleWebhook(post(delivery.body, header), {
          waitUntil: (p) => tasks.push(p),
        });
        await Promise.all(tasks);
        expect(response.status, customer.projectId).toBe(200);
        const stored = [...app.adapter.__state.messages.values()].filter(
          (m) => m.direction === "in",
        );
        expect(stored.length, customer.projectId).toBeGreaterThan(0);
        const conversations = [...app.adapter.__state.conversations.values()];
        const [own] = await app.adapter.accounts.list({ active: true });
        expect(new Set(conversations.map((c) => c.accountId))).toEqual(new Set([own?.id]));
      }
      const ownMetaIds = (index: number) =>
        [...(apps[index]?.app.adapter.__state.messages.values() ?? [])].map((m) => m.metaMessageId);
      expect(ownMetaIds(0)).toEqual(expect.arrayContaining(["wamid.MULTI001", "wamid.MULTI002"]));
      expect(ownMetaIds(1)).not.toContain("wamid.MULTI001");

      // Customer A's body, signed for A, is refused by customer B (and the other way round).
      const [a, b] = apps;
      if (a === undefined || b === undefined) throw new Error("two customers expected");
      for (const [from, to] of [
        [a, b],
        [b, a],
      ] as const) {
        const before = to.app.adapter.__state.events.size;
        const response = await to.app.sendo.handleWebhook(post(from.delivery.body, from.header));
        expect(response.status).toBe(401);
        expect(to.app.adapter.__state.events.size).toBe(before);
      }
    });

    it("[CC-CONNECT-3] every name Connect imports from @quami/sendo is exported, and the build it links is current", async () => {
      const source = readFileSync(join(CONNECT_ROOT, "lib/contract.ts"), "utf8");
      const pairs = [...source.matchAll(/export \{([^}]*)\} from "@quami\/sendo"/g)].flatMap(
        (block) =>
          (block[1] ?? "")
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name !== "" && !name.startsWith("type "))
            .map((name) => {
              const [original = name, alias = original] = name.split(/\s+as\s+/);
              return { original, alias };
            }),
      );
      expect(pairs.length).toBeGreaterThan(10);
      const linked = await connectModule<ContractModule & Record<string, unknown>>(
        "lib/contract.ts",
      );
      const fromSource = entry as Record<string, unknown>;
      expect(
        pairs.filter(({ original }) => !(original in fromSource)).map((p) => p.original),
        "imported by Connect's lib/contract.ts but not exported by src/index.ts",
      ).toEqual([]);
      expect(
        pairs.filter(({ alias }) => linked[alias] === undefined).map((p) => p.alias),
        "missing from the package build Connect links (rebuild: pnpm --filter @quami/sendo build)",
      ).toEqual([]);
      expect(linked.CONNECT_ERROR_CODES).toEqual(CONNECT_ERROR_CODES);
      expect(linked.CONNECT_SIGNATURE_HEADER).toBe(entry.CONNECT_SIGNATURE_HEADER);
      expect(linked.CONNECT_SIGNATURE_TOLERANCE_SEC).toBe(entry.CONNECT_SIGNATURE_TOLERANCE_SEC);
    });
  },
);
