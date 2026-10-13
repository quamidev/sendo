/**
 * Product spec 4.4 "Broadcasts" (SND-4.2). End to end: broadcasts are created through
 * `sendo.broadcasts.*` with an admin actor, sent by `sendo.maintenance.tick()` (msw for Meta),
 * delivery results arrive as signed status webhooks through `sendo.handleWebhook`, and opt-outs
 * arrive as signed inbound messages.
 *
 * Ways it could fail (one test each):
 * [AC-BC-2a] A MARKETING broadcast reaches contacts without an explicit opt-in, or a
 *            UTILITY/AUTHENTICATION one skips contacts who never decided; skip reasons or the
 *            preview counts are wrong; preview writes contacts; invalid phones are not counted.
 * [AC-BC-2b] A non-APPROVED template, wrong variables, a bad rate, a non-admin or another tenant
 *            gets through.
 * [AC-BC-3a] The tick sends more than `ratePerMinute` per pass, sends without
 *            `metadata.broadcastId`, never finishes the broadcast, moves the conversation to
 *            `human` or runs the agent; replies don't land in the normal conversation.
 * [AC-BC-3b] Status webhooks don't reach recipients, or move them backwards (late `delivered`
 *            after `read`), or lose Meta's error on `failed`.
 * [AC-BC-3c] A rate limit (130429) marks recipients failed or keeps sending in the same pass.
 * [AC-BC-4]  `cancel` leaves pending recipients that a later tick sends.
 * [AC-BC-6]  131042 doesn't pause the broadcast or flag the account, loses the recipient, or the
 *            broadcast never resumes once billing is ready.
 * [AC-BC-5a] Opt-out keywords don't fold case/accents/whitespace, match inside sentences, skip
 *            the confirmation inside the window (or send it outside), run the agent, or don't
 *            stop a broadcast already queued for the contact.
 * [AC-BC-5b] Custom `optOut` config is ignored; `contacts.setOptIn` doesn't record the decision
 *            or emit `contact.opt_in`.
 */
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { scriptedModel, textResult, textWebhook } from "../../src/agents/test-helpers";
import type { ContactOptInEvent } from "../../src/broadcasts";
import { DEFAULT_OPT_OUT_CONFIRMATION } from "../../src/broadcasts";
import { GRAPH, burstWebhook, useGraphServer, type ClientOptions } from "../../src/core/test-utils";
import type { Actor } from "../../src/team/permissions";
import type { Contact } from "../../src/types/entities";
import { FIXTURE_IDS } from "../support/fixtures";
import { DAY_MS, createHarness } from "./harness";

const graph = useGraphServer();

type SendReply = "ok" | { code: number; status?: number };

/** Meta's /messages endpoint: answers each send from `script` (the last entry repeats). */
function metaSends(script: SendReply[] = ["ok"]) {
  const bodies: Record<string, unknown>[] = [];
  let n = 0;
  graph.server.use(
    http.post(`${GRAPH}/:phoneNumberId/messages`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const reply = script[Math.min(bodies.length, script.length - 1)] ?? "ok";
      bodies.push(body);
      if (reply === "ok") {
        n++;
        return HttpResponse.json({ messages: [{ id: `wamid.BC${String(n)}` }] });
      }
      return HttpResponse.json(
        { error: { code: reply.code, message: "Meta says no", type: "OAuthException" } },
        { status: reply.status ?? 400 },
      );
    }),
  );
  return {
    bodies,
    templates: () => bodies.filter((b) => b.type === "template"),
    texts: () => bodies.filter((b) => b.type === "text"),
    confirmations: () =>
      bodies.filter(
        (b) =>
          b.type === "text" && (b.text as { body?: string }).body === DEFAULT_OPT_OUT_CONFIRMATION,
      ),
  };
}

function statusWebhook(
  metaId: string,
  status: "sent" | "delivered" | "read" | "failed",
  error?: { code: number; title: string },
): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: FIXTURE_IDS.wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550001111",
                phone_number_id: FIXTURE_IDS.phoneNumberId,
              },
              statuses: [
                {
                  id: metaId,
                  status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: "50255550001",
                  ...(error && { errors: [{ ...error, message: error.title }] }),
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

const PROMO = "promo_octubre";
const NOTICE = "cobro_emitido";
const OTP = "codigo_acceso";

async function setup(options: ClientOptions = {}) {
  const model = scriptedModel(textResult("¡Hola! ¿En qué te ayudo?"));
  const h = await createHarness({
    handoffMessage: null,
    resolveRole: ({ userId }) =>
      Promise.resolve(userId.startsWith("admin") ? { role: "admin" } : { role: "agent" }),
    ...options,
  });
  h.sendo.agent({ name: "recepcion", model, instructions: "Eres la recepcionista." });
  await h.adapter.templates.upsertMany(h.account.id, [
    {
      name: PROMO,
      language: "es",
      category: "MARKETING",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Hola {{1}}, 20% de descuento este mes." }],
      variableCount: 1,
    },
    {
      name: NOTICE,
      language: "es",
      category: "UTILITY",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Tu cobro de noviembre fue emitido." }],
      variableCount: 0,
    },
    {
      name: OTP,
      language: "es",
      category: "AUTHENTICATION",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Tu código es {{1}}." }],
      variableCount: 1,
    },
    {
      name: "en_revision",
      language: "es",
      category: "UTILITY",
      status: "PENDING",
      components: [{ type: "BODY", text: "Hola" }],
      variableCount: 0,
    },
  ]);
  const admin = await h.sendo.actor("admin-1", "tenant-a");
  const optIns: ContactOptInEvent[] = [];
  h.sendo.on("contact.opt_in", (e) => void optIns.push(e));

  async function contact(phone: string): Promise<Contact> {
    const { contact } = await h.adapter.contacts.upsert({
      accountId: h.account.id,
      tenantId: h.account.tenantId,
      phone,
      waId: phone.slice(1),
    });
    return contact;
  }
  async function contactState(id: string) {
    const c = await h.adapter.contacts.get(id);
    if (!c) throw new Error("contact missing");
    return c;
  }
  async function recipientsOf(id: string, actor: Actor = admin) {
    const page = await h.sendo.broadcasts.recipients(id, { actor, limit: 100 });
    return Object.fromEntries(page.items.map((r) => [r.contact?.phone ?? r.contactId, r]));
  }
  return { ...h, model, admin, optIns, contact, contactState, recipientsOf };
}

describe("broadcasts", () => {
  it("[AC-BC-2a] eligibility per category, preview counts and skip reasons", async () => {
    const h = await setup();
    const optedIn = await h.contact("+50255550101");
    const neutral = await h.contact("+50255550102");
    const optedOut = await h.contact("+50255550103");
    await h.sendo.contacts.setOptIn(optedIn.id, true, { source: "form" });
    await h.sendo.contacts.setOptIn(optedOut.id, false);
    const recipients = [
      optedIn.id,
      { contactId: neutral.id },
      { phone: "+50255550103" }, // the opted-out contact again, by phone: counted once
      optedOut.id,
      { phone: "+502 5555 0104" }, // not stored yet
      { phone: "12" }, // invalid
    ];
    const contactsBefore = h.adapter.__state.contacts.size;

    const marketing = await h.sendo.broadcasts.preview({
      actor: h.admin,
      template: PROMO,
      language: "es",
      variables: ["Ana"],
      recipients,
    });
    expect(marketing).toMatchObject({
      total: 5,
      eligible: 1,
      skipped: { no_opt_in: 2, opted_out: 1, invalid_phone: 1 },
      category: "MARKETING",
      ratePerMinute: 60,
      estimatedMinutes: 1,
    });
    for (const [template, variables] of [
      [NOTICE, undefined],
      [OTP, ["123456"]],
    ] as const) {
      expect(
        await h.sendo.broadcasts.preview({
          actor: h.admin,
          template,
          language: "es",
          ...(variables && { variables: [...variables] }),
          recipients,
        }),
      ).toMatchObject({
        total: 5,
        eligible: 3,
        skipped: { no_opt_in: 0, opted_out: 1, invalid_phone: 1 },
      });
    }
    expect(h.adapter.__state.contacts.size).toBe(contactsBefore);

    const broadcast = await h.sendo.broadcasts.create({
      actor: h.admin,
      template: PROMO,
      language: "es",
      variables: ["Ana"],
      recipients,
    });
    expect(broadcast).toMatchObject({
      status: "queued",
      ratePerMinute: 60,
      category: "MARKETING",
      accountId: h.account.id,
      createdBy: "admin-1",
    });
    expect(h.adapter.__state.contacts.size).toBe(contactsBefore + 1);
    const view = await h.sendo.broadcasts.get(broadcast.id, { actor: h.admin });
    expect(view.counts).toMatchObject({ pending: 1, skipped: 3 });
    const rows = await h.recipientsOf(broadcast.id);
    expect(rows["+50255550101"]).toMatchObject({ status: "pending", skipReason: null });
    expect(rows["+50255550102"]).toMatchObject({ status: "skipped", skipReason: "no_opt_in" });
    expect(rows["+50255550103"]).toMatchObject({ status: "skipped", skipReason: "opted_out" });
    expect(rows["+50255550104"]).toMatchObject({ status: "skipped", skipReason: "no_opt_in" });
    expect((await h.sendo.broadcasts.list({ actor: h.admin })).items.map((b) => b.id)).toEqual([
      broadcast.id,
    ]);
  });

  it("[AC-BC-2b] only APPROVED templates, matching variables, admins and the own tenant", async () => {
    const h = await setup();
    const ana = await h.contact("+50255550101");
    const base = { actor: h.admin, language: "es", recipients: [ana.id] };
    await expect(
      h.sendo.broadcasts.create({ ...base, template: "en_revision" }),
    ).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND", reason: "not_approved" });
    await expect(
      h.sendo.broadcasts.preview({ ...base, template: "no_existe" }),
    ).rejects.toMatchObject({
      code: "TEMPLATE_NOT_FOUND",
      reason: "missing",
    });
    await expect(h.sendo.broadcasts.create({ ...base, template: PROMO })).rejects.toMatchObject({
      code: "TEMPLATE_VARIABLES",
      expected: 1,
      received: 0,
    });
    await expect(
      h.sendo.broadcasts.create({ ...base, template: NOTICE, ratePerMinute: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD", field: "ratePerMinute" });
    await expect(
      h.sendo.broadcasts.create({ ...base, template: NOTICE, recipients: [] }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD", field: "recipients" });

    const agent = await h.sendo.actor("agent-1", "tenant-a");
    await expect(
      h.sendo.broadcasts.create({ ...base, actor: agent, template: NOTICE }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", capability: "broadcasts.manage" });
    await expect(h.sendo.broadcasts.list({ actor: agent })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const broadcast = await h.sendo.broadcasts.create({ ...base, template: NOTICE });
    const other = await h.sendo.actor("admin-2", "tenant-b");
    await expect(h.sendo.broadcasts.get(broadcast.id, { actor: other })).rejects.toMatchObject({
      code: "RECORD_NOT_FOUND",
      entity: "broadcast",
    });
    await expect(h.sendo.broadcasts.cancel(broadcast.id, { actor: other })).rejects.toMatchObject({
      code: "RECORD_NOT_FOUND",
    });
    await expect(
      h.sendo.broadcasts.create({ ...base, actor: other, template: NOTICE }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
    expect((await h.sendo.broadcasts.list({ actor: other })).items).toEqual([]);
  });

  it("[AC-BC-3a] sends ratePerMinute per tick, finishes, never hands off or runs the agent; replies are normal", async () => {
    const h = await setup();
    const meta = metaSends();
    const phones = ["+50255550001", "+50255550102", "+50255550103"];
    const contacts = await Promise.all(phones.map((p) => h.contact(p)));
    const broadcast = await h.sendo.broadcasts.create({
      actor: h.admin,
      template: NOTICE,
      language: "es",
      recipients: contacts.map((c) => c.id),
      ratePerMinute: 2,
    });

    const first = await h.sendo.maintenance.tick();
    expect(first.steps.broadcasts).toEqual({ ran: true, count: 2, errors: 0 });
    expect(meta.templates()).toHaveLength(2);
    expect(meta.templates()[0]).toMatchObject({
      template: { name: NOTICE, language: { code: "es" } },
    });
    let view = await h.sendo.broadcasts.get(broadcast.id, { actor: h.admin });
    expect(view).toMatchObject({ status: "sending", counts: { sent: 2, pending: 1 } });
    expect(view.startedAt).toBeInstanceOf(Date);

    const second = await h.sendo.maintenance.tick();
    expect(second.steps.broadcasts.count).toBe(1);
    view = await h.sendo.broadcasts.get(broadcast.id, { actor: h.admin });
    expect(view).toMatchObject({ status: "done", counts: { sent: 3, pending: 0 } });
    expect(view.finishedAt).toBeInstanceOf(Date);
    expect((await h.sendo.maintenance.tick()).steps.broadcasts.count).toBe(0);
    expect(meta.templates()).toHaveLength(3);

    const sent = h.messages("out");
    expect(sent).toHaveLength(3);
    for (const message of sent) {
      expect(message).toMatchObject({
        type: "template",
        sender: "system",
        status: "sent",
        metadata: { broadcastId: broadcast.id },
      });
      const conversation = await h.adapter.conversations.get(message.conversationId);
      expect(conversation).toMatchObject({ status: "agent", everHuman: false });
    }
    expect(h.model.doGenerateCalls).toHaveLength(0);

    // The fixture contact (+50255550001) replies: same conversation, a normal agent turn.
    const anaConversations = [...h.adapter.__state.conversations.values()].filter(
      (c) => c.contactId === contacts[0]?.id,
    );
    expect(anaConversations).toHaveLength(1);
    await h.deliver(textWebhook({ id: "wamid.REPLY1", body: "¿Puedo pagar en efectivo?" }));
    const reply = await h.adapter.messages.getByMetaId("wamid.REPLY1");
    expect(reply?.conversationId).toBe(anaConversations[0]?.id);
    expect(await h.adapter.conversations.get(reply?.conversationId ?? "")).toMatchObject({
      status: "agent",
      everHuman: false,
    });
    expect(h.model.doGenerateCalls).toHaveLength(1);
  });

  it("[AC-BC-3b] status webhooks move recipients forward only and keep Meta's error", async () => {
    const h = await setup();
    metaSends();
    const [ana, beto] = await Promise.all([h.contact("+50255550101"), h.contact("+50255550102")]);
    const broadcast = await h.sendo.broadcasts.create({
      actor: h.admin,
      template: NOTICE,
      language: "es",
      recipients: [ana.id, beto.id],
    });
    await h.sendo.maintenance.tick();
    const rows = await h.recipientsOf(broadcast.id);
    const metaIdOf = async (phone: string) => {
      const id = rows[phone]?.messageId;
      return (await h.adapter.messages.get(id ?? ""))?.metaMessageId ?? "";
    };
    const anaMeta = await metaIdOf("+50255550101");
    const betoMeta = await metaIdOf("+50255550102");

    await h.deliver(statusWebhook(anaMeta, "delivered"));
    await h.deliver(statusWebhook(anaMeta, "read"));
    await h.deliver(statusWebhook(anaMeta, "delivered")); // late, out of order
    await h.deliver(
      statusWebhook(betoMeta, "failed", { code: 131026, title: "Message undeliverable" }),
    );

    const after = await h.recipientsOf(broadcast.id);
    expect(after["+50255550101"]).toMatchObject({ status: "read" });
    expect(after["+50255550102"]).toMatchObject({
      status: "failed",
      error: { code: 131026, title: "Message undeliverable" },
    });
    expect((await h.sendo.broadcasts.get(broadcast.id, { actor: h.admin })).counts).toMatchObject({
      read: 1,
      failed: 1,
      sent: 0,
      pending: 0,
    });
  });

  it("[AC-BC-3c] a rate limit (130429) stops the pass and leaves recipients pending", async () => {
    const h = await setup();
    const meta = metaSends(["ok", { code: 130429, status: 429 }]);
    const contacts = await Promise.all(
      ["+50255550101", "+50255550102", "+50255550103"].map((p) => h.contact(p)),
    );
    const broadcast = await h.sendo.broadcasts.create({
      actor: h.admin,
      template: NOTICE,
      language: "es",
      recipients: contacts.map((c) => c.id),
    });

    const first = await h.sendo.maintenance.tick();
    expect(first.steps.broadcasts).toEqual({ ran: true, count: 1, errors: 0 });
    expect(meta.bodies).toHaveLength(2); // the third recipient was not tried in this pass
    expect(await h.sendo.broadcasts.get(broadcast.id, { actor: h.admin })).toMatchObject({
      status: "sending",
      counts: { sent: 1, pending: 2, failed: 0 },
    });

    graph.server.resetHandlers();
    metaSends();
    expect((await h.sendo.maintenance.tick()).steps.broadcasts.count).toBe(2);
    expect(await h.sendo.broadcasts.get(broadcast.id, { actor: h.admin })).toMatchObject({
      status: "done",
      counts: { sent: 3, pending: 0, failed: 0 },
    });
  });

  it("[AC-BC-4] cancel turns pending recipients into cancelled and stops sending", async () => {
    const h = await setup();
    const meta = metaSends();
    const contacts = await Promise.all(
      ["+50255550101", "+50255550102", "+50255550103"].map((p) => h.contact(p)),
    );
    const broadcast = await h.sendo.broadcasts.create({
      actor: h.admin,
      template: NOTICE,
      language: "es",
      recipients: contacts.map((c) => c.id),
      ratePerMinute: 1,
    });
    await h.sendo.maintenance.tick();

    const cancelled = await h.sendo.broadcasts.cancel(broadcast.id, { actor: h.admin });
    expect(cancelled).toMatchObject({ status: "cancelled" });
    expect(cancelled.finishedAt).toBeInstanceOf(Date);
    expect((await h.sendo.broadcasts.get(broadcast.id, { actor: h.admin })).counts).toMatchObject({
      sent: 1,
      pending: 0,
      cancelled: 2,
    });
    expect((await h.sendo.maintenance.tick()).steps.broadcasts.count).toBe(0);
    expect(meta.templates()).toHaveLength(1);
    expect(await h.sendo.broadcasts.cancel(broadcast.id, { actor: h.admin })).toMatchObject({
      status: "cancelled",
    });
  });

  it("[AC-BC-6] 131042 pauses the broadcast, flags the number and resumes once billing is ready", async () => {
    const h = await setup();
    await h.adapter.accounts.update(h.account.id, { billingReady: true });
    const meta = metaSends([{ code: 131042 }]);
    const billing: boolean[] = [];
    h.sendo.on("account.billing", (e) => void billing.push(e.billingReady === true));
    const contacts = await Promise.all(["+50255550101", "+50255550102"].map((p) => h.contact(p)));
    const broadcast = await h.sendo.broadcasts.create({
      actor: h.admin,
      template: NOTICE,
      language: "es",
      recipients: contacts.map((c) => c.id),
    });

    await h.sendo.maintenance.tick({ budgetMs: 50_000 });
    expect(meta.bodies).toHaveLength(1);
    expect(await h.sendo.broadcasts.get(broadcast.id, { actor: h.admin })).toMatchObject({
      status: "paused",
      pauseReason: "billing",
      counts: { pending: 2, sent: 0, failed: 0 },
    });
    expect((await h.adapter.accounts.getById(h.account.id))?.billingReady).toBe(false);
    expect(billing).toEqual([false]);

    await h.sendo.maintenance.tick();
    expect(meta.bodies).toHaveLength(1);

    // Payment method added (refreshBilling would set this): the next tick resumes.
    graph.server.resetHandlers();
    const resumed = metaSends();
    await h.adapter.accounts.update(h.account.id, {
      billingReady: true,
      billingCheckedAt: new Date(),
    });
    expect((await h.sendo.maintenance.tick()).steps.broadcasts.count).toBe(2);
    expect(resumed.templates()).toHaveLength(2);
    expect(await h.sendo.broadcasts.get(broadcast.id, { actor: h.admin })).toMatchObject({
      status: "done",
      pauseReason: null,
      counts: { sent: 2, pending: 0 },
    });
  });

  it("[AC-BC-6] a 131042 failure reported by a status webhook also pauses the broadcast", async () => {
    const h = await setup();
    await h.adapter.accounts.update(h.account.id, { billingReady: true });
    metaSends();
    const contacts = await Promise.all(["+50255550101", "+50255550102"].map((p) => h.contact(p)));
    const broadcast = await h.sendo.broadcasts.create({
      actor: h.admin,
      template: NOTICE,
      language: "es",
      recipients: contacts.map((c) => c.id),
      ratePerMinute: 1,
    });
    await h.sendo.maintenance.tick();
    const [sent] = h.messages("out");
    await h.deliver(
      statusWebhook(sent?.metaMessageId ?? "", "failed", {
        code: 131042,
        title: "Business eligibility payment issue",
      }),
    );
    expect(await h.sendo.broadcasts.get(broadcast.id, { actor: h.admin })).toMatchObject({
      status: "paused",
      pauseReason: "billing",
      counts: { failed: 1, pending: 1 },
    });
    expect((await h.adapter.accounts.getById(h.account.id))?.billingReady).toBe(false);
  });

  it("[AC-BC-5a] opt-out keywords fold case, accents and spaces; confirm inside the window; skip the agent", async () => {
    const h = await setup();
    const meta = metaSends();
    const queued = await h.contact("+50255550202");
    await h.sendo.contacts.setOptIn(queued.id, true);
    const broadcast = await h.sendo.broadcasts.create({
      actor: h.admin,
      template: PROMO,
      language: "es",
      variables: ["Luis"],
      recipients: [queued.id],
    });
    h.optIns.length = 0;

    await h.deliver(
      burstWebhook([
        { id: "wamid.OPT1", body: "  Baja ", from: "50255550201" },
        { id: "wamid.OPT2", body: "cancelár", from: "50255550202" },
        { id: "wamid.OPT3", body: "quiero darme de baja", from: "50255550203" },
        { id: "wamid.OPT4", body: "S T O P", from: "50255550204" },
        { id: "wamid.OPT5", body: "Stop", from: "50255550205" },
      ]),
    );

    const byWaId = async (waId: string) =>
      h.contactState(
        [...h.adapter.__state.contacts.values()].find((c) => c.waId === waId)?.id ?? "",
      );
    for (const waId of ["50255550201", "50255550202", "50255550205"]) {
      const c = await byWaId(waId);
      expect(c.marketingOptIn).toBe(false);
      expect(c.optInAt).toBeInstanceOf(Date);
    }
    for (const waId of ["50255550203", "50255550204"]) {
      expect((await byWaId(waId)).optInAt).toBeNull();
    }
    expect(h.optIns.map((e) => [e.contact.waId, e.optIn, e.source, e.keyword])).toEqual([
      ["50255550201", false, "keyword", "baja"],
      ["50255550202", false, "keyword", "cancelar"],
      ["50255550205", false, "keyword", "stop"],
    ]);
    expect(h.optIns[1]?.previous).toMatchObject({ marketingOptIn: true });
    expect(meta.confirmations().map((b) => b.to)).toEqual(
      ["50255550201", "50255550202", "50255550205"].map((to): unknown =>
        expect.stringContaining(to),
      ),
    );
    // The agent answered only the two messages that weren't keywords.
    expect(h.model.doGenerateCalls).toHaveLength(2);
    expect((await h.adapter.messages.getByMetaId("wamid.OPT1"))?.metadata).toMatchObject({
      optOut: "baja",
      agentSkipped: "opt_out",
    });

    // The broadcast created before the opt-out skips the contact at send time.
    await h.sendo.maintenance.tick();
    expect(meta.templates()).toHaveLength(0);
    expect((await h.recipientsOf(broadcast.id))["+50255550202"]).toMatchObject({
      status: "skipped",
      skipReason: "opted_out",
    });

    // Outside the 24 h window: opted out, no confirmation.
    const confirmationsBefore = meta.confirmations().length;
    await h.deliver(
      textWebhook({ id: "wamid.OPT6", body: "ALTO", timestamp: new Date(Date.now() - 2 * DAY_MS) }),
    );
    expect((await byWaId(FIXTURE_IDS.waId)).marketingOptIn).toBe(false);
    expect((await byWaId(FIXTURE_IDS.waId)).optInAt).toBeInstanceOf(Date);
    expect(meta.confirmations()).toHaveLength(confirmationsBefore);
  });

  it("[AC-BC-5b] custom keywords and confirmation; contacts.setOptIn records the decision", async () => {
    const h = await setup({ optOut: { keywords: ["Parar"], confirmation: null } });
    const meta = metaSends();
    await h.deliver(
      burstWebhook([
        { id: "wamid.C1", body: "PARAR", from: "50255550301" },
        { id: "wamid.C2", body: "baja", from: "50255550302" },
      ]),
    );
    const [parar, baja] = await Promise.all(
      ["50255550301", "50255550302"].map((waId) =>
        h.contactState(
          [...h.adapter.__state.contacts.values()].find((c) => c.waId === waId)?.id ?? "",
        ),
      ),
    );
    expect(parar).toMatchObject({ marketingOptIn: false });
    expect(parar?.optInAt).toBeInstanceOf(Date);
    expect(baja?.optInAt).toBeNull();
    expect(meta.texts().map((b) => b.to)).toEqual([expect.stringContaining("50255550302")]);

    // An explicit opt-in makes the contact eligible for MARKETING again.
    h.optIns.length = 0;
    const updated = await h.sendo.contacts.setOptIn(parar?.id ?? "", true, { source: "form" });
    expect(updated.marketingOptIn).toBe(true);
    expect(updated.optInAt?.getTime()).toBeGreaterThanOrEqual(parar?.optInAt?.getTime() ?? 0);
    await h.sendo.contacts.setOptIn(parar?.id ?? "", true, { source: "form" });
    expect(h.optIns.map((e) => [e.optIn, e.source, e.previous.marketingOptIn])).toEqual([
      [true, "form", false],
    ]);
    expect(
      await h.sendo.broadcasts.preview({
        actor: h.admin,
        template: PROMO,
        language: "es",
        variables: ["Ana"],
        recipients: [parar?.id ?? "", baja?.id ?? ""],
      }),
    ).toMatchObject({ eligible: 1, skipped: { no_opt_in: 1, opted_out: 0 } });
    await expect(h.sendo.contacts.setOptIn(crypto.randomUUID(), false)).rejects.toMatchObject({
      code: "RECORD_NOT_FOUND",
      entity: "contact",
    });
    await expect(createHarness({ optOut: { keywords: [""] } })).rejects.toMatchObject({
      code: "CONFIG_ERROR",
    });
  });
});
