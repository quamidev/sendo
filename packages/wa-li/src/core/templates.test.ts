import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../adapters/memory";
import { NotImplementedError } from "../errors/errors";
import { quamiCloud } from "../transport/quami-cloud";
import { createWhatsApp } from "./create-whatsapp";
import { countTemplateVariables, renderTemplateBody } from "./services/templates";
import { accountInput, GRAPH, makeClient, useGraphServer } from "./test-utils";

const graph = useGraphServer();

const metaTemplates = (wabaId: string) => [
  {
    id: `${wabaId}-1`,
    name: "cita_recordatorio",
    language: "es",
    status: "APPROVED",
    category: "UTILITY",
    components: [
      { type: "HEADER", format: "TEXT", text: "Recordatorio {{1}}" },
      { type: "BODY", text: "Hola {{1}}, tu cita es el {{2}} a las {{2}}." },
    ],
  },
  {
    id: `${wabaId}-2`,
    name: "bienvenida",
    language: "es",
    status: "PENDING",
    category: "MARKETING",
    parameter_format: "NAMED",
    components: [{ type: "BODY", text: "Hola {{first_name}} de {{ clinic }}" }],
  },
];

describe("template helpers", () => {
  it("counts distinct body placeholders, positional or named", () => {
    expect(countTemplateVariables([{ type: "BODY", text: "{{1}} {{2}} {{1}}" }])).toBe(2);
    expect(countTemplateVariables([{ type: "body", text: "{{name}} {{ city }}" }])).toBe(2);
    expect(countTemplateVariables([{ type: "HEADER", text: "{{1}}" }])).toBe(0);
    expect(countTemplateVariables([])).toBe(0);
  });

  it("renders the body with array or record variables", () => {
    const components = [{ type: "BODY", text: "Hola {{1}}, {{2}}" }];
    expect(renderTemplateBody(components, ["Ana", "bienvenida"])).toBe("Hola Ana, bienvenida");
    expect(renderTemplateBody([{ type: "BODY", text: "Hi {{name}}" }], { name: "Bo" })).toBe(
      "Hi Bo",
    );
    expect(renderTemplateBody(components, undefined)).toBe("Hola {{1}}, {{2}}");
  });
});

describe("wa.templates", () => {
  it("syncs templates from Meta with variableCount and marks missing ones inactive", async () => {
    const auth: (string | null)[] = [];
    graph.server.use(
      http.get(`${GRAPH}/WABA_A/message_templates`, ({ request }) => {
        auth.push(request.headers.get("authorization"));
        return HttpResponse.json({ data: metaTemplates("WABA_A") });
      }),
    );
    const { wa, adapter } = makeClient();
    const account = await adapter.accounts.insert(accountInput());
    await adapter.templates.upsertMany(account.id, [
      {
        name: "old",
        language: "es",
        category: "UTILITY",
        status: "APPROVED",
        components: [],
        variableCount: 0,
      },
    ]);

    const synced = await wa.templates.sync();
    expect(auth).toEqual(["Bearer token-account-a-secret"]);
    expect(synced.map((t) => [t.name, t.variableCount, t.status, t.active])).toEqual([
      ["cita_recordatorio", 2, "APPROVED", true],
      ["bienvenida", 2, "PENDING", true],
    ]);
    expect((await adapter.templates.get(account.id, "old", "es"))?.active).toBe(false);

    expect((await wa.templates.list()).map((t) => t.name).sort()).toEqual([
      "bienvenida",
      "cita_recordatorio",
    ]);
    expect((await wa.templates.list({ status: "APPROVED" })).map((t) => t.name)).toEqual([
      "cita_recordatorio",
    ]);
    expect(await wa.templates.list({ includeInactive: true })).toHaveLength(3);
  });

  it("syncs one account or all active accounts", async () => {
    graph.server.use(
      http.get(`${GRAPH}/:wabaId/message_templates`, ({ params }) =>
        HttpResponse.json({ data: metaTemplates(String(params.wabaId)).slice(0, 1) }),
      ),
    );
    const { wa, adapter } = makeClient();
    const a = await adapter.accounts.insert(accountInput());
    const b = await adapter.accounts.insert(
      accountInput({ phoneNumberId: "PN_B", wabaId: "WABA_B", tokenRef: "WA_TOKEN_B" }),
    );

    const onlyB = await wa.templates.sync({ account: "PN_B" });
    expect(onlyB.map((t) => t.accountId)).toEqual([b.id]);
    expect(graph.requests.map((r) => new URL(r.url).pathname)).toEqual([
      expect.stringContaining("/WABA_B/message_templates"),
    ]);

    const all = await wa.templates.sync();
    expect(all.map((t) => t.accountId).sort()).toEqual([a.id, b.id].sort());
    expect(await wa.templates.list({ account: a.id })).toHaveLength(1);
  });

  it("emits account.error when the token is invalid", async () => {
    graph.server.use(
      http.get(`${GRAPH}/WABA_A/message_templates`, () =>
        HttpResponse.json({ error: { code: 190, message: "expired" } }, { status: 401 }),
      ),
    );
    const { wa, adapter } = makeClient();
    await adapter.accounts.insert(accountInput());
    let emitted = 0;
    wa.on("account.error", () => {
      emitted++;
    });
    await expect(wa.templates.sync()).rejects.toMatchObject({ metaCode: 190 });
    expect(emitted).toBe(1);
  });

  it("needs a metaDirect transport to sync", async () => {
    const wa = createWhatsApp({ adapter: memoryAdapter(), transport: quamiCloud({ apiKey: "k" }) });
    await expect(wa.templates.sync()).rejects.toBeInstanceOf(NotImplementedError);
  });
});
