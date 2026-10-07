import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  FIXTURE_IDS,
  loadWebhookFixture,
  webhookFixtureNames,
  webhookFixturePath,
  type WebhookFixtureName,
} from "../../test/support/fixtures";
import { messageText, parseInboundMessage, parseWebhook, toContent } from "./parse";
import { inboundMessageSchema, parsedChangeSchema, type InboundMessage } from "./schemas";

const parseFixture = (name: WebhookFixtureName) => parseWebhook(loadWebhookFixture(name));

function singleMessage(name: WebhookFixtureName): InboundMessage {
  const [change] = parseFixture(name);
  expect(change?.messages).toHaveLength(1);
  const message = change?.messages[0];
  if (!message) throw new Error(`fixture ${name} has no message`);
  return message;
}

const rawMessage = (overrides: Record<string, unknown>) => ({
  from: FIXTURE_IDS.waId,
  id: "wamid.RAW",
  timestamp: "1791288000",
  ...overrides,
});

describe("fixtures", () => {
  it("lists every fixture file on disk", () => {
    const onDisk = readdirSync(dirname(webhookFixturePath("text")))
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(/\.json$/, ""))
      .sort();
    expect([...webhookFixtureNames].sort()).toEqual(onDisk);
  });

  it.each(webhookFixtureNames)("%s parses into a valid ParsedChange[]", (name) => {
    const changes = parseFixture(name);
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) expect(parsedChangeSchema.parse(change)).toEqual(change);
  });
});

describe("parseWebhook: change metadata", () => {
  it("extracts account metadata and contacts", () => {
    expect(parseFixture("text")).toEqual([
      expect.objectContaining({
        wabaId: FIXTURE_IDS.wabaId,
        phoneNumberId: FIXTURE_IDS.phoneNumberId,
        displayPhone: FIXTURE_IDS.displayPhone,
        contacts: [{ waId: FIXTURE_IDS.waId, profileName: FIXTURE_IDS.profileName }],
        statuses: [],
        errors: [],
      }),
    ]);
  });

  it("flattens multi-entry and multi-change payloads in order", () => {
    const changes = parseFixture("multi-entry");
    expect(changes.map((change) => change.phoneNumberId)).toEqual([
      FIXTURE_IDS.phoneNumberId,
      FIXTURE_IDS.phoneNumberId,
      FIXTURE_IDS.secondPhoneNumberId,
    ]);
    expect(changes[0]?.messages.map((message) => message.metaMessageId)).toEqual([
      "wamid.MULTI001",
      "wamid.MULTI002",
    ]);
    expect(changes[1]?.statuses.map((status) => status.status)).toEqual(["delivered"]);
    expect(changes[2]).toMatchObject({
      wabaId: FIXTURE_IDS.secondWabaId,
      contacts: [{ waId: FIXTURE_IDS.secondWaId, profileName: "Carlos López" }],
    });
  });

  it("keeps the phone_number_id of an unrouted payload (routing is the pipeline's job)", () => {
    expect(parseFixture("unrouted-phone-number")[0]?.phoneNumberId).toBe(
      FIXTURE_IDS.unroutedPhoneNumberId,
    );
  });

  it("skips changes for fields other than messages", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: FIXTURE_IDS.wabaId,
          changes: [
            {
              field: "message_template_status_update",
              value: { event: "APPROVED", message_template_name: "cita" },
            },
          ],
        },
      ],
    };
    expect(parseWebhook(payload)).toEqual([]);
  });

  it("keeps value-level errors", () => {
    const payload = loadWebhookFixture("status-sent");
    const value = {
      ...(payload.entry[0]?.changes[0]?.value as object),
      errors: [{ code: 131000 }],
    };
    const changes = parseWebhook({
      ...payload,
      entry: [{ id: FIXTURE_IDS.wabaId, changes: [{ field: "messages", value }] }],
    });
    expect(changes[0]?.errors).toEqual([{ code: 131000 }]);
  });

  it.each([
    ["null", null],
    ["wrong object", { object: "page", entry: [] }],
    ["missing entry", { object: "whatsapp_business_account" }],
    [
      "missing metadata",
      {
        object: "whatsapp_business_account",
        entry: [
          { id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp" } }] },
        ],
      },
    ],
  ])("throws a ZodError for a malformed envelope (%s)", (_label, payload) => {
    expect(() => parseWebhook(payload)).toThrow(ZodError);
  });
});

describe("parseWebhook: inbound message types", () => {
  const common = {
    from: FIXTURE_IDS.waId,
    timestamp: FIXTURE_IDS.timestamp,
  };

  it("text", () => {
    expect(singleMessage("text")).toEqual({
      ...common,
      metaMessageId: "wamid.TEXT0001",
      type: "text",
      body: "Hola, quisiera agendar una cita",
    });
  });

  it("text with reply context and forwarded flag", () => {
    expect(singleMessage("text-reply")).toMatchObject({
      type: "text",
      context: {
        replyToMetaId: FIXTURE_IDS.outboundMetaId,
        replyToFrom: FIXTURE_IDS.displayPhone,
        forwarded: true,
      },
    });
  });

  it("image", () => {
    expect(singleMessage("image")).toMatchObject({
      type: "image",
      mediaId: "300000000000001",
      mimeType: "image/jpeg",
      caption: "Mi receta",
      sha256: expect.any(String) as string,
    });
  });

  it("audio (voice note)", () => {
    expect(singleMessage("audio-voice")).toMatchObject({
      type: "audio",
      mediaId: "300000000000002",
      mimeType: "audio/ogg; codecs=opus",
      voice: true,
    });
  });

  it("video", () => {
    expect(singleMessage("video")).toMatchObject({
      type: "video",
      mediaId: "300000000000003",
      caption: "Así se ve",
    });
  });

  it("document", () => {
    expect(singleMessage("document")).toMatchObject({
      type: "document",
      mediaId: "300000000000004",
      mimeType: "application/pdf",
      filename: "resultados.pdf",
      caption: "Resultados",
    });
  });

  it("sticker", () => {
    expect(singleMessage("sticker")).toMatchObject({
      type: "sticker",
      mimeType: "image/webp",
      animated: false,
    });
  });

  it("location", () => {
    expect(singleMessage("location")).toMatchObject({
      type: "location",
      latitude: 14.6349,
      longitude: -90.5069,
      name: "Clínica Central",
      address: "6a Avenida 10-20, Zona 1, Guatemala",
    });
  });

  it("contacts", () => {
    expect(singleMessage("contacts")).toMatchObject({
      type: "contacts",
      contacts: [
        {
          formattedName: "Luis García",
          firstName: "Luis",
          lastName: "García",
          phones: [{ phone: "+502 5555 0003", waId: "50255550003", type: "CELL" }],
          emails: [{ email: "luis@example.com", type: "WORK" }],
          organization: "Ejemplo S.A.",
        },
      ],
    });
  });

  it("reaction", () => {
    expect(singleMessage("reaction")).toMatchObject({
      type: "reaction",
      emoji: "\u{1F44D}",
      targetMetaId: FIXTURE_IDS.outboundMetaId,
    });
  });

  it("reaction removal has a null emoji", () => {
    const message = parseInboundMessage(
      rawMessage({ type: "reaction", reaction: { message_id: "wamid.X" } }),
    );
    expect(message).toMatchObject({ type: "reaction", emoji: null, targetMetaId: "wamid.X" });
  });

  it("interactive button reply", () => {
    expect(singleMessage("interactive-button-reply")).toMatchObject({
      type: "interactive",
      reply: { type: "button_reply", id: "confirm_yes", title: "Confirmar" },
      context: { replyToMetaId: "wamid.OUT00002" },
    });
  });

  it("interactive list reply", () => {
    expect(singleMessage("interactive-list-reply")).toMatchObject({
      type: "interactive",
      reply: {
        type: "list_reply",
        id: "slot_0900",
        title: "9:00 am",
        description: "Lunes 12 de octubre",
      },
    });
  });

  it("template quick-reply button", () => {
    expect(singleMessage("template-button")).toMatchObject({
      type: "button",
      text: "Confirmar cita",
      payload: "CONFIRMAR_CITA",
      context: { replyToMetaId: "wamid.OUT00004" },
    });
  });

  it("every parsed message satisfies the InboundMessage schema", () => {
    for (const name of webhookFixtureNames) {
      for (const change of parseFixture(name)) {
        for (const message of change.messages)
          expect(inboundMessageSchema.safeParse(message).success).toBe(true);
      }
    }
  });
});

describe("parseWebhook: unsupported messages", () => {
  it("maps Meta's unsupported type and unknown types to unsupported with raw kept", () => {
    const [change] = parseFixture("unknown-type");
    const [metaUnsupported, order] = change?.messages ?? [];
    expect(metaUnsupported).toMatchObject({
      type: "unsupported",
      originalType: "unsupported",
      metaMessageId: "wamid.UNSUP001",
      errors: [
        {
          code: 131051,
          title: "Message type unknown",
          message: "Message type unknown",
          details: "Message type is currently not supported.",
        },
      ],
    });
    expect(order).toMatchObject({ type: "unsupported", originalType: "order" });
    expect(order?.type === "unsupported" && order.raw).toMatchObject({
      order: { catalog_id: "400000000000001" },
    });
  });

  it.each([
    ["known type with malformed content", { type: "image", image: { caption: "no id" } }],
    ["known type with missing content", { type: "text" }],
    [
      "interactive subtype not in V1",
      { type: "interactive", interactive: { type: "nfm_reply", nfm_reply: {} } },
    ],
    ["future type", { type: "hologram", hologram: { id: "1" } }],
  ])("does not throw for %s", (_label, overrides) => {
    const raw = rawMessage(overrides);
    expect(parseInboundMessage(raw)).toMatchObject({
      type: "unsupported",
      originalType: overrides.type,
      raw,
    });
  });
});

describe("parseWebhook: statuses", () => {
  const statusOf = (name: WebhookFixtureName) => {
    const status = parseFixture(name)[0]?.statuses[0];
    if (!status) throw new Error(`fixture ${name} has no status`);
    return status;
  };

  it.each(["sent", "delivered", "read"] as const)("%s", (status) => {
    expect(statusOf(`status-${status}`)).toMatchObject({
      metaMessageId: FIXTURE_IDS.outboundMetaId,
      status,
      timestamp: FIXTURE_IDS.timestamp,
      recipientId: FIXTURE_IDS.waId,
      pricing: { billable: true, pricingModel: "PMP", category: "service" },
    });
  });

  it("sent includes conversation expiry", () => {
    expect(statusOf("status-sent").conversation).toEqual({
      id: "c0nv0000000000000000000000000001",
      originType: "service",
      expiresAt: new Date("2026-10-07T12:00:00.000Z"),
    });
  });

  it("failed with errors", () => {
    const status = statusOf("status-failed");
    expect(status.status).toBe("failed");
    expect(status.errors).toEqual([
      {
        code: 131047,
        title: "Re-engagement message",
        message: "Re-engagement message",
        details: expect.stringContaining("24 hours") as string,
      },
    ]);
  });

  it("drops statuses outside the delivery status set", () => {
    const payload = loadWebhookFixture("status-read");
    const json = JSON.parse(
      JSON.stringify(payload).replace('"status":"read"', '"status":"deleted"'),
    ) as unknown;
    expect(parseWebhook(json)[0]?.statuses).toEqual([]);
  });
});

describe("messageText", () => {
  it.each([
    ["text", "Hola, quisiera agendar una cita"],
    ["image", "Mi receta"],
    ["audio-voice", null],
    ["document", "Resultados"],
    ["location", "Clínica Central"],
    ["contacts", "Luis García"],
    ["reaction", "\u{1F44D}"],
    ["interactive-list-reply", "9:00 am"],
    ["template-button", "Confirmar cita"],
    ["sticker", null],
  ] as const)("%s → %s", (name, expected) => {
    expect(messageText(singleMessage(name))).toBe(expected);
  });
});

describe("toContent", () => {
  it("drops envelope fields and is JSON-safe", () => {
    const content = toContent(singleMessage("text-reply"));
    expect(content).toEqual({
      body: "Sí, a las 3 pm",
      context: {
        replyToMetaId: FIXTURE_IDS.outboundMetaId,
        replyToFrom: FIXTURE_IDS.displayPhone,
        forwarded: true,
      },
    });
    expect(JSON.parse(JSON.stringify(content))).toEqual(content);
  });
});
