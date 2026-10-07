import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  AccountNotFoundError,
  AmbiguousAccountError,
  InvalidPhoneError,
  MediaTooLargeError,
  PayloadValidationError,
  RecordNotFoundError,
  TemplateNotFoundError,
  TemplateVariablesError,
  WindowClosedError,
} from "../errors/errors";
import { MetaApiError } from "../errors/meta-api-error";
import type { AccountErrorEvent } from "./events";
import {
  accountInput,
  acceptSends,
  GRAPH,
  makeClient,
  metaError,
  openConversation,
  useGraphServer,
} from "./test-utils";

const graph = useGraphServer();
const PHONE = "+50255550001";

async function setup(options: Parameters<typeof makeClient>[0] = {}) {
  const client = makeClient(options);
  const account = await client.adapter.accounts.insert(accountInput());
  return { ...client, account };
}

async function threadOf(
  adapter: Awaited<ReturnType<typeof setup>>["adapter"],
  conversationId: string,
) {
  return (await adapter.messages.thread(conversationId, { limit: 50 })).items;
}

describe("wa.send.text", () => {
  it("normalizes the number, stores a pending row and marks it sent", async () => {
    const bodies: unknown[] = [];
    graph.server.use(acceptSends(bodies));
    const { wa, ctx, account, adapter } = await setup({ defaultCountry: "GT" });
    const { conversation } = await openConversation(ctx, account);

    const message = await wa.send.text("5555-0001", "Hola", {
      previewUrl: true,
      replyTo: "wamid.IN",
    });

    expect(message).toMatchObject({
      conversationId: conversation.id,
      direction: "out",
      type: "text",
      text: "Hola",
      status: "sent",
      metaMessageId: "wamid.OUT1",
      sender: "system",
      replyToMetaId: "wamid.IN",
    });
    expect(bodies).toEqual([
      expect.objectContaining({
        to: PHONE,
        type: "text",
        text: { body: "Hola", preview_url: true },
        context: { message_id: "wamid.IN" },
      }),
    ]);
    expect(graph.requests[0]?.url).toBe(`${GRAPH}/PN_A/messages`);
    const stored = await adapter.messages.get(message.id);
    expect(stored?.status).toBe("sent");
  });

  it("throws InvalidPhoneError before anything else", async () => {
    const { wa } = await setup();
    await expect(wa.send.text("not a phone", "x")).rejects.toBeInstanceOf(InvalidPhoneError);
    expect(graph.requests).toHaveLength(0);
  });

  it("throws WindowClosedError without calling Meta or storing a message", async () => {
    graph.server.use(acceptSends());
    const { wa, ctx, account, adapter } = await setup();
    const { conversation } = await openConversation(ctx, account, PHONE, 24 * 60 + 1);

    const error = await wa.send.text(PHONE, "Hola").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WindowClosedError);
    expect((error as WindowClosedError).conversationId).toBe(conversation.id);
    expect(graph.requests).toHaveLength(0);
    expect(await threadOf(adapter, conversation.id)).toHaveLength(0);
  });

  it("treats a contact that never wrote as outside the window", async () => {
    const { wa } = await setup();
    await expect(wa.send.text("+50255559999", "Hola")).rejects.toBeInstanceOf(WindowClosedError);
    expect(graph.requests).toHaveLength(0);
  });

  it("marks the row failed and rethrows MetaApiError", async () => {
    graph.server.use(metaError(131000, 500, "Something went wrong"));
    const { wa, ctx, account, adapter } = await setup();
    const { conversation } = await openConversation(ctx, account);

    const error = await wa.send.text(PHONE, "Hola").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetaApiError);
    const [row] = await threadOf(adapter, conversation.id);
    expect(row).toMatchObject({
      status: "failed",
      metaMessageId: null,
      error: { code: 131000, fbtraceId: "TRACE", title: "OAuthException" },
    });
  });

  it("emits account.error on an invalid token (190) and never logs the token", async () => {
    graph.server.use(metaError(190, 401, "Invalid OAuth access token token-account-a-secret"));
    const { wa, ctx, account, adapter, logs } = await setup();
    const { conversation } = await openConversation(ctx, account);
    const events: AccountErrorEvent[] = [];
    wa.on("account.error", (event) => {
      events.push(event);
    });

    await expect(wa.send.text(PHONE, "Hola")).rejects.toMatchObject({ metaCode: 190 });
    expect(events).toHaveLength(1);
    expect(events[0]?.account.id).toBe(account.id);
    expect(events[0]?.error.isInvalidToken).toBe(true);
    const [row] = await threadOf(adapter, conversation.id);
    expect(JSON.stringify(row?.error)).not.toContain("token-account-a-secret");
    expect(JSON.stringify(logs.entries)).not.toContain("token-account-a-secret");
  });

  it("does not emit account.error for other Meta errors", async () => {
    graph.server.use(metaError(131047));
    const { wa, ctx, account } = await setup();
    await openConversation(ctx, account);
    let emitted = 0;
    wa.on("account.error", () => {
      emitted++;
    });
    await expect(wa.send.text(PHONE, "Hola")).rejects.toBeInstanceOf(MetaApiError);
    expect(emitted).toBe(0);
  });
});

describe("account resolution", () => {
  it("throws AccountNotFoundError when no account exists", async () => {
    const { wa } = makeClient();
    await expect(wa.send.text(PHONE, "x")).rejects.toBeInstanceOf(AccountNotFoundError);
  });

  it("requires `account` when several accounts are active", async () => {
    graph.server.use(acceptSends());
    const { wa, ctx, adapter, account } = await setup();
    const second = await adapter.accounts.insert(
      accountInput({ phoneNumberId: "PN_B", wabaId: "WABA_B", tokenRef: "WA_TOKEN_B" }),
    );
    const error = await wa.send.text(PHONE, "x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AmbiguousAccountError);
    expect((error as AmbiguousAccountError).candidates).toEqual([account.id, second.id]);

    await openConversation(ctx, second);
    const byPhoneNumberId = await wa.send.text(PHONE, "x", { account: "PN_B" });
    const byId = await wa.send.text(PHONE, "y", { account: second.id });
    const byObject = await wa.send.text(PHONE, "z", { account: second });
    expect(byPhoneNumberId.conversationId).toBe(byId.conversationId);
    expect(byObject.conversationId).toBe(byId.conversationId);
    expect(graph.requests.map((r) => r.url)).toEqual(
      Array.from({ length: 3 }, () => `${GRAPH}/PN_B/messages`),
    );
  });

  it("throws AccountNotFoundError for unknown or inactive accounts", async () => {
    const { wa, adapter } = await setup();
    const inactive = await adapter.accounts.insert(
      accountInput({ phoneNumberId: "PN_OFF", active: false }),
    );
    await expect(wa.send.text(PHONE, "x", { account: "PN_NOPE" })).rejects.toBeInstanceOf(
      AccountNotFoundError,
    );
    await expect(
      wa.send.text(PHONE, "x", { account: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
    await expect(wa.send.text(PHONE, "x", { account: inactive.id })).rejects.toBeInstanceOf(
      AccountNotFoundError,
    );
  });

  it("ignores inactive accounts when picking the default", async () => {
    graph.server.use(acceptSends());
    const { wa, ctx, adapter, account } = await setup();
    await adapter.accounts.insert(accountInput({ phoneNumberId: "PN_OFF", active: false }));
    await openConversation(ctx, account);
    await expect(wa.send.text(PHONE, "x")).resolves.toMatchObject({ status: "sent" });
  });
});

describe("wa.send.media", () => {
  it("sends a URL directly without uploading", async () => {
    const bodies: unknown[] = [];
    graph.server.use(acceptSends(bodies));
    const { wa, ctx, account } = await setup();
    await openConversation(ctx, account);
    const message = await wa.send.media(PHONE, {
      type: "image",
      url: "https://cdn.example.com/a.jpg",
      caption: "Mira",
    });
    expect(message).toMatchObject({ type: "image", text: "Mira", status: "sent" });
    expect(graph.requests.map((r) => r.url)).toEqual([`${GRAPH}/PN_A/messages`]);
    expect(bodies[0]).toMatchObject({
      type: "image",
      image: { link: "https://cdn.example.com/a.jpg", caption: "Mira" },
    });
  });

  it("uploads a file first, then sends its media id", async () => {
    const bodies: unknown[] = [];
    graph.server.use(
      http.post(`${GRAPH}/PN_A/media`, () => HttpResponse.json({ id: "MEDIA_UP_1" })),
      acceptSends(bodies),
    );
    const { wa, ctx, account, adapter } = await setup();
    await openConversation(ctx, account);
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" });
    const message = await wa.send.media(PHONE, { type: "document", file, filename: "receta.pdf" });

    expect(graph.requests.map((r) => r.url)).toEqual([
      `${GRAPH}/PN_A/media`,
      `${GRAPH}/PN_A/messages`,
    ]);
    expect(bodies[0]).toMatchObject({
      type: "document",
      document: { id: "MEDIA_UP_1", filename: "receta.pdf" },
    });
    const stored = await adapter.messages.get(message.id);
    expect(stored).toMatchObject({
      status: "sent",
      content: { filename: "receta.pdf", mimeType: "application/pdf", sizeBytes: 3 },
      metadata: { metaMediaId: "MEDIA_UP_1" },
    });
  });

  it("marks the row failed when the upload fails", async () => {
    graph.server.use(
      http.post(`${GRAPH}/PN_A/media`, () =>
        HttpResponse.json({ error: { code: 100, message: "bad file" } }, { status: 400 }),
      ),
    );
    const { wa, ctx, account, adapter } = await setup();
    const { conversation } = await openConversation(ctx, account);
    const file = new Blob([new Uint8Array([1])], { type: "image/png" });
    await expect(wa.send.media(PHONE, { type: "image", file })).rejects.toBeInstanceOf(
      MetaApiError,
    );
    expect(graph.requests).toHaveLength(1);
    expect((await threadOf(adapter, conversation.id))[0]?.status).toBe("failed");
  });

  it("rejects oversized files and missing MIME types before any call", async () => {
    const { wa, ctx, account, adapter } = await setup();
    const { conversation } = await openConversation(ctx, account);
    await expect(
      wa.send.media(PHONE, {
        type: "sticker",
        file: new Uint8Array(600 * 1024),
        mimeType: "image/webp",
      }),
    ).rejects.toBeInstanceOf(MediaTooLargeError);
    await expect(
      wa.send.media(PHONE, { type: "image", file: new Uint8Array(3) }),
    ).rejects.toBeInstanceOf(PayloadValidationError);
    await expect(
      wa.send.media(PHONE, { type: "image", url: "https://x.dev/a.png", file: new Uint8Array(3) }),
    ).rejects.toBeInstanceOf(PayloadValidationError);
    expect(graph.requests).toHaveLength(0);
    expect(await threadOf(adapter, conversation.id)).toHaveLength(0);
  });
});

describe("wa.send.buttons and wa.send.list", () => {
  it("sends interactive messages", async () => {
    const bodies: unknown[] = [];
    graph.server.use(acceptSends(bodies));
    const { wa, ctx, account } = await setup();
    await openConversation(ctx, account);
    const buttons = await wa.send.buttons(PHONE, {
      body: "¿Confirmas?",
      buttons: [
        { id: "yes", title: "Sí" },
        { id: "no", title: "No" },
      ],
    });
    const list = await wa.send.list(PHONE, {
      body: "Elige",
      button: "Ver",
      sections: [{ rows: [{ id: "a", title: "A" }] }],
    });
    expect(buttons).toMatchObject({ type: "interactive", text: "¿Confirmas?", status: "sent" });
    expect(buttons.content).toMatchObject({ type: "button" });
    expect(list.content).toMatchObject({ type: "list" });
    expect(bodies).toHaveLength(2);
  });

  it("rejects more than 3 buttons before calling Meta", async () => {
    const { wa, ctx, account } = await setup();
    await openConversation(ctx, account);
    const four = ["a", "b", "c", "d"].map((id) => ({ id, title: id }));
    await expect(wa.send.buttons(PHONE, { body: "x", buttons: four })).rejects.toBeInstanceOf(
      PayloadValidationError,
    );
    expect(graph.requests).toHaveLength(0);
  });
});

describe("wa.send.template", () => {
  async function withTemplate(status = "APPROVED") {
    const client = await setup();
    await client.adapter.templates.upsertMany(client.account.id, [
      {
        name: "cita_recordatorio",
        language: "es",
        category: "UTILITY",
        status,
        components: [{ type: "BODY", text: "Hola {{1}}, tu cita es el {{2}}." }],
        variableCount: 2,
      },
    ]);
    return client;
  }

  it("sends outside the window and stores the rendered body", async () => {
    const bodies: unknown[] = [];
    graph.server.use(acceptSends(bodies));
    const { wa } = await withTemplate();
    const message = await wa.send.template(PHONE, "cita_recordatorio", {
      language: "es",
      variables: ["Ana", "lunes"],
    });
    expect(message).toMatchObject({
      type: "template",
      status: "sent",
      text: "Hola Ana, tu cita es el lunes.",
      content: { name: "cita_recordatorio", language: "es", variables: ["Ana", "lunes"] },
    });
    expect(bodies[0]).toMatchObject({
      type: "template",
      template: {
        name: "cita_recordatorio",
        language: { code: "es" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Ana" },
              { type: "text", text: "lunes" },
            ],
          },
        ],
      },
    });
  });

  it.each([
    ["missing", "otra", "es", "missing"],
    ["wrong language", "cita_recordatorio", "en_US", "missing"],
  ])("throws TemplateNotFoundError (%s) before Meta", async (_case, name, language, reason) => {
    const { wa } = await withTemplate();
    const error = await wa.send
      .template(PHONE, name, { language, variables: ["a", "b"] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TemplateNotFoundError);
    expect((error as TemplateNotFoundError).reason).toBe(reason);
    expect(graph.requests).toHaveLength(0);
  });

  it("throws TemplateNotFoundError for templates that are not approved or inactive", async () => {
    const pending = await withTemplate("PENDING");
    await expect(
      pending.wa.send.template(PHONE, "cita_recordatorio", {
        language: "es",
        variables: ["a", "b"],
      }),
    ).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND", reason: "not_approved" });

    const inactive = await withTemplate();
    await inactive.adapter.templates.markInactiveExcept(inactive.account.id, []);
    await expect(
      inactive.wa.send.template(PHONE, "cita_recordatorio", {
        language: "es",
        variables: ["a", "b"],
      }),
    ).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND", reason: "inactive" });
    expect(graph.requests).toHaveLength(0);
  });

  it("throws TemplateVariablesError on a wrong variable count before Meta", async () => {
    const { wa } = await withTemplate();
    const error = await wa.send
      .template(PHONE, "cita_recordatorio", { language: "es", variables: ["Ana"] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TemplateVariablesError);
    expect(error).toMatchObject({ expected: 2, received: 1 });
    await expect(
      wa.send.template(PHONE, "cita_recordatorio", { language: "es" }),
    ).rejects.toBeInstanceOf(TemplateVariablesError);
    expect(graph.requests).toHaveLength(0);
  });
});

describe("wa.send.markRead", () => {
  it("marks an inbound message read by wa-li id or Meta id", async () => {
    const bodies: unknown[] = [];
    graph.server.use(acceptSends(bodies));
    const { wa, ctx, account, adapter } = await setup();
    const { conversation } = await openConversation(ctx, account);
    const inbound = await adapter.messages.insertInbound({
      tenantId: account.tenantId,
      conversationId: conversation.id,
      type: "text",
      content: { body: "hola" },
      text: "hola",
      metaMessageId: "wamid.IN1",
      sentAt: new Date(),
    });
    await wa.send.markRead(inbound?.id ?? "");
    await wa.send.markRead("wamid.IN1");
    expect(bodies).toEqual([
      expect.objectContaining({ status: "read", message_id: "wamid.IN1" }),
      expect.objectContaining({ status: "read", message_id: "wamid.IN1" }),
    ]);
  });

  it("throws RecordNotFoundError for unknown messages", async () => {
    const { wa } = await setup();
    await expect(wa.send.markRead("wamid.NOPE")).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(graph.requests).toHaveLength(0);
  });
});
