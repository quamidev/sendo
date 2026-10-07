import { describe, expect, it } from "vitest";
import { NotImplementedError } from "../errors/errors";
import * as waLi from "../index";
import { createStubSlots } from "./slots";
import { makeClient } from "./test-utils";

describe("createWhatsApp slots", () => {
  it("stubs handleWebhook, events, maintenance, inbox and agent", async () => {
    const stubs = createStubSlots();
    await expect(
      stubs.handleWebhook(new Request("https://x.dev/api/whatsapp")),
    ).rejects.toBeInstanceOf(NotImplementedError);
    await expect(stubs.events.reprocess("e1")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(stubs.maintenance.prune()).rejects.toBeInstanceOf(NotImplementedError);
    await expect(stubs.inbox.list({ tenantId: null })).rejects.toBeInstanceOf(NotImplementedError);
    await expect(stubs.inbox.markSeen("c1")).rejects.toBeInstanceOf(NotImplementedError);
    expect(() => stubs.agent({ name: "x", model: "m", instructions: "i" })).toThrow(
      NotImplementedError,
    );
  });

  it("reads slots lazily so modules can replace them on the context", async () => {
    const { wa, ctx } = makeClient();
    ctx.slots.maintenance = { prune: () => Promise.resolve(7) };
    ctx.slots.handleWebhook = () => Promise.resolve(new Response("ok"));
    ctx.slots.agent = (def) => ({ name: `registered:${def.name}`, remove: () => undefined });
    expect(await wa.maintenance.prune()).toBe(7);
    expect(await (await wa.handleWebhook(new Request("https://x.dev"))).text()).toBe("ok");
    expect(wa.agent({ name: "a", model: "m", instructions: "i" }).name).toBe("registered:a");
  });

  it("is exported from the main entry", () => {
    expect(waLi.createWhatsApp).toBeTypeOf("function");
    expect(waLi.DEFAULT_HANDOFF_MESSAGE).toBe("Te comunico con una persona del equipo.");
  });
});
