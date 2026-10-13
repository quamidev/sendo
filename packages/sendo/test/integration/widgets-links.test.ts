/**
 * Product spec 3.6 "Widgets and attribution", links half (SND-3.8). The attribution half
 * (code parsing, first message only, referral, stripped text for the agent) is
 * `widgets.test.ts` (SND-3.4). Everything goes through the public `sendo.links.*` API and a
 * signed webhook into the real pipeline with the memory adapter.
 *
 * Ways it could fail (one test each):
 * [AC-WG-1a] The URL is not `https://wa.me/<digits>?text=<encoded text + " [#source]">`, or the
 *            text a phone decodes from it is not the text + code the API returned.
 * [AC-WG-1b] The prefilled text, sent back unchanged by the contact, does not attribute the new
 *            conversation (`conversation.source`, `message.metadata.source`) or loses the stored text.
 * [AC-WG-1c] The number is not the one the tenant resolver picks (`tenant` → its default,
 *            `account` → that number, another tenant's number → ACCOUNT_NOT_FOUND).
 * [AC-WG-1d] `create` writes to storage (it must be pure).
 * [AC-WG-1e] A source outside `^[a-z0-9-]{1,32}$` produces a link instead of INVALID_PAYLOAD.
 * [AC-WG-5a] Source counts miss a source, count another tenant's conversations, or ignore the
 *            account filter.
 * [AC-WG-5b] A non-admin reads the source counts.
 */
import { describe, expect, it } from "vitest";
import { textWebhook } from "../../src/agents/test-helpers";
import { accountInput, acceptSends, useGraphServer } from "../../src/core/test-utils";
import { isSendoError } from "../../src/errors/base";
import type { ResolveRole } from "../../src/team/config";
import type { Role } from "../../src/team/permissions";
import { FIXTURE_IDS } from "../support/fixtures";
import { createHarness, dumpState } from "./harness";

const graph = useGraphServer();

const DIRECTORY: Record<string, Role> = {
  "tenant-a:alma": "admin",
  "tenant-a:sofia": "supervisor",
  "tenant-a:ana": "agent",
  "tenant-b:bruno": "admin",
};

const resolveRole: ResolveRole = ({ userId, tenantId }) => {
  const role = DIRECTORY[`${tenantId ?? ""}:${userId}`];
  return Promise.resolve(role === undefined ? null : { role });
};

async function setup() {
  graph.server.use(acceptSends([]));
  return createHarness({ resolveRole });
}

/** The `text` fixture from another contact (new conversation). */
function inboundFrom(waId: string, body: string, id: string, phoneNumberId?: string): string {
  const json = JSON.parse(
    textWebhook({ id, body, ...(phoneNumberId !== undefined && { phoneNumberId }) }),
  ) as {
    entry: {
      changes: { value: { contacts: { wa_id: string }[]; messages: { from: string }[] } }[];
    }[];
  };
  const value = json.entry[0]?.changes[0]?.value;
  const contact = value?.contacts[0];
  const message = value?.messages[0];
  if (!contact || !message) throw new Error("text fixture changed");
  contact.wa_id = waId;
  message.from = waId;
  return JSON.stringify(json);
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );
}

describe("widgets: links (SND-3.8)", () => {
  it("[AC-WG-1a] builds the wa.me URL whose decoded text is the text plus the visible code", async () => {
    const h = await setup();

    const link = await h.sendo.links.create({
      source: "garita",
      text: "  Hola, quiero información de la torre B  ",
    });

    expect(link).toEqual({
      url: "https://wa.me/15550001111?text=Hola%2C%20quiero%20informaci%C3%B3n%20de%20la%20torre%20B%20%5B%23garita%5D",
      code: "[#garita]",
      phone: "+15550001111",
      text: "Hola, quiero información de la torre B [#garita]",
    });
    const url = new URL(link.url);
    expect(url.origin + url.pathname).toBe("https://wa.me/15550001111");
    expect(url.searchParams.get("text")).toBe(link.text);

    const bare = await h.sendo.links.create({ source: "recepcion" });
    expect(new URL(bare.url).searchParams.get("text")).toBe("[#recepcion]");
  });

  it("[AC-WG-1b] the prefilled text sent by the contact attributes the new conversation", async () => {
    const h = await setup();
    const link = await h.sendo.links.create({ source: "garita", text: "Hola, vengo de la garita" });
    const prefill = new URL(link.url).searchParams.get("text") ?? "";

    await h.deliver(inboundFrom("50255557001", prefill, "wamid.LINK.1"));

    const [message] = h.messages("in");
    expect(message?.text).toBe("Hola, vengo de la garita [#garita]");
    expect(message?.metadata.source).toBe("garita");
    const conversation = message && (await h.sendo.conversations.get(message.conversationId));
    expect(conversation?.source).toBe("garita");
  });

  it("[AC-WG-1c] resolves the number like send.*: tenant default, explicit account, tenant mismatch", async () => {
    const h = await setup();
    await h.adapter.accounts.insert(
      accountInput({
        phoneNumberId: FIXTURE_IDS.secondPhoneNumberId,
        wabaId: FIXTURE_IDS.secondWabaId,
        displayPhone: "+502 2222-3333",
        tokenRef: "SENDO_TOKEN_B",
      }),
    );
    const other = await h.adapter.accounts.insert(
      accountInput({
        tenantId: "tenant-b",
        phoneNumberId: "100000000000009",
        wabaId: "200000000000009",
        displayPhone: "+50299990000",
        tokenRef: "SENDO_TOKEN_C",
      }),
    );

    const ambiguous = await errorOf(h.sendo.links.create({ tenant: "tenant-a", source: "x" }));
    expect(isSendoError(ambiguous) && ambiguous.code).toBe("AMBIGUOUS_ACCOUNT");

    await h.sendo.accounts.setDefault(FIXTURE_IDS.secondPhoneNumberId);
    const byTenant = await h.sendo.links.create({ tenant: "tenant-a", source: "factura" });
    expect(byTenant.phone).toBe("+50222223333");
    expect(byTenant.url.startsWith("https://wa.me/50222223333?text=")).toBe(true);

    const byAccount = await h.sendo.links.create({ account: h.account.id, source: "factura" });
    expect(byAccount.phone).toBe("+15550001111");
    expect((await h.sendo.links.create({ tenant: "tenant-b", source: "web" })).phone).toBe(
      "+50299990000",
    );

    const mismatch = await errorOf(
      h.sendo.links.create({ account: other.id, tenant: "tenant-a", source: "web" }),
    );
    expect(isSendoError(mismatch) && mismatch.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("[AC-WG-1d] create reads the account and writes nothing", async () => {
    const h = await setup();
    await h.deliver(inboundFrom("50255557002", "Hola", "wamid.LINK.2"));
    const before = dumpState(h.adapter.__state);

    await h.sendo.links.create({ source: "garita", text: "Hola" });
    await h.sendo.links.create({ account: FIXTURE_IDS.phoneNumberId, source: "web" });

    expect(dumpState(h.adapter.__state)).toBe(before);
  });

  it("[AC-WG-1e] rejects a source outside ^[a-z0-9-]{1,32}$ with INVALID_PAYLOAD", async () => {
    const h = await setup();
    const invalid = ["Garita", "", "a".repeat(33), "torre b", "[#garita]", "garíta", "garita_1"];

    for (const source of invalid) {
      const error = await errorOf(h.sendo.links.create({ source, text: "Hola" }));
      expect(isSendoError(error) && { code: error.code, json: error.toJSON() }).toMatchObject({
        code: "INVALID_PAYLOAD",
        json: { field: "source" },
      });
    }
    expect((await h.sendo.links.create({ source: "a".repeat(32) })).code).toBe(
      `[#${"a".repeat(32)}]`,
    );
  });

  it("[AC-WG-5a] counts conversations per source in the admin's tenant, per number on request", async () => {
    const h = await setup();
    const second = await h.adapter.accounts.insert(
      accountInput({
        phoneNumberId: FIXTURE_IDS.secondPhoneNumberId,
        wabaId: FIXTURE_IDS.secondWabaId,
        displayPhone: "+15550002222",
        tokenRef: "SENDO_TOKEN_B",
      }),
    );
    await h.adapter.accounts.insert(
      accountInput({
        tenantId: "tenant-b",
        phoneNumberId: "100000000000009",
        wabaId: "200000000000009",
        displayPhone: "+50299990000",
        tokenRef: "SENDO_TOKEN_C",
      }),
    );
    const garita = await h.sendo.links.create({ account: h.account.id, source: "garita" });
    const factura = await h.sendo.links.create({ account: second.id, source: "factura" });
    const otherTenant = await h.sendo.links.create({ tenant: "tenant-b", source: "garita" });

    await h.deliver(inboundFrom("50255557010", garita.text, "wamid.SRC.1"));
    await h.deliver(inboundFrom("50255557011", garita.text, "wamid.SRC.2"));
    await h.deliver(inboundFrom("50255557012", "Hola", "wamid.SRC.3"));
    await h.deliver(
      inboundFrom("50255557013", factura.text, "wamid.SRC.4", FIXTURE_IDS.secondPhoneNumberId),
    );
    await h.deliver(inboundFrom("50255557014", otherTenant.text, "wamid.SRC.5", "100000000000009"));

    const admin = await h.sendo.actor("alma", "tenant-a");
    expect(await h.sendo.links.sources({ actor: admin })).toEqual([
      { source: "garita", conversations: 2 },
      { source: "factura", conversations: 1 },
      { source: null, conversations: 1 },
    ]);
    expect(
      await h.sendo.links.sources({ actor: admin, account: FIXTURE_IDS.secondPhoneNumberId }),
    ).toEqual([{ source: "factura", conversations: 1 }]);
    expect(
      await h.sendo.links.sources({ actor: admin, from: new Date(Date.now() + 60_000) }),
    ).toEqual([]);

    const bruno = await h.sendo.actor("bruno", "tenant-b");
    expect(await h.sendo.links.sources({ actor: bruno })).toEqual([
      { source: "garita", conversations: 1 },
    ]);
    const foreign = await errorOf(h.sendo.links.sources({ actor: bruno, account: second.id }));
    expect(isSendoError(foreign) && foreign.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("[AC-WG-5b] supervisors and agents get FORBIDDEN for source counts", async () => {
    const h = await setup();
    for (const userId of ["sofia", "ana"]) {
      const actor = await h.sendo.actor(userId, "tenant-a");
      const error = await errorOf(h.sendo.links.sources({ actor }));
      expect(isSendoError(error) && error.toJSON()).toMatchObject({
        code: "FORBIDDEN",
        capability: "numbers.manage",
        role: actor.role,
      });
    }
  });
});
