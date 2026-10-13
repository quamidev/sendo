import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandleWebhookOptions } from "../core/slots";
import { toNextHandlers, type WebhookHandlerClient } from "./index";

const after = vi.hoisted(() => vi.fn<(task: Promise<unknown>) => void>());
vi.mock("next/server", () => ({ after }));

const URL_BASE = "https://app.example/api/sendo/webhook";

function fakeClient() {
  const calls: { method: string; opts: HandleWebhookOptions | undefined }[] = [];
  const sendo: WebhookHandlerClient = {
    handleWebhook: (request, opts) => {
      calls.push({ method: request.method, opts });
      return Promise.resolve(new Response("ok"));
    },
  };
  return { sendo, calls };
}

describe("toNextHandlers", () => {
  beforeEach(() => {
    after.mockReset();
  });

  it("POST passes next/server after() as waitUntil", async () => {
    const { sendo, calls } = fakeClient();
    const { POST } = toNextHandlers(sendo);
    await POST(new Request(URL_BASE, { method: "POST", body: "{}" }));
    const waitUntil = calls[0]?.opts?.waitUntil;
    expect(waitUntil).toBeTypeOf("function");
    const task = Promise.resolve("done");
    waitUntil?.(task);
    expect(after).toHaveBeenCalledWith(task);
  });
});
