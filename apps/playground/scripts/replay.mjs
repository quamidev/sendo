#!/usr/bin/env node
// Posts a signed webhook fixture from packages/sendo/test/fixtures/webhooks/ to the
// playground's /api/sendo/webhook, the way Meta would.
//
//   pnpm --filter playground replay <fixture> [--text "..."] [--fresh] [--raw] [--url <url>]
//
// --text   replaces the body of a text message (e.g. --text "quiero hablar con una persona")
// --fresh  gives every message a new id, so a replay is not dropped as a duplicate
// --raw    sends the fixture untouched (by default timestamps become "now" so the
//          24-hour window is open and the agent can answer)
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = join(appDir, "../../packages/sendo/test/fixtures/webhooks");

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined && match[2] !== "") {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvFile(join(appDir, ".env.local"));
loadEnvFile(join(appDir, ".env"));

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    text: { type: "string" },
    fresh: { type: "boolean", default: false },
    raw: { type: "boolean", default: false },
    url: {
      type: "string",
      default: process.env.SENDO_PLAYGROUND_URL ?? "http://localhost:3000/api/sendo/webhook",
    },
    secret: {
      type: "string",
      default: process.env.SENDO_META_APP_SECRET || "playground-app-secret",
    },
  },
});

const available = readdirSync(fixturesDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.replace(/\.json$/, ""))
  .sort();
const name = positionals[0];
if (!name || !available.includes(name)) {
  console.error(
    `Usage: pnpm --filter playground replay <fixture> [--text "..."] [--fresh] [--raw]`,
  );
  console.error(`Fixtures: ${available.join(", ")}`);
  process.exit(name ? 1 : 0);
}

let body = readFileSync(join(fixturesDir, `${name}.json`), "utf8");
if (!values.raw || values.text !== undefined || values.fresh) {
  const payload = JSON.parse(body);
  const now = String(Math.floor(Date.now() / 1000));
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const message of value.messages ?? []) {
        if (!values.raw) message.timestamp = now;
        if (values.fresh) message.id = `wamid.REPLAY.${randomUUID()}`;
        if (values.text !== undefined && message.type === "text") message.text.body = values.text;
      }
      for (const status of value.statuses ?? []) {
        if (!values.raw) status.timestamp = now;
      }
    }
  }
  body = JSON.stringify(payload);
}

const signature = `sha256=${createHmac("sha256", values.secret).update(body, "utf8").digest("hex")}`;
try {
  const response = await fetch(values.url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    body,
  });
  console.log(`${name} → ${values.url}: ${response.status} ${await response.text()}`);
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error(
    `Could not reach ${values.url}. Is the playground running (pnpm --filter playground dev)?`,
  );
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
