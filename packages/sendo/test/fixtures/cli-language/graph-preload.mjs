// `node --import` preload for the CLI language guard: answers every outgoing request of the spawned
// `sendo` process (Meta Graph, Sendo Connect, the webhook URL, Supabase REST) from the scenario in
// `SENDO_LANG_SCENARIO`. Anything else fails as a network error, so nothing leaves the machine.
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  PHONE_NUMBER_ID,
  SUPABASE_URL,
  VERIFIED_NAME,
  VERIFY_TOKEN,
  WEBHOOK_URL,
  currentScenario,
} from "./scenarios.mjs";

const scenario = currentScenario();
const graph = scenario.graph ?? {};
const GRAPH = "https://graph.facebook.com/:version";

function metaError(code) {
  return HttpResponse.json(
    {
      error: {
        code,
        message: `Error validating access token (code ${String(code)})`,
        type: "OAuthException",
        fbtrace_id: "TRACE",
      },
    },
    { status: code === 190 ? 401 : code === 2 ? 500 : 400 },
  );
}

function answer(spec, ok) {
  if (spec === undefined || spec === "ok" || spec === "red" || spec === "empty") return ok(spec);
  if (spec === "network") return HttpResponse.error();
  return metaError(spec);
}

function webhook(request) {
  const url = new URL(request.url);
  const mode = scenario.webhook ?? "echo";
  if (mode === "network") return HttpResponse.error();
  if (mode === "hello") return new HttpResponse("hello", { status: 200 });
  if (typeof mode === "number") return new HttpResponse("nope", { status: mode });
  if (url.searchParams.get("hub.verify_token") !== VERIFY_TOKEN) {
    return new HttpResponse("Forbidden", { status: 403 });
  }
  return new HttpResponse(url.searchParams.get("hub.challenge"), { status: 200 });
}

function supabaseRows(request) {
  const spec = scenario.supabase ?? { accounts: [] };
  if (spec.status !== undefined) {
    return HttpResponse.json({ message: "upstream error", code: "XX000" }, { status: spec.status });
  }
  const params = new URL(request.url).searchParams;
  let rows = spec.accounts ?? [];
  for (const [column, filter] of params) {
    if (column === "select" || column === "order" || column === "limit") continue;
    if (filter === "is.null") rows = rows.filter((row) => row[column] === null);
    else if (filter.startsWith("eq.")) {
      rows = rows.filter((row) => String(row[column]) === filter.slice(3));
    }
  }
  return HttpResponse.json(rows);
}

const server = setupServer(
  http.get(`${GRAPH}/:waba/subscribed_apps`, () =>
    answer(graph.subscribed, (spec) =>
      HttpResponse.json({
        data:
          spec === "empty"
            ? []
            : [{ whatsapp_business_api_data: { id: "999", name: "Mi App", link: "https://x" } }],
      }),
    ),
  ),
  http.get(`${GRAPH}/:waba/message_templates`, () =>
    answer(graph.templates, () =>
      HttpResponse.json({
        data: [
          { id: "1", name: "cita", language: "es", status: "APPROVED", category: "UTILITY" },
          { id: "2", name: "promo", language: "es", status: "PENDING", category: "MARKETING" },
        ],
      }),
    ),
  ),
  http.get(`${GRAPH}/:id`, ({ params }) =>
    answer(graph.phone, (spec) =>
      HttpResponse.json({
        id: params.id ?? PHONE_NUMBER_ID,
        display_phone_number: "+1 555-000-1111",
        verified_name: VERIFIED_NAME,
        quality_rating: spec === "red" ? "RED" : "GREEN",
        code_verification_status: "VERIFIED",
      }),
    ),
  ),
  http.get(WEBHOOK_URL, ({ request }) => webhook(request)),
  http.get("https://connect.sendo.quami.dev/v1/projects/current/webhook", () => {
    const connect = scenario.connect ?? {};
    if (connect.network === true) return HttpResponse.error();
    return HttpResponse.json(connect.body ?? {}, { status: connect.status ?? 200 });
  }),
  http.get(`${SUPABASE_URL}/rest/v1/sendo_accounts`, ({ request }) => supabaseRows(request)),
  http.all("*", () => HttpResponse.error()),
);

server.listen({ onUnhandledRequest: "bypass" });
