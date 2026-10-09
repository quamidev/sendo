import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MetaWebhookPayload } from "../../src/webhook";

export const webhookFixtureNames = [
  "text",
  "text-reply",
  "image",
  "audio-voice",
  "video",
  "document",
  "location",
  "sticker",
  "contacts",
  "reaction",
  "interactive-button-reply",
  "interactive-list-reply",
  "template-button",
  "unknown-type",
  "status-sent",
  "status-delivered",
  "status-read",
  "status-failed",
  "multi-entry",
  "unrouted-phone-number",
  "instagram-message",
] as const;

export type WebhookFixtureName = (typeof webhookFixtureNames)[number];

/** Anonymized identifiers used across the fixtures. */
export const FIXTURE_IDS = {
  wabaId: "200000000000001",
  phoneNumberId: "100000000000001",
  displayPhone: "15550001111",
  secondWabaId: "200000000000002",
  secondPhoneNumberId: "100000000000002",
  secondDisplayPhone: "15550002222",
  unroutedPhoneNumberId: "999999999999999",
  waId: "50255550001",
  secondWaId: "50255550002",
  profileName: "Ana Pérez",
  /** Meta ID of the outbound message referenced by status, reaction and reply fixtures. */
  outboundMetaId: "wamid.OUT00001",
  timestamp: new Date("2026-10-06T12:00:00.000Z"),
} as const;

export function webhookFixturePath(name: WebhookFixtureName): string {
  return fileURLToPath(new URL(`../fixtures/webhooks/${name}.json`, import.meta.url));
}

/** Raw JSON text, exactly as stored on disk (use it when signing). */
export function loadWebhookFixtureText(name: WebhookFixtureName): string {
  return readFileSync(webhookFixturePath(name), "utf8");
}

export function loadWebhookFixture(name: WebhookFixtureName): MetaWebhookPayload {
  return JSON.parse(loadWebhookFixtureText(name)) as MetaWebhookPayload;
}
