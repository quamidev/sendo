/**
 * Product spec — Acceptance Criteria — "Multi-number and contacts".
 *
 * [AC-MN-1] A webhook for an unknown phone_number_id is stored as `unrouted` and a warning is
 *           logged; nothing else is written (plus the `event.unrouted` event fires).
 * [AC-MN-2] Sends require an explicit `account` when more than one account exists; with exactly one
 *           account it's used by default.
 * [AC-MN-3] linkContact is called on first contact and whenever the profile changes; its result is
 *           stored in sendo_contacts.app_ref.
 * [AC-MN-4] Contacts are unique per account and phone; the same person writing to two tenants'
 *           numbers produces two contacts.
 */
import { describe, expect, it, vi } from "vitest";
import { textWebhook } from "../../src/agents/test-helpers";
import type { UnroutedEvent } from "../../src/core/events";
import {
  GRAPH,
  acceptSends,
  accountInput,
  openConversation,
  useGraphServer,
} from "../../src/core/test-utils";
import { AmbiguousAccountError } from "../../src/errors/errors";
import type { Actor } from "../../src/team/permissions";
import { FIXTURE_IDS, loadWebhookFixtureText } from "../support/fixtures";
import { createHarness, freshFixture } from "./harness";

const graph = useGraphServer();
const PHONE = `+${FIXTURE_IDS.waId}`;

describe("Multi-number and contacts", () => {
  it("[AC-MN-1] an unknown phone_number_id is stored unrouted, warned, emitted, and nothing else is written", async () => {
    const h = await createHarness();
    const unrouted: UnroutedEvent[] = [];
    h.sendo.on("event.unrouted", (e) => {
      unrouted.push(e);
    });
    const before = {
      contacts: h.adapter.__state.contacts.size,
      conversations: h.adapter.__state.conversations.size,
    };

    const event = await h.deliver("unrouted-phone-number");

    expect(event.status).toBe("unrouted");
    expect(event.payload).toEqual(JSON.parse(loadWebhookFixtureText("unrouted-phone-number")));
    expect(unrouted).toEqual([
      {
        reason: "unknown_account",
        object: "whatsapp_business_account",
        phoneNumberId: FIXTURE_IDS.unroutedPhoneNumberId,
        raw: expect.anything() as unknown,
      },
    ]);
    expect(h.logs.of("warn").some((l) => l.includes(FIXTURE_IDS.unroutedPhoneNumberId))).toBe(true);
    expect(h.adapter.__state.contacts.size).toBe(before.contacts);
    expect(h.adapter.__state.conversations.size).toBe(before.conversations);
    expect(h.adapter.__state.messages.size + h.adapter.__state.media.size).toBe(0);
    expect(h.adapter.__state.events.size).toBe(1);
    expect(h.messageEvents).toHaveLength(0);
    expect(graph.requests).toHaveLength(0);
  });

  it("[AC-MN-1] an inactive account's number is treated as unrouted", async () => {
    const h = await createHarness();
    const stored = h.adapter.__state.accounts.get(h.account.id);
    if (!stored) throw new Error("account missing");
    stored.active = false;
    expect((await h.deliver(freshFixture("text"))).status).toBe("unrouted");
    expect(h.adapter.__state.messages.size).toBe(0);
  });

  it("[AC-MN-2] one account is the default; two accounts require an explicit account", async () => {
    graph.server.use(acceptSends());
    const h = await createHarness();
    await openConversation(h.ctx, h.account, PHONE);
    await expect(h.sendo.send.text(PHONE, "uno")).resolves.toMatchObject({ status: "sent" });

    const second = await h.adapter.accounts.insert(
      accountInput({
        phoneNumberId: FIXTURE_IDS.secondPhoneNumberId,
        wabaId: FIXTURE_IDS.secondWabaId,
        tokenRef: "SENDO_TOKEN_B",
        tenantId: "tenant-b",
      }),
    );
    graph.requests.length = 0;
    const error = await h.sendo.send.text(PHONE, "dos").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AmbiguousAccountError);
    expect((error as AmbiguousAccountError).candidates).toEqual([h.account.id, second.id]);
    expect(graph.requests).toHaveLength(0);

    await openConversation(h.ctx, second, PHONE);
    const explicit = await h.sendo.send.text(PHONE, "tres", {
      account: FIXTURE_IDS.secondPhoneNumberId,
    });
    expect(explicit.tenantId).toBe("tenant-b");
    expect(graph.requests.map((r) => r.url)).toEqual([
      `${GRAPH}/${FIXTURE_IDS.secondPhoneNumberId}/messages`,
    ]);
  });

  it("[AC-MN-3] linkContact runs on first contact and on a profile change; appRef is stored", async () => {
    const linkContact = vi.fn(({ contact }: { contact: { profileName: string | null } }) =>
      contact.profileName === "Ana P." ? "pac_002" : "pac_001",
    );
    const h = await createHarness({ linkContact });

    await h.deliver(freshFixture("text"));
    await h.deliver(freshFixture("text", (s) => s.replace("wamid.TEXT0001", "wamid.TEXT0002")));
    expect(linkContact).toHaveBeenCalledTimes(1);
    const [contact] = [...h.adapter.__state.contacts.values()];
    expect(contact?.appRef).toBe("pac_001");

    await h.deliver(
      freshFixture("text", (s) =>
        s.replace("wamid.TEXT0001", "wamid.TEXT0003").replace(FIXTURE_IDS.profileName, "Ana P."),
      ),
    );
    expect(linkContact).toHaveBeenCalledTimes(2);
    expect(await h.adapter.contacts.get(contact?.id ?? "")).toMatchObject({
      profileName: "Ana P.",
      appRef: "pac_002",
    });
    expect(h.messageEvents.map((e) => e.contact.appRef)).toEqual(["pac_001", "pac_001", "pac_002"]);
  });

  it("[AC-MN-4] the same person on two tenants' numbers gives two contacts; replays don't add more", async () => {
    const h = await createHarness();
    const second = await h.adapter.accounts.insert(
      accountInput({
        phoneNumberId: FIXTURE_IDS.secondPhoneNumberId,
        wabaId: FIXTURE_IDS.secondWabaId,
        tokenRef: "SENDO_TOKEN_B",
        tenantId: "tenant-b",
      }),
    );
    await h.deliver(textWebhook({ id: "wamid.T_A1", body: "hola A" }));
    await h.deliver(textWebhook({ id: "wamid.T_A2", body: "otra vez A" }));
    await h.deliver(
      textWebhook({
        id: "wamid.T_B1",
        body: "hola B",
        phoneNumberId: FIXTURE_IDS.secondPhoneNumberId,
      }),
    );

    const contacts = [...h.adapter.__state.contacts.values()];
    expect(contacts).toHaveLength(2);
    expect(contacts.map((c) => [c.accountId, c.tenantId, c.phone]).sort()).toEqual(
      [
        [h.account.id, "tenant-a", PHONE],
        [second.id, "tenant-b", PHONE],
      ].sort(),
    );
    const conversations = [...h.adapter.__state.conversations.values()];
    expect(conversations.map((c) => c.tenantId).sort()).toEqual(["tenant-a", "tenant-b"]);
    const supervisorB: Actor = {
      userId: "sup-b",
      tenantId: "tenant-b",
      role: "supervisor",
      queues: [],
    };
    expect((await h.sendo.inbox.list({ actor: supervisorB })).items).toHaveLength(1);
  });
});
