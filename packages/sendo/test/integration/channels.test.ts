/**
 * Product spec — Acceptance Criteria — "Channels" (batch 1).
 *
 * [AC-CH-4] Parsing is organized per channel and the webhook dispatches on the body's `object`.
 *           An `object` with no channel (`instagram`, `page`, missing) is stored as an `unrouted`
 *           event, emits `event.unrouted`, still answers 200, writes nothing else, and can be
 *           replayed with `sendo.events.reprocess` without error. The signature is checked once
 *           for every Meta product, so an unsigned non-WhatsApp body is still a 401.
 */
import { describe, expect, it } from "vitest";
import type { UnroutedEvent } from "../../src/core/events";
import { useGraphServer } from "../../src/core/test-utils";
import { FIXTURE_IDS } from "../support/fixtures";
import { createHarness, freshFixture, signedPost } from "./harness";

useGraphServer();

async function setup() {
  const h = await createHarness();
  const unrouted: UnroutedEvent[] = [];
  h.sendo.on("event.unrouted", (e) => {
    unrouted.push(e);
  });
  const written = () => ({
    contacts: h.adapter.__state.contacts.size,
    conversations: h.adapter.__state.conversations.size,
    messages: h.adapter.__state.messages.size,
    media: h.adapter.__state.media.size,
  });
  return { ...h, unrouted, written };
}

const NOTHING = { contacts: 0, conversations: 0, messages: 0, media: 0 };

describe("Channels: webhook dispatch by object", () => {
  it("[AC-CH-4] a signed instagram body returns 200, is stored unrouted and writes nothing else", async () => {
    const h = await setup();
    const event = await h.deliver("instagram-message");

    expect(event.status).toBe("unrouted");
    expect(event.error).toBeNull();
    expect(event.payload).toMatchObject({ object: "instagram" });
    expect(h.unrouted).toEqual([
      { reason: "unknown_object", object: "instagram", phoneNumberId: null, raw: event.payload },
    ]);
    expect(h.written()).toEqual(NOTHING);
    expect(h.messageEvents).toHaveLength(0);
  });

  it("[AC-CH-4] the unrouted instagram event replays through events.reprocess without error", async () => {
    const h = await setup();
    const event = await h.deliver("instagram-message");

    const again = await h.sendo.events.reprocess(event.id);
    expect(again).toMatchObject({ id: event.id, status: "unrouted", error: null });
    expect(h.unrouted).toHaveLength(2);
    expect(h.written()).toEqual(NOTHING);
    expect(h.adapter.__state.events.size).toBe(1);
  });

  it.each([
    ["page", { object: "page", entry: [{ id: "1", time: 1791288000, messaging: [] }] }],
    ["missing", { entry: [] }],
    ["non-string", { object: 42, entry: [] }],
    ["array body", [{ object: "whatsapp_business_account" }]],
  ])("[AC-CH-4] object %s is unrouted with a 200", async (_label, body) => {
    const h = await setup();
    const event = await h.deliver(JSON.stringify(body));

    expect(event.status).toBe("unrouted");
    expect(h.unrouted).toHaveLength(1);
    expect(h.unrouted[0]).toMatchObject({ reason: "unknown_object", phoneNumberId: null });
    expect(h.written()).toEqual(NOTHING);
  });

  it("[AC-CH-4] an instagram body with a bad signature is a 401 and stores nothing", async () => {
    const h = await setup();
    const tasks: Promise<unknown>[] = [];
    const response = await h.sendo.handleWebhook(
      signedPost("instagram-message", "not-the-app-secret"),
      { waitUntil: (p) => tasks.push(p) },
    );

    expect(response.status).toBe(401);
    expect(tasks).toHaveLength(0);
    expect(h.adapter.__state.events.size).toBe(0);
    expect(h.unrouted).toHaveLength(0);
  });

  it("[AC-CH-4] whatsapp bodies still dispatch to the WhatsApp parser; unknown numbers keep their reason", async () => {
    const h = await setup();
    const routed = await h.deliver(freshFixture("text"));
    expect(routed.status).toBe("processed");
    expect(h.messages("in")).toHaveLength(1);

    const unknownNumber = await h.deliver("unrouted-phone-number");
    expect(unknownNumber.status).toBe("unrouted");
    expect(h.unrouted).toEqual([
      {
        reason: "unknown_account",
        object: "whatsapp_business_account",
        phoneNumberId: FIXTURE_IDS.unroutedPhoneNumberId,
        raw: unknownNumber.payload,
      },
    ]);
  });
});
