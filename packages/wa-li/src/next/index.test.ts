import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_IDS, loadWebhookFixtureText } from "../../test/support/fixtures";
import { signedRequest } from "../../test/support/sign";
import { accountInput, makeClient } from "../core/test-utils";
import type { HandleWebhookOptions } from "../core/slots";
import { toNextHandlers, type WebhookHandlerClient } from "./index";

const after = vi.hoisted(() => vi.fn<(task: Promise<unknown>) => void>());
vi.mock("next/server", () => ({ after }));

const URL_BASE = "https://app.example/api/whatsapp";

function fakeClient() {
  const calls: { method: string; opts: HandleWebhookOptions | undefined }[] = [];
  const wa: WebhookHandlerClient = {
    handleWebhook: (request, opts) => {
      calls.push({ method: request.method, opts });
      return Promise.resolve(new Response("ok"));
    },
  };
  return { wa, calls };
}

describe("toNextHandlers", () => {
  beforeEach(() => {
    after.mockReset();
  });

  it("GET forwards to handleWebhook without waitUntil", async () => {
    const { wa, calls } = fakeClient();
    const { GET } = toNextHandlers(wa);
    expect(await (await GET(new Request(URL_BASE))).text()).toBe("ok");
    expect(calls).toEqual([{ method: "GET", opts: undefined }]);
  });

  it("POST passes next/server after() as waitUntil", async () => {
    const { wa, calls } = fakeClient();
    const { POST } = toNextHandlers(wa);
    await POST(new Request(URL_BASE, { method: "POST", body: "{}" }));
    const waitUntil = calls[0]?.opts?.waitUntil;
    expect(waitUntil).toBeTypeOf("function");
    const task = Promise.resolve("done");
    waitUntil?.(task);
    expect(after).toHaveBeenCalledWith(task);
  });

  it("prefers an explicit waitUntil", async () => {
    const { wa, calls } = fakeClient();
    const waitUntil = vi.fn();
    const { POST } = toNextHandlers(wa, { waitUntil });
    await POST(new Request(URL_BASE, { method: "POST", body: "{}" }));
    expect(calls[0]?.opts?.waitUntil).toBe(waitUntil);
  });

  it("runs the real pipeline inside after()", async () => {
    const { wa, adapter } = makeClient();
    await adapter.accounts.insert(accountInput({ phoneNumberId: FIXTURE_IDS.phoneNumberId }));
    const { POST } = toNextHandlers(wa);

    const response = await POST(
      signedRequest(URL_BASE, loadWebhookFixtureText("text"), "app-secret-value"),
    );
    expect(response.status).toBe(200);
    expect(after).toHaveBeenCalledTimes(1);
    await after.mock.calls[0]?.[0];
    const [event] = [...adapter.__state.events.values()];
    expect(event?.status).toBe("processed");
    expect(adapter.__state.messages.size).toBe(1);
  });
});
