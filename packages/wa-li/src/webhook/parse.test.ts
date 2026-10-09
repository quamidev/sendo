import { describe, expect, it } from "vitest";
import {
  FIXTURE_IDS,
  loadWebhookFixture,
  type WebhookFixtureName,
} from "../../test/support/fixtures";
import { parseInboundMessage, parseWebhook } from "./parse";

const parseFixture = (name: WebhookFixtureName) => parseWebhook(loadWebhookFixture(name));

const rawMessage = (overrides: Record<string, unknown>) => ({
  from: FIXTURE_IDS.waId,
  id: "wamid.RAW",
  timestamp: "1791288000",
  ...overrides,
});

describe("parseWebhook: change metadata", () => {
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
});

describe("parseWebhook: inbound message types", () => {
  it("reaction removal has a null emoji", () => {
    const message = parseInboundMessage(
      rawMessage({ type: "reaction", reaction: { message_id: "wamid.X" } }),
    );
    expect(message).toMatchObject({ type: "reaction", emoji: null, targetMetaId: "wamid.X" });
  });
});

describe("parseWebhook: unsupported messages", () => {
  it.each([
    ["known type with malformed content", { type: "image", image: { caption: "no id" } }],
    ["known type with missing content", { type: "text" }],
    [
      "interactive subtype not in V1",
      { type: "interactive", interactive: { type: "nfm_reply", nfm_reply: {} } },
    ],
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
  it("drops statuses outside the delivery status set", () => {
    const payload = loadWebhookFixture("status-read");
    const json = JSON.parse(
      JSON.stringify(payload).replace('"status":"read"', '"status":"deleted"'),
    ) as unknown;
    expect(parseWebhook(json)[0]?.statuses).toEqual([]);
  });
});
