import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../adapters/memory";
import type { Contact, MessageWithMedia } from "../types/entities";
import {
  buildSystemPrompt,
  describeMessage,
  formatNow,
  handoffClause,
  toModelMessages,
} from "./prompt";

function message(overrides: Partial<MessageWithMedia> = {}): MessageWithMedia {
  return {
    id: crypto.randomUUID(),
    tenantId: null,
    conversationId: "c1",
    direction: "in",
    type: "text",
    content: {},
    text: "hola",
    metaMessageId: null,
    replyToMetaId: null,
    status: "received",
    error: null,
    sender: "contact",
    senderRef: null,
    metadata: {},
    sentAt: null,
    createdAt: new Date(),
    media: null,
    ...overrides,
  };
}

const contact: Contact = {
  id: "k1",
  tenantId: null,
  accountId: "a1",
  phone: "+50255550001",
  waId: "50255550001",
  profileName: null,
  appRef: "patient-7",
  marketingOptIn: false,
  optInAt: null,
};

describe("agent prompt", () => {
  it("describes media and other non-text messages", () => {
    expect(describeMessage(message({ type: "audio", text: null }))).toBe("[audio]");
    expect(
      describeMessage(
        message({ type: "document", text: "mi examen", content: { filename: "lab.pdf" } }),
      ),
    ).toBe("[documento: lab.pdf] mi examen");
    expect(
      describeMessage(
        message({
          type: "location",
          text: null,
          content: { latitude: 14.6, longitude: -90.5, name: "Clínica" },
        }),
      ),
    ).toBe("[ubicación: 14.6, -90.5] Clínica");
    expect(describeMessage(message({ type: "image", text: null }))).toBe("[imagen]");
    expect(describeMessage(message({ type: "reaction", text: "👍" }))).toBe("[reacción: 👍]");
  });

  it("builds the system prompt with the handoff clause, contact and date", () => {
    const system = buildSystemPrompt({
      instructions: "Atiende.",
      handoff: { when: "pide un humano", to: "admins" },
      contact,
      timezone: "America/Guatemala",
      now: new Date("2026-10-06T18:00:00Z"),
    });
    expect(system).toContain(handoffClause({ when: "pide un humano", to: "admins" }));
    expect(system).toContain("- Nombre: desconocido");
    expect(system).toContain("- ID en la aplicación: patient-7");
    expect(system).toContain("12:00");
    expect(system).toContain("(America/Guatemala)");
  });

  it("falls back to America/Guatemala for an invalid timezone", () => {
    expect(formatNow(new Date(), "Not/AZone").timezone).toBe("America/Guatemala");
  });

  it("describes an image as text when its file is missing", async () => {
    const result = await toModelMessages(
      memoryAdapter(),
      [
        message({
          type: "image",
          text: null,
          media: {
            id: "m1",
            tenantId: null,
            messageId: "x",
            metaMediaId: "M",
            mimeType: "image/jpeg",
            sizeBytes: 1,
            sha256: null,
            storagePath: "missing.jpg",
            downloadStatus: "done",
          },
        }),
      ],
      { vision: true },
    );
    expect(result).toEqual([{ role: "user", content: [{ type: "text", text: "[imagen]" }] }]);
  });
});
