import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../adapters/memory";
import { createGraphClient } from "../client/graph-client";
import { GRAPH, useGraphServer } from "../core/test-utils";
import {
  addAccount,
  findWabaIdsForToken,
  type AccountPrompt,
  type AddAccountInput,
} from "./accounts";
import { PHONE_NUMBER_ID, SENTINEL_TOKEN, WABA_ID, doctorEnv, graphHandlers } from "./test-helpers";

const { server, requests } = useGraphServer();

function input(overrides: Partial<AddAccountInput> = {}): AddAccountInput {
  return {
    phoneNumberId: PHONE_NUMBER_ID,
    wabaId: WABA_ID,
    tokenEnv: "WA_TOKEN_MAIN",
    ...overrides,
  };
}

function debugToken(targetIds: string[]) {
  return http.get(`${GRAPH}/debug_token`, () =>
    HttpResponse.json({
      data: {
        granular_scopes: [
          { scope: "whatsapp_business_messaging", target_ids: ["555"] },
          { scope: "whatsapp_business_management", target_ids: targetIds },
        ],
      },
    }),
  );
}

function scriptedPrompt(answers: string[]): AccountPrompt & { questions: string[] } {
  const questions: string[] = [];
  const fn = (question: string) => {
    questions.push(question);
    return Promise.resolve(answers.shift() ?? "");
  };
  return Object.assign(fn, { questions });
}

async function add(overrides: Partial<AddAccountInput> = {}, prompt?: AccountPrompt) {
  const adapter = memoryAdapter();
  const account = await addAccount({
    adapter,
    graph: createGraphClient(),
    env: doctorEnv(),
    input: input(overrides),
    prompt,
  });
  return { adapter, account };
}

describe("addAccount (non-interactive)", () => {
  it("inserts the account with the token env name and fetched display phone", async () => {
    server.use(graphHandlers.phoneOk());
    const { adapter, account } = await add({ timezone: "America/Mexico_City" });
    expect(account).toMatchObject({
      phoneNumberId: PHONE_NUMBER_ID,
      wabaId: WABA_ID,
      displayPhone: "+1 555-000-1111",
      tokenRef: "WA_TOKEN_MAIN",
      tenantId: null,
      timezone: "America/Mexico_City",
      active: true,
    });
    const stored = await adapter.accounts.list();
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(SENTINEL_TOKEN);
    expect(JSON.stringify(adapter.__state)).not.toContain(SENTINEL_TOKEN);
  });

  it("uses the given display phone and tenant without calling Meta", async () => {
    const tenantId = "8f2d3c1a-1111-4222-8333-444455556666";
    const { account } = await add({ displayPhone: "+502 5555 0000", tenantId });
    expect(account.displayPhone).toBe("+502 5555 0000");
    expect(account.tenantId).toBe(tenantId);
    expect(account.timezone).toBe("America/Guatemala");
    expect(requests).toHaveLength(0);
  });

  it("refuses an empty or missing token env", async () => {
    await expect(add({ tokenEnv: "WA_TOKEN_EMPTY" })).rejects.toMatchObject({
      code: "CONFIG_ERROR",
      message: expect.stringContaining("WA_TOKEN_EMPTY") as unknown,
    });
    const adapter = memoryAdapter();
    await expect(
      addAccount({
        adapter,
        graph: createGraphClient(),
        env: doctorEnv({ WA_TOKEN_MAIN: "  " }),
        input: input(),
      }),
    ).rejects.toMatchObject({ code: "CONFIG_ERROR" });
    expect(await adapter.accounts.list()).toEqual([]);
  });

  it("requires phone number id and token env without a prompt", async () => {
    await expect(add({ phoneNumberId: undefined })).rejects.toMatchObject({ code: "CONFIG_ERROR" });
    await expect(add({ tokenEnv: undefined })).rejects.toMatchObject({ code: "CONFIG_ERROR" });
    await expect(add({ phoneNumberId: "abc" })).rejects.toMatchObject({ code: "CONFIG_ERROR" });
    await expect(add({ tokenEnv: "BAD-NAME" })).rejects.toMatchObject({ code: "CONFIG_ERROR" });
    await expect(add({ tenantId: "not-a-uuid", displayPhone: "+1" })).rejects.toMatchObject({
      code: "CONFIG_ERROR",
    });
  });

  it("fetches the WABA id from the token scopes when there is one candidate", async () => {
    server.use(debugToken([WABA_ID]), graphHandlers.phoneOk());
    const { account } = await add({ wabaId: undefined });
    expect(account.wabaId).toBe(WABA_ID);
  });

  it("refuses when the WABA id cannot be determined", async () => {
    server.use(debugToken(["1", "2"]), graphHandlers.phoneOk());
    await expect(add({ wabaId: undefined })).rejects.toMatchObject({
      code: "CONFIG_ERROR",
      message: expect.stringContaining("--waba-id") as unknown,
    });
    server.use(http.get(`${GRAPH}/debug_token`, () => HttpResponse.json({}, { status: 400 })));
    await expect(add({ wabaId: undefined })).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });

  it("propagates an invalid token (190) without leaking it", async () => {
    server.use(graphHandlers.phoneError(190));
    const error: unknown = await add().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "META_API_ERROR", metaCode: 190 });
    expect((error as Error).message).not.toContain(SENTINEL_TOKEN);
  });

  it("surfaces duplicate accounts", async () => {
    server.use(graphHandlers.phoneOk());
    const adapter = memoryAdapter();
    const opts = { adapter, graph: createGraphClient(), env: doctorEnv(), input: input() };
    await addAccount(opts);
    await expect(addAccount(opts)).rejects.toMatchObject({ code: "ACCOUNT_EXISTS" });
  });
});

describe("addAccount (interactive)", () => {
  it("prompts for missing values", async () => {
    server.use(debugToken([]), graphHandlers.phoneOk());
    const prompt = scriptedPrompt([PHONE_NUMBER_ID, "WA_TOKEN_MAIN", WABA_ID, ""]);
    const { account } = await add(
      { phoneNumberId: undefined, tokenEnv: undefined, wabaId: undefined },
      prompt,
    );
    expect(prompt.questions).toHaveLength(4);
    expect(account).toMatchObject({
      phoneNumberId: PHONE_NUMBER_ID,
      wabaId: WABA_ID,
      tenantId: null,
    });
  });

  it("asks for the display phone when Meta lookup fails for other reasons", async () => {
    server.use(graphHandlers.phoneError(100, 400));
    const prompt = scriptedPrompt(["+502 1234 5678", ""]);
    const { account } = await add({}, prompt);
    expect(account.displayPhone).toBe("+502 1234 5678");
  });
});

describe("findWabaIdsForToken", () => {
  it("returns [] on network errors", async () => {
    server.use(http.get(`${GRAPH}/debug_token`, () => HttpResponse.error()));
    expect(await findWabaIdsForToken(createGraphClient(), SENTINEL_TOKEN)).toEqual([]);
  });
});
