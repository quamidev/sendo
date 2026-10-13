/**
 * Product spec — Acceptance Criteria — "Messaging".
 *
 * [AC-MS-1] Every inbound message type listed in V1 parses into a typed, zod-validated object.
 *           Unknown types are stored as `unsupported` and don't crash processing.
 * [AC-MS-2] send.text / media / buttons / list / template return the stored message (with its Meta
 *           id) or throw a typed error (WindowClosedError, TemplateNotFoundError,
 *           TemplateVariablesError, MetaApiError with Meta's code).
 * [AC-MS-3] A free-form send outside the 24-hour window throws WindowClosedError before calling Meta.
 * [AC-MS-4] Statuses only move forward (pending → sent → delivered → read); a late `delivered`
 *           never overwrites `read`; `failed` records the error code and message. (Includes the
 *           status-before-send race.)
 * [AC-MS-5] Inbound media is in app storage within 10 s of receipt, and sendo_media holds its path,
 *           MIME type and size.
 * [AC-MS-6] Phone numbers are stored in E.164; send.* accepts common formats and normalizes them.
 */
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  GRAPH,
  acceptSends,
  metaError,
  openConversation,
  useGraphServer,
} from "../../src/core/test-utils";
import type { StatusEvent } from "../../src/core/events";
import {
  TemplateNotFoundError,
  TemplateVariablesError,
  WindowClosedError,
} from "../../src/errors/errors";
import { MetaApiError } from "../../src/errors/meta-api-error";
import type { MessageType } from "../../src/types/enums";
import { FIXTURE_IDS, type WebhookFixtureName } from "../support/fixtures";
import { FIXTURE_MEDIA, MEDIA_BYTES, createHarness, freshFixture, mediaHandlers } from "./harness";

const graph = useGraphServer();
const PHONE = `+${FIXTURE_IDS.waId}`;

/** Accepts sends and answers with the given Meta ids in order. */
function sendsWithIds(ids: string[], bodies: unknown[] = []) {
  let n = 0;
  return http.post(`${GRAPH}/:phoneNumberId/messages`, async ({ request }) => {
    bodies.push(await request.json());
    const id = ids[n++] ?? `wamid.EXTRA${String(n)}`;
    return HttpResponse.json({ messages: [{ id }] });
  });
}

const INBOUND_FIXTURES: [WebhookFixtureName, MessageType[]][] = [
  ["text", ["text"]],
  ["text-reply", ["text"]],
  ["image", ["image"]],
  ["audio-voice", ["audio"]],
  ["video", ["video"]],
  ["document", ["document"]],
  ["location", ["location"]],
  ["sticker", ["sticker"]],
  ["contacts", ["contacts"]],
  ["reaction", ["reaction"]],
  ["interactive-button-reply", ["interactive"]],
  ["interactive-list-reply", ["interactive"]],
  ["template-button", ["button"]],
  ["unknown-type", ["unsupported", "unsupported"]],
];

describe("Messaging", () => {
  it.each(INBOUND_FIXTURES)(
    "[AC-MS-1] the %s fixture is stored through the pipeline as %j",
    async (fixture, types) => {
      graph.server.use(...mediaHandlers());
      const h = await createHarness();
      const event = await h.deliver(fixture);

      expect(event.status).toBe("processed");
      const stored = h.messages("in");
      expect(stored.map((m) => m.type)).toEqual(types);
      for (const message of stored) {
        expect(message).toMatchObject({ direction: "in", sender: "contact", status: "received" });
        expect(message.metaMessageId).toMatch(/^wamid\./);
        expect(message.content).toBeTypeOf("object");
      }
      expect(h.messageEvents.map((e) => e.message.type)).toEqual(types);
      expect(h.messageEvents[0]?.contact.phone).toBe(PHONE);
    },
  );

  it("[AC-MS-1] keeps unsupported content, a reply context and typed interactive replies", async () => {
    const h = await createHarness();
    await h.deliver("unknown-type");
    await h.deliver("text-reply");
    await h.deliver("interactive-button-reply");
    const [unsupported, , reply, button] = h.messages("in");
    expect(unsupported?.content).toMatchObject({ originalType: expect.any(String) as string });
    expect(reply?.replyToMetaId).toBe("wamid.OUT00001");
    expect(button?.content).toMatchObject({ reply: { type: "button_reply" } });
  });

  describe("[AC-MS-2] send.* returns the stored message or a typed error", () => {
    async function withOpenConversationAndTemplate() {
      const h = await createHarness();
      await openConversation(h.ctx, h.account, PHONE);
      graph.server.use(
        http.get(`${GRAPH}/${FIXTURE_IDS.wabaId}/message_templates`, () =>
          HttpResponse.json({
            data: [
              {
                id: "T1",
                name: "recordatorio_cita",
                language: "es",
                status: "APPROVED",
                category: "UTILITY",
                components: [{ type: "BODY", text: "Hola {{1}}, tu cita es el {{2}}." }],
              },
            ],
          }),
        ),
      );
      await h.sendo.templates.sync();
      graph.requests.length = 0;
      return h;
    }

    it("[AC-MS-2] every send kind returns a stored message with its Meta id", async () => {
      graph.server.use(acceptSends());
      const h = await withOpenConversationAndTemplate();
      const sent = [
        await h.sendo.send.text(PHONE, "Hola"),
        await h.sendo.send.media(PHONE, { type: "image", url: "https://cdn.example/a.jpg" }),
        await h.sendo.send.buttons(PHONE, {
          body: "¿Confirmas?",
          buttons: [{ id: "si", title: "Sí" }],
        }),
        await h.sendo.send.list(PHONE, {
          body: "Elige",
          button: "Ver",
          sections: [{ rows: [{ id: "a", title: "A" }] }],
        }),
        await h.sendo.send.template(PHONE, "recordatorio_cita", {
          language: "es",
          variables: ["Ana", "lunes"],
        }),
      ];
      expect(sent.map((m) => [m.type, m.metaMessageId, m.status])).toEqual([
        ["text", "wamid.OUT1", "sent"],
        ["image", "wamid.OUT2", "sent"],
        ["interactive", "wamid.OUT3", "sent"],
        ["interactive", "wamid.OUT4", "sent"],
        ["template", "wamid.OUT5", "sent"],
      ]);
      for (const message of sent) {
        expect(await h.adapter.messages.get(message.id)).toMatchObject({
          id: message.id,
          metaMessageId: message.metaMessageId,
          direction: "out",
        });
      }
    });

    it("[AC-MS-2] template errors are typed and stop before Meta", async () => {
      const h = await withOpenConversationAndTemplate();
      await expect(
        h.sendo.send.template(PHONE, "no_existe", { language: "es" }),
      ).rejects.toBeInstanceOf(TemplateNotFoundError);
      await expect(
        h.sendo.send.template(PHONE, "recordatorio_cita", { language: "es", variables: ["Ana"] }),
      ).rejects.toBeInstanceOf(TemplateVariablesError);
      expect(graph.requests).toHaveLength(0);
    });

    it("[AC-MS-2] Meta errors surface as MetaApiError with Meta's code on every kind", async () => {
      graph.server.use(metaError(131026, 400, "Message undeliverable"));
      const h = await withOpenConversationAndTemplate();
      const attempts = [
        () => h.sendo.send.text(PHONE, "Hola"),
        () => h.sendo.send.media(PHONE, { type: "document", url: "https://cdn.example/a.pdf" }),
        () => h.sendo.send.buttons(PHONE, { body: "x", buttons: [{ id: "a", title: "A" }] }),
        () =>
          h.sendo.send.list(PHONE, {
            body: "x",
            button: "b",
            sections: [{ rows: [{ id: "a", title: "A" }] }],
          }),
        () =>
          h.sendo.send.template(PHONE, "recordatorio_cita", {
            language: "es",
            variables: ["a", "b"],
          }),
      ];
      for (const attempt of attempts) {
        const error = await attempt().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(MetaApiError);
        expect(error).toMatchObject({ code: "META_API_ERROR", metaCode: 131026 });
      }
      const failed = h.messages("out");
      expect(failed).toHaveLength(5);
      expect(failed.every((m) => m.status === "failed" && m.error?.code === 131026)).toBe(true);
    });
  });

  it("[AC-MS-3] free-form sends outside the window throw WindowClosedError with zero Meta calls", async () => {
    graph.server.use(acceptSends());
    const h = await createHarness();
    await openConversation(h.ctx, h.account, PHONE, 24 * 60 + 5);
    const attempts = [
      () => h.sendo.send.text(PHONE, "Hola"),
      () => h.sendo.send.media(PHONE, { type: "image", url: "https://cdn.example/a.jpg" }),
      () => h.sendo.send.buttons(PHONE, { body: "x", buttons: [{ id: "a", title: "A" }] }),
      () =>
        h.sendo.send.list(PHONE, {
          body: "x",
          button: "b",
          sections: [{ rows: [{ id: "a", title: "A" }] }],
        }),
      () => h.sendo.send.text("+50255557777", "Nunca escribió"),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toBeInstanceOf(WindowClosedError);
    }
    expect(graph.requests).toHaveLength(0);
    expect(h.messages("out")).toHaveLength(0);
  });

  it("[AC-MS-4] statuses move forward only, including a status that beats the send", async () => {
    graph.server.use(sendsWithIds([FIXTURE_IDS.outboundMetaId, "wamid.OUT00005"]));
    const h = await createHarness();
    const statuses: StatusEvent[] = [];
    h.sendo.on("status", (e) => {
      statuses.push(e);
    });
    await h.deliver(freshFixture("text"));

    // Race: Meta's `delivered` arrives before the send stored its Meta id.
    await h.deliver("status-delivered");
    expect(h.adapter.__state.placeholders.size).toBe(1);
    const message = await h.sendo.send.text(PHONE, "Tu cita es mañana");
    expect(message).toMatchObject({
      metaMessageId: FIXTURE_IDS.outboundMetaId,
      status: "delivered",
    });
    expect(h.adapter.__state.placeholders.size).toBe(0);

    await h.deliver("status-sent");
    expect((await h.adapter.messages.get(message.id))?.status).toBe("delivered");
    await h.deliver("status-read");
    await h.deliver("status-delivered");
    expect((await h.adapter.messages.get(message.id))?.status).toBe("read");
    expect(statuses.map((s) => s.status)).toEqual(["read"]);

    const second = await h.sendo.send.text(PHONE, "Otro aviso");
    await h.deliver("status-failed");
    expect(await h.adapter.messages.get(second.id)).toMatchObject({
      status: "failed",
      error: { code: 131047, message: "Re-engagement message" },
    });
    await h.deliver(
      freshFixture("status-read", (s) => s.replace(FIXTURE_IDS.outboundMetaId, "wamid.OUT00005")),
    );
    expect((await h.adapter.messages.get(second.id))?.status).toBe("failed");
  });

  it("[AC-MS-5] inbound media lands in storage within 10 s with path, MIME type and size", async () => {
    graph.server.use(...mediaHandlers());
    const h = await createHarness();
    const fixtures: WebhookFixtureName[] = ["image", "audio-voice", "video", "document", "sticker"];
    for (const fixture of fixtures) {
      const started = performance.now();
      await h.deliver(fixture);
      expect(performance.now() - started).toBeLessThan(10_000);
    }
    const media = [...h.adapter.__state.media.values()].sort((a, b) => a.seq - b.seq);
    expect(media).toHaveLength(5);
    for (const row of media) {
      expect(row).toMatchObject({ downloadStatus: "done", sizeBytes: MEDIA_BYTES.byteLength });
      expect(row.mimeType).toBe(FIXTURE_MEDIA[row.metaMediaId ?? ""]);
      expect(row.storagePath).toMatch(
        new RegExp(`^tenant-a/${h.account.id}/[^/]+/${row.metaMediaId ?? ""}\\.`),
      );
      expect(await h.adapter.storage.get(row.storagePath ?? "")).toEqual(MEDIA_BYTES);
    }
  });

  it("[AC-MS-6] send.* normalizes common phone formats to one E.164 contact", async () => {
    const bodies: unknown[] = [];
    graph.server.use(acceptSends(bodies));
    const h = await createHarness();
    const { contact } = await openConversation(h.ctx, h.account, "+50255551234");
    expect(contact.phone).toBe("+50255551234");

    const inputs = ["+502 5555-1234", "50255551234", "(502) 5555 1234"];
    for (const input of inputs) await h.sendo.send.text(input, `hola ${input}`);

    expect(bodies.map((b) => (b as { to: string }).to)).toEqual(inputs.map(() => "+50255551234"));
    const contacts = [...h.adapter.__state.contacts.values()];
    expect(contacts.map((c) => c.phone)).toEqual(["+50255551234"]);
    expect(new Set(h.messages("out").map((m) => m.conversationId)).size).toBe(1);

    await h.deliver(freshFixture("text"));
    expect([...h.adapter.__state.contacts.values()].map((c) => c.phone)).toContain(PHONE);
  });
});
