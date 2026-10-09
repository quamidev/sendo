/**
 * Product spec 3.6 "Widgets and attribution", pipeline half (SND-3.4; the links half is
 * `widgets-links.test.ts`). End to end through `sendo.handleWebhook` with signed fixtures and a
 * scripted model.
 *
 * [AC-WG-4] A trailing `[#code]` (`[a-z0-9-]{1,32}`) in the first inbound message of a new or
 *           reopened conversation sets `conversation.source` and `message.metadata.source`; the
 *           stored text keeps the code and the agent reads it without. A code in a later message
 *           is ignored. A Click-to-WhatsApp `referral` sets `ad:<source_id>`. Without either,
 *           `source` stays null. Routing rules see the attributed source.
 */
import { describe, expect, it } from "vitest";
import { scriptedModel, textResult, transcript } from "../../src/agents/test-helpers";
import { acceptSends, useGraphServer } from "../../src/core/test-utils";
import { createHarness, freshFixture } from "./harness";

const graph = useGraphServer();

async function setup() {
  graph.server.use(acceptSends());
  const h = await createHarness({
    handoffMessage: null,
    resolveRole: () => Promise.resolve({ role: "admin" }),
  });
  const model = scriptedModel(textResult("¡Hola! ¿En qué te ayudo?"));
  h.sendo.agent({ name: "recepcion", model, instructions: "Eres la recepcionista." });
  return { ...h, model };
}

/** The `text` fixture with another id and body. */
function text(id: string, body: string): string {
  return freshFixture("text", (json) =>
    json
      .replace('"wamid.TEXT0001"', JSON.stringify(id))
      .replace('"Hola, quisiera agendar una cita"', JSON.stringify(body)),
  );
}

describe("source attribution", () => {
  it("[AC-WG-4] a [#code] on the first message sets the source; the agent reads the text without it", async () => {
    const h = await setup();
    await h.deliver(freshFixture("text-source-code"));

    const [inbound] = h.messages("in");
    expect(inbound).toMatchObject({
      text: "Hola, vi el letrero de la garita [#garita]",
      metadata: { source: "garita" },
    });
    const conversation = await h.adapter.conversations.get(inbound?.conversationId ?? "");
    expect(conversation?.source).toBe("garita");
    expect(h.messageEvents[0]?.conversation.source).toBe("garita");
    expect(transcript(h.model)).toEqual(["user: Hola, vi el letrero de la garita"]);

    // A code in a later message is ignored and reaches the model as written.
    await h.deliver(text("wamid.LATER0001", "Y otra cosa [#feria]"));
    const later = h.messages("in")[1];
    expect(later?.metadata.source).toBeUndefined();
    expect((await h.adapter.conversations.get(later?.conversationId ?? ""))?.source).toBe("garita");
    expect(transcript(h.model, 1).at(-1)).toBe("user: Y otra cosa [#feria]");
  });

  it("[AC-WG-4] no code, or an invalid one, leaves the source null", async () => {
    const h = await setup();
    await h.deliver(text("wamid.PLAIN0001", "Hola, vi el letrero [#Garita]"));
    const [inbound] = h.messages("in");
    expect(inbound?.metadata.source).toBeUndefined();
    expect((await h.adapter.conversations.get(inbound?.conversationId ?? ""))?.source).toBeNull();
    expect(transcript(h.model)).toEqual(["user: Hola, vi el letrero [#Garita]"]);
  });

  it("[AC-WG-4] a Click-to-WhatsApp referral sets ad:<source_id>", async () => {
    const h = await setup();
    await h.deliver(freshFixture("text-referral"));
    const [inbound] = h.messages("in");
    expect(inbound).toMatchObject({
      metadata: { source: "ad:120210000000000001" },
      content: { referral: expect.objectContaining({ sourceId: "120210000000000001" }) as unknown },
    });
    const conversation = await h.adapter.conversations.get(inbound?.conversationId ?? "");
    expect(conversation?.source).toBe("ad:120210000000000001");
  });

  it("[AC-WG-4] a reopened conversation takes the code of its new first message", async () => {
    const h = await setup();
    await h.deliver(freshFixture("text-source-code"));
    const conversationId = h.messages("in")[0]?.conversationId ?? "";
    await h.sendo.conversations.close(conversationId);

    await h.deliver(text("wamid.REOPEN0001", "Hola de nuevo [#feria-2026]"));
    const reopened = await h.adapter.conversations.get(conversationId);
    expect(reopened).toMatchObject({ status: "agent", source: "feria-2026" });
    expect(h.messages("in")[1]?.metadata.source).toBe("feria-2026");
  });

  it("[AC-WG-4][AC-WF-2] route rules match the attributed source", async () => {
    const h = await setup();
    const admin = await h.sendo.actor("admin-1", "tenant-a");
    await h.sendo.rules.upsert(
      {
        key: "garita",
        type: "route",
        params: { match: { source: "garita" }, action: { queue: "garita", to: "agent" } },
      },
      { actor: admin },
    );
    await h.deliver(freshFixture("text-source-code"));
    const conversation = await h.adapter.conversations.get(
      h.messages("in")[0]?.conversationId ?? "",
    );
    expect(conversation).toMatchObject({ source: "garita", queue: "garita", status: "agent" });
  });
});
