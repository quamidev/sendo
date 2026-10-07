import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import type { Account } from "../types/entities";
import {
  RecordNotFoundError,
  TemplateNotFoundError,
  TemplateVariablesError,
  WindowClosedError,
} from "../errors/errors";
import {
  GRAPH,
  accountInput,
  acceptSends,
  makeClient,
  openConversation,
  useGraphServer,
} from "../core/test-utils";

const graph = useGraphServer();

type Client = ReturnType<typeof makeClient>;

async function setup() {
  const client = makeClient();
  const accountA = await client.adapter.accounts.insert(accountInput());
  const accountB = await client.adapter.accounts.insert(
    accountInput({ tenantId: "tenant-b", phoneNumberId: "PN_B", tokenRef: "WA_TOKEN_B" }),
  );
  return { ...client, accountA, accountB };
}

async function seedConversation(
  client: Client,
  account: Account,
  opts: { phone: string; minutesAgo?: number; activityMinutesAgo?: number; profileName?: string },
) {
  const { contact, conversation } = await openConversation(
    client.ctx,
    account,
    opts.phone,
    opts.minutesAgo ?? 1,
  );
  if (opts.profileName !== undefined) {
    await client.adapter.contacts.upsert({
      accountId: account.id,
      tenantId: account.tenantId,
      phone: contact.phone,
      profileName: opts.profileName,
    });
  }
  const updated = await client.adapter.conversations.update(conversation.id, {
    lastActivityAt: new Date(Date.now() - (opts.activityMinutesAgo ?? 0) * 60_000),
  });
  return { contact, conversation: updated };
}

async function inbound(
  client: Client,
  conversationId: string,
  tenantId: string | null,
  n: number,
  text = `mensaje ${n}`,
) {
  const message = await client.adapter.messages.insertInbound({
    tenantId,
    conversationId,
    type: "text",
    content: { body: text },
    text,
    metaMessageId: `wamid.IN${n}`,
    sentAt: new Date(),
  });
  if (!message) throw new Error("seed failed");
  return message;
}

function approvedTemplate(variableCount = 0) {
  return {
    name: "seguimiento",
    language: "es",
    category: "UTILITY" as const,
    status: "APPROVED" as const,
    components: [
      { type: "BODY", text: variableCount ? "Hola {{1}}, tu cita es el {{2}}" : "Hola" },
    ],
    variableCount,
  };
}

describe("wa.inbox.list", () => {
  it("returns the tenant's conversations sorted by last activity with the C7 shape", async () => {
    const client = await setup();
    const { accountA } = client;
    const older = await seedConversation(client, accountA, {
      phone: "+50255550001",
      activityMinutesAgo: 30,
      profileName: "Ana Pérez",
    });
    const newer = await seedConversation(client, accountA, {
      phone: "+50255550002",
      activityMinutesAgo: 5,
    });
    await inbound(client, older.conversation.id, "tenant-a", 1, "hola");

    const page = await client.wa.inbox.list({ tenantId: "tenant-a" });

    expect(page.items.map((c) => c.id)).toEqual([newer.conversation.id, older.conversation.id]);
    expect(page.nextCursor).toBeNull();
    const [first, second] = page.items;
    expect(first).toMatchObject({
      status: "agent",
      assignedTo: null,
      handoffReason: null,
      accountId: accountA.id,
      tenantId: "tenant-a",
      contact: { phone: "+50255550002", displayName: "+50255550002", appRef: null },
      lastMessagePreview: null,
      window: { open: true },
      conversation: { id: newer.conversation.id, contactId: newer.contact.id },
    });
    expect(first?.window.expiresAt).toBeInstanceOf(Date);
    expect(second).toMatchObject({
      unreadCount: 1,
      contact: { id: older.contact.id, displayName: "Ana Pérez", phone: "+50255550001" },
      lastMessagePreview: {
        text: "hola",
        direction: "in",
        sender: "contact",
        type: "text",
        status: "received",
      },
    });
    expect(second?.lastMessagePreview?.at).toBeInstanceOf(Date);
    expect(second?.conversation).not.toHaveProperty("contact");
  });

  it("computes a closed window from lastInboundAt", async () => {
    const client = await setup();
    await seedConversation(client, client.accountA, { phone: "+50255550001", minutesAgo: 25 * 60 });
    const [item] = (await client.wa.inbox.list({ tenantId: "tenant-a" })).items;
    expect(item?.window.open).toBe(false);
    expect(item?.window.expiresAt?.getTime()).toBe(
      (item?.lastInboundAt?.getTime() ?? 0) + 24 * 60 * 60_000,
    );
  });

  it("filters by status (single or array) and assignedTo", async () => {
    const client = await setup();
    const { accountA, wa } = client;
    const agent = await seedConversation(client, accountA, { phone: "+50255550001" });
    const mine = await seedConversation(client, accountA, { phone: "+50255550002" });
    const unassignedHuman = await seedConversation(client, accountA, { phone: "+50255550003" });
    const closed = await seedConversation(client, accountA, { phone: "+50255550004" });
    await wa.conversations.assign(mine.conversation.id, "user-1");
    await client.adapter.conversations.update(unassignedHuman.conversation.id, {
      status: "human",
    });
    await wa.conversations.close(closed.conversation.id);

    const ids = async (query: Parameters<typeof wa.inbox.list>[0]) =>
      (await wa.inbox.list(query)).items.map((c) => c.id).sort();

    expect(await ids({ tenantId: "tenant-a", status: "agent" })).toEqual([agent.conversation.id]);
    expect(await ids({ tenantId: "tenant-a", status: ["human", "closed"] })).toEqual(
      [mine.conversation.id, unassignedHuman.conversation.id, closed.conversation.id].sort(),
    );
    expect(await ids({ tenantId: "tenant-a", assignedTo: "user-1" })).toEqual([
      mine.conversation.id,
    ]);
    expect(await ids({ tenantId: "tenant-a", status: "human", assignedTo: null })).toEqual([
      unassignedHuman.conversation.id,
    ]);
  });

  it("paginates with the adapter cursor and clamps the limit", async () => {
    const client = await setup();
    for (let i = 0; i < 5; i++) {
      await seedConversation(client, client.accountA, {
        phone: `+5025555000${i}`,
        activityMinutesAgo: i,
      });
    }
    const first = await client.wa.inbox.list({ tenantId: "tenant-a", limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await client.wa.inbox.list({
      tenantId: "tenant-a",
      limit: 2,
      cursor: first.nextCursor,
    });
    const third = await client.wa.inbox.list({
      tenantId: "tenant-a",
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(third.nextCursor).toBeNull();
    const phones = [...first.items, ...second.items, ...third.items].map((c) => c.contact.phone);
    expect(phones).toEqual([0, 1, 2, 3, 4].map((i) => `+5025555000${i}`));

    const all = await client.wa.inbox.list({ tenantId: "tenant-a", limit: 1000 });
    expect(all.items).toHaveLength(5);
    const one = await client.wa.inbox.list({ tenantId: "tenant-a", limit: 0 });
    expect(one.items).toHaveLength(1);
  });

  it("never returns another tenant's conversations", async () => {
    const client = await setup();
    const a = await seedConversation(client, client.accountA, { phone: "+50255550001" });
    const b = await seedConversation(client, client.accountB, { phone: "+50255550001" });

    const listA = await client.wa.inbox.list({ tenantId: "tenant-a" });
    const listB = await client.wa.inbox.list({ tenantId: "tenant-b" });
    const listNone = await client.wa.inbox.list({ tenantId: null });

    expect(listA.items.map((c) => c.id)).toEqual([a.conversation.id]);
    expect(listB.items.map((c) => c.id)).toEqual([b.conversation.id]);
    expect(listNone.items).toEqual([]);
  });
});

describe("wa.inbox.thread", () => {
  it("returns messages newest first with sender, status, error and media", async () => {
    const client = await setup();
    const { adapter, wa } = client;
    const { conversation } = await seedConversation(client, client.accountA, {
      phone: "+50255550001",
    });
    const text = await inbound(client, conversation.id, "tenant-a", 1);
    const done = await adapter.messages.insertInbound({
      tenantId: "tenant-a",
      conversationId: conversation.id,
      type: "document",
      content: { mediaId: "M1", mimeType: "application/pdf", filename: "receta.pdf" },
      text: null,
      metaMessageId: "wamid.DOC",
      sentAt: new Date(),
    });
    const failed = await adapter.messages.insertInbound({
      tenantId: "tenant-a",
      conversationId: conversation.id,
      type: "image",
      content: { mediaId: "M2", mimeType: "image/jpeg" },
      text: null,
      metaMessageId: "wamid.IMG",
      sentAt: new Date(),
    });
    if (!done || !failed) throw new Error("seed failed");
    await adapter.media.insert({
      tenantId: "tenant-a",
      messageId: done.id,
      metaMediaId: "M1",
      mimeType: "application/pdf",
      sizeBytes: 1234,
      storagePath: "tenant-a/2026/receta.pdf",
      downloadStatus: "done",
    });
    await adapter.media.insert({
      tenantId: "tenant-a",
      messageId: failed.id,
      metaMediaId: "M2",
      mimeType: "image/jpeg",
      downloadStatus: "failed",
    });
    const pending = await adapter.messages.insertOutbound({
      tenantId: "tenant-a",
      conversationId: conversation.id,
      type: "text",
      content: { body: "hola" },
      text: "hola",
      sender: "human",
      senderRef: "user-1",
    });
    await adapter.messages.markFailed(pending.id, { code: 131047, message: "Re-engagement" });

    const page = await wa.inbox.thread(conversation.id);

    expect(page.items.map((m) => m.id)).toEqual([pending.id, failed.id, done.id, text.id]);
    const [out, image, doc, first] = page.items;
    expect(out).toMatchObject({
      conversationId: conversation.id,
      direction: "out",
      sender: "human",
      senderRef: "user-1",
      status: "failed",
      error: { code: 131047, message: "Re-engagement" },
      metaMessageId: null,
    });
    expect(out).not.toHaveProperty("media");
    expect(first).toMatchObject({
      direction: "in",
      sender: "contact",
      status: "received",
      text: "mensaje 1",
      content: { body: "mensaje 1" },
      metaMessageId: "wamid.IN1",
      replyToMetaId: null,
    });
    expect(image?.media).toEqual({
      url: null,
      mimeType: "image/jpeg",
      sizeBytes: null,
      downloadStatus: "failed",
    });
    expect(doc?.media).toMatchObject({
      mimeType: "application/pdf",
      sizeBytes: 1234,
      downloadStatus: "done",
      filename: "receta.pdf",
    });
    const url = new URL(doc?.media?.url ?? "");
    expect(url.pathname).toContain("receta.pdf");
    expect(Number(url.searchParams.get("expires")) - Math.floor(Date.now() / 1000)).toBeCloseTo(
      300,
      -1,
    );
  });

  it("paginates from newest to oldest", async () => {
    const client = await setup();
    const { conversation } = await seedConversation(client, client.accountA, {
      phone: "+50255550001",
    });
    for (let n = 1; n <= 5; n++) await inbound(client, conversation.id, "tenant-a", n);

    const first = await client.wa.inbox.thread(conversation.id, { limit: 2 });
    const second = await client.wa.inbox.thread(conversation.id, {
      limit: 2,
      cursor: first.nextCursor,
    });
    const third = await client.wa.inbox.thread(conversation.id, {
      limit: 2,
      cursor: second.nextCursor,
    });
    expect([...first.items, ...second.items, ...third.items].map((m) => m.text)).toEqual(
      [5, 4, 3, 2, 1].map((n) => `mensaje ${n}`),
    );
    expect(third.nextCursor).toBeNull();
  });

  it("rejects unknown conversations and conversations of another tenant", async () => {
    const client = await setup();
    const { conversation } = await seedConversation(client, client.accountB, {
      phone: "+50255550001",
    });
    await expect(
      client.wa.inbox.thread("00000000-0000-4000-8000-000000000000"),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(
      client.wa.inbox.thread(conversation.id, { tenantId: "tenant-a" }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(
      client.wa.inbox.thread(conversation.id, { tenantId: "tenant-b" }),
    ).resolves.toMatchObject({ items: [] });
  });
});

describe("wa.inbox.reply", () => {
  it("sends text, media and template replies as the human user", async () => {
    const bodies: Record<string, unknown>[] = [];
    graph.server.use(
      http.post(`${GRAPH}/PN_A/media`, () => HttpResponse.json({ id: "MEDIA_UP_1" })),
      acceptSends(bodies),
    );
    const client = await setup();
    await client.adapter.templates.upsertMany(client.accountA.id, [approvedTemplate(2)]);
    const { conversation } = await seedConversation(client, client.accountA, {
      phone: "+50255550001",
    });
    const opts = { userId: "user-1" };

    const text = await client.wa.inbox.reply(conversation.id, { kind: "text", body: "Hola" }, opts);
    const byUrl = await client.wa.inbox.reply(
      conversation.id,
      { kind: "media", mediaType: "image", url: "https://cdn.example.com/a.jpg", caption: "Mira" },
      opts,
    );
    const byFile = await client.wa.inbox.reply(
      conversation.id,
      {
        kind: "media",
        mediaType: "document",
        file: new Uint8Array([1, 2, 3]),
        mimeType: "application/pdf",
        filename: "receta.pdf",
      },
      opts,
    );
    const template = await client.wa.inbox.reply(
      conversation.id,
      { kind: "template", name: "seguimiento", language: "es", variables: ["Ana", "lunes"] },
      opts,
    );

    for (const message of [text, byUrl, byFile, template]) {
      expect(message).toMatchObject({
        conversationId: conversation.id,
        direction: "out",
        sender: "human",
        senderRef: "user-1",
        status: "sent",
      });
    }
    expect([text.type, byUrl.type, byFile.type, template.type]).toEqual([
      "text",
      "image",
      "document",
      "template",
    ]);
    expect(bodies.map((b) => b.type)).toEqual(["text", "image", "document", "template"]);
    expect(bodies[0]).toMatchObject({ to: "+50255550001", text: { body: "Hola" } });
    expect(bodies[2]).toMatchObject({
      document: { id: "MEDIA_UP_1", filename: "receta.pdf" },
    });
    expect(bodies[3]).toMatchObject({
      template: { name: "seguimiento", language: { code: "es" } },
    });
    expect(graph.requests.map((r) => r.url)).toContain(`${GRAPH}/PN_A/media`);
  });

  it("throws WindowClosedError for free-form replies without calling Meta, but sends templates", async () => {
    graph.server.use(acceptSends());
    const client = await setup();
    await client.adapter.templates.upsertMany(client.accountA.id, [approvedTemplate()]);
    const { conversation } = await seedConversation(client, client.accountA, {
      phone: "+50255550001",
      minutesAgo: 25 * 60,
    });
    const opts = { userId: "user-1" };

    await expect(
      client.wa.inbox.reply(conversation.id, { kind: "text", body: "tarde" }, opts),
    ).rejects.toBeInstanceOf(WindowClosedError);
    await expect(
      client.wa.inbox.reply(
        conversation.id,
        { kind: "media", mediaType: "image", url: "https://cdn.example.com/a.jpg" },
        opts,
      ),
    ).rejects.toBeInstanceOf(WindowClosedError);
    expect(graph.requests).toHaveLength(0);
    expect((await client.wa.inbox.thread(conversation.id)).items).toHaveLength(0);

    await expect(
      client.wa.inbox.reply(
        conversation.id,
        { kind: "template", name: "seguimiento", language: "es" },
        opts,
      ),
    ).resolves.toMatchObject({ type: "template", sender: "human", senderRef: "user-1" });
    expect(graph.requests).toHaveLength(1);
  });

  it("validates templates before calling Meta", async () => {
    graph.server.use(acceptSends());
    const client = await setup();
    await client.adapter.templates.upsertMany(client.accountA.id, [approvedTemplate(2)]);
    const { conversation } = await seedConversation(client, client.accountA, {
      phone: "+50255550001",
    });
    const opts = { userId: "user-1" };

    await expect(
      client.wa.inbox.reply(
        conversation.id,
        { kind: "template", name: "no_existe", language: "es" },
        opts,
      ),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
    await expect(
      client.wa.inbox.reply(
        conversation.id,
        { kind: "template", name: "seguimiento", language: "es", variables: ["Ana"] },
        opts,
      ),
    ).rejects.toBeInstanceOf(TemplateVariablesError);
    expect(graph.requests).toHaveLength(0);
  });

  it("requires a userId and a conversation of the given tenant", async () => {
    graph.server.use(acceptSends());
    const client = await setup();
    const { conversation } = await seedConversation(client, client.accountB, {
      phone: "+50255550001",
    });
    await expect(
      client.wa.inbox.reply(conversation.id, { kind: "text", body: "x" }, { userId: " " }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD", field: "userId" });
    await expect(
      client.wa.inbox.reply(
        conversation.id,
        { kind: "text", body: "x" },
        { userId: "user-1", tenantId: "tenant-a" },
      ),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(graph.requests).toHaveLength(0);
  });
});

describe("wa.inbox.markSeen", () => {
  it("resets unreadCount and returns the conversation", async () => {
    const client = await setup();
    const { conversation } = await seedConversation(client, client.accountA, {
      phone: "+50255550001",
    });
    await client.adapter.conversations.update(conversation.id, { incrementUnread: 3 });

    const seen = await client.wa.inbox.markSeen(conversation.id);

    expect(seen).toMatchObject({ id: conversation.id, unreadCount: 0 });
    const [item] = (await client.wa.inbox.list({ tenantId: "tenant-a" })).items;
    expect(item?.unreadCount).toBe(0);
  });

  it("does not touch conversations of another tenant", async () => {
    const client = await setup();
    const { conversation } = await seedConversation(client, client.accountB, {
      phone: "+50255550001",
    });
    await expect(
      client.wa.inbox.markSeen(conversation.id, { tenantId: "tenant-a" }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    expect((await client.adapter.conversations.get(conversation.id))?.unreadCount).toBe(1);
  });
});
