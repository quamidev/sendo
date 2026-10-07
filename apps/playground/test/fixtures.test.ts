import { memoryAdapter } from "@quami/wa-li/adapters/memory";
import { describe, expect, it } from "vitest";
import {
  INBOX_FIXTURES,
  LONG_CONTACT_NAME,
  LONG_THREAD_LENGTH,
  OTHER_OPERATOR_ID,
} from "@/fixtures/inbox";
import { createFixtureClock, seedFixtures } from "@/fixtures/seed";
import { FIXTURES_DEV_USER_ID, PLAYGROUND_TENANT_ID } from "@/lib/playground-env";

async function seeded() {
  const clock = createFixtureClock();
  const adapter = memoryAdapter({ now: clock.now });
  const base = new Date("2026-10-06T18:00:00Z");
  const result = await seedFixtures(adapter, clock, base);
  const id = (key: string): string => {
    const value = result.conversations[key];
    if (value === undefined) throw new Error(`fixture ${key} missing`);
    return value;
  };
  return { adapter, base, result, id };
}

describe("inbox fixtures", () => {
  it("seeds the account of the package webhook fixtures and two approved templates", async () => {
    const { adapter, result } = await seeded();
    expect(result.account).toMatchObject({
      phoneNumberId: "100000000000001",
      tenantId: PLAYGROUND_TENANT_ID,
      tokenRef: "WA_TOKEN_MAIN",
    });
    const templates = await adapter.templates.list({ accountId: result.account.id });
    expect(templates.map((t) => [t.name, t.status])).toEqual([
      ["recordatorio_cita", "APPROVED"],
      ["seguimiento", "APPROVED"],
    ]);
  });

  it("has a 60-character contact name", async () => {
    expect([...LONG_CONTACT_NAME]).toHaveLength(60);
    const { adapter, id } = await seeded();
    const conversation = await adapter.conversations.get(id("nombre-largo"));
    const contact = await adapter.contacts.get(conversation?.contactId ?? "");
    expect(contact?.profileName).toBe(LONG_CONTACT_NAME);
  });

  it("has a 500-message thread in chronological order", async () => {
    const { adapter, id } = await seeded();
    const history = await adapter.messages.history(id("hilo-500"), 1000);
    expect(history).toHaveLength(LONG_THREAD_LENGTH);
    const times = history.map((message) => message.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("has an empty conversation", async () => {
    const { adapter, id } = await seeded();
    expect(await adapter.messages.history(id("vacia"), 10)).toEqual([]);
    expect((await adapter.conversations.get(id("vacia")))?.lastInboundAt).toBeNull();
  });

  it("has a failed send with the Meta error", async () => {
    const { adapter, id } = await seeded();
    const failed = (await adapter.messages.history(id("envio-fallido"), 10)).find(
      (m) => m.status === "failed",
    );
    expect(failed).toMatchObject({
      sender: "human",
      error: { code: 131047, title: "Re-engagement message" },
    });
  });

  it("has an image whose download failed", async () => {
    const { adapter, id } = await seeded();
    const images = (await adapter.messages.history(id("media-faltante"), 10)).filter(
      (m) => m.type === "image",
    );
    expect(images.map((m) => m.media?.downloadStatus)).toEqual(["failed", "done"]);
  });

  it("mixes statuses and assignees", async () => {
    const { adapter } = await seeded();
    const { items } = await adapter.conversations.list({
      tenantId: PLAYGROUND_TENANT_ID,
      limit: 100,
    });
    expect(items).toHaveLength(INBOX_FIXTURES.length);
    expect(new Set(items.map((c) => c.status))).toEqual(new Set(["agent", "human", "closed"]));
    const assignees = new Set(items.map((c) => c.assignedTo));
    expect(assignees).toEqual(new Set([null, FIXTURES_DEV_USER_ID, OTHER_OPERATOR_ID]));
  });

  it("dates messages relative to the seed time", async () => {
    const { adapter, base, id } = await seeded();
    const conversation = await adapter.conversations.get(id("humano-mio"));
    expect(conversation?.lastInboundAt?.toISOString()).toBe(
      new Date(base.getTime() - 2 * 60_000).toISOString(),
    );
    expect(conversation?.unreadCount).toBe(1);
  });
});
