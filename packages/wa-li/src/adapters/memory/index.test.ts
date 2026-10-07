import { describe, expect, it } from "vitest";
import { memoryAdapter } from ".";

const makeClock = (start = "2026-06-01T12:00:00.000Z") => {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
};

const seedConversation = async (adapter: ReturnType<typeof memoryAdapter>) => {
  const account = await adapter.accounts.insert({
    tenantId: null,
    phoneNumberId: "pn-1",
    wabaId: "waba-1",
    displayPhone: "+502 5555 0000",
    tokenRef: "WA_TOKEN",
  });
  const { contact } = await adapter.contacts.upsert({
    accountId: account.id,
    tenantId: null,
    phone: "+50255550001",
  });
  const { conversation } = await adapter.conversations.getOpenOrCreate({
    contactId: contact.id,
    accountId: account.id,
    tenantId: null,
  });
  return { account, contact, conversation };
};

describe("memoryAdapter", () => {
  it("uses the injected clock for timestamps and lock expiry", async () => {
    const clock = makeClock();
    const adapter = memoryAdapter({ now: clock.now });
    const event = await adapter.events.insert({ payload: {} });
    expect(event.receivedAt).toEqual(clock.now());

    expect(await adapter.locks.acquire("k", 1_000)).toBe(true);
    clock.advance(999);
    expect(await adapter.locks.acquire("k", 1_000)).toBe(false);
    clock.advance(1);
    expect(await adapter.locks.acquire("k", 1_000)).toBe(true);
  });

  it("orders messages created in the same millisecond by insertion", async () => {
    const clock = makeClock();
    const adapter = memoryAdapter({ now: clock.now });
    const { conversation } = await seedConversation(adapter);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const m = await adapter.messages.insertOutbound({
        tenantId: null,
        conversationId: conversation.id,
        type: "text",
        content: { body: `m${i}` },
        sender: "system",
      });
      ids.push(m.id);
    }
    expect((await adapter.messages.history(conversation.id, 10)).map((m) => m.id)).toEqual(ids);
    const page = await adapter.messages.thread(conversation.id, { limit: 2 });
    const older = await adapter.messages.thread(conversation.id, {
      limit: 2,
      cursor: page.nextCursor,
    });
    expect([...page.items, ...older.items].map((m) => m.id)).toEqual([...ids].reverse());
  });

  it("returns copies so callers cannot mutate stored records", async () => {
    const adapter = memoryAdapter();
    const { conversation } = await seedConversation(adapter);
    conversation.status = "closed";
    expect((await adapter.conversations.get(conversation.id))?.status).toBe("agent");
  });

  it("builds signed URLs from signedUrlBase", async () => {
    const clock = makeClock();
    const adapter = memoryAdapter({
      now: clock.now,
      signedUrlBase: "http://localhost:3000/media/",
    });
    const url = await adapter.storage.signedUrl("t/a b.jpg", 60);
    expect(url.startsWith("http://localhost:3000/media/t/a%20b.jpg?expires=")).toBe(true);
    expect(new URL(url).searchParams.get("expires")).toBe(
      String(Math.floor(clock.now().getTime() / 1000) + 60),
    );
  });

  it("simulates missing tables, schema version and bucket for doctor checks", async () => {
    const adapter = memoryAdapter({
      missingTables: ["wa_locks", "wa_schema_meta"],
      bucketExists: false,
    });
    expect(await adapter.schemaVersion()).toBeNull();
    expect(await adapter.healthCheck()).toEqual({
      tablesOk: false,
      missing: ["wa_locks", "wa_schema_meta"],
    });
    expect(await adapter.storage.bucketExists()).toBe(false);
    expect(await memoryAdapter({ schemaVersion: 7 }).schemaVersion()).toBe(7);
  });

  it("reset() empties the store", async () => {
    const adapter = memoryAdapter();
    const { account } = await seedConversation(adapter);
    expect(adapter.__state.conversations.size).toBe(1);
    adapter.reset();
    expect(await adapter.accounts.getById(account.id)).toBeNull();
    expect(adapter.__state.accounts.size).toBe(0);
  });
});
