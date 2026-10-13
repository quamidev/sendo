import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../adapters/memory";
import { createGraphClient } from "../client/graph-client";
import { useGraphServer } from "../core/test-utils";
import { addAccount, type AccountPrompt, type AddAccountInput } from "./accounts";
import { PHONE_NUMBER_ID, SENTINEL_TOKEN, WABA_ID, doctorEnv, graphHandlers } from "./test-helpers";

const { server } = useGraphServer();

function input(overrides: Partial<AddAccountInput> = {}): AddAccountInput {
  return {
    phoneNumberId: PHONE_NUMBER_ID,
    wabaId: WABA_ID,
    tokenEnv: "SENDO_TOKEN_MAIN",
    ...overrides,
  };
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
  it("refuses an empty or missing token env", async () => {
    await expect(add({ tokenEnv: "SENDO_TOKEN_EMPTY" })).rejects.toMatchObject({
      code: "CONFIG_ERROR",
      message: expect.stringContaining("SENDO_TOKEN_EMPTY") as unknown,
    });
    const adapter = memoryAdapter();
    await expect(
      addAccount({
        adapter,
        graph: createGraphClient(),
        env: doctorEnv({ SENDO_TOKEN_MAIN: "  " }),
        input: input(),
      }),
    ).rejects.toMatchObject({ code: "CONFIG_ERROR" });
    expect(await adapter.accounts.list()).toEqual([]);
  });

  it("propagates an invalid token (190) without leaking it", async () => {
    server.use(graphHandlers.phoneError(190));
    const error: unknown = await add().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "META_API_ERROR", metaCode: 190 });
    expect((error as Error).message).not.toContain(SENTINEL_TOKEN);
  });
});
