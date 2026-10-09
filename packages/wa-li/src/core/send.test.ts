import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { MetaApiError } from "../errors/meta-api-error";
import {
  accountInput,
  acceptSends,
  GRAPH,
  makeClient,
  openConversation,
  useGraphServer,
} from "./test-utils";

const graph = useGraphServer();
const PHONE = "+50255550001";

async function setup(options: Parameters<typeof makeClient>[0] = {}) {
  const client = makeClient(options);
  const account = await client.adapter.accounts.insert(accountInput());
  return { ...client, account };
}

async function threadOf(
  adapter: Awaited<ReturnType<typeof setup>>["adapter"],
  conversationId: string,
) {
  return (await adapter.messages.thread(conversationId, { limit: 50 })).items;
}

describe("account resolution", () => {
  it("ignores inactive accounts when picking the default", async () => {
    graph.server.use(acceptSends());
    const { wa, ctx, adapter, account } = await setup();
    await adapter.accounts.insert(accountInput({ phoneNumberId: "PN_OFF", active: false }));
    await openConversation(ctx, account);
    await expect(wa.send.text(PHONE, "x")).resolves.toMatchObject({ status: "sent" });
  });
});

describe("wa.send.media", () => {
  it("uploads a file first, then sends its media id", async () => {
    const bodies: unknown[] = [];
    graph.server.use(
      http.post(`${GRAPH}/PN_A/media`, () => HttpResponse.json({ id: "MEDIA_UP_1" })),
      acceptSends(bodies),
    );
    const { wa, ctx, account, adapter } = await setup();
    await openConversation(ctx, account);
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" });
    const message = await wa.send.media(PHONE, { type: "document", file, filename: "receta.pdf" });

    expect(graph.requests.map((r) => r.url)).toEqual([
      `${GRAPH}/PN_A/media`,
      `${GRAPH}/PN_A/messages`,
    ]);
    expect(bodies[0]).toMatchObject({
      type: "document",
      document: { id: "MEDIA_UP_1", filename: "receta.pdf" },
    });
    const stored = await adapter.messages.get(message.id);
    expect(stored).toMatchObject({
      status: "sent",
      content: { filename: "receta.pdf", mimeType: "application/pdf", sizeBytes: 3 },
      metadata: { metaMediaId: "MEDIA_UP_1" },
    });
  });

  it("marks the row failed when the upload fails", async () => {
    graph.server.use(
      http.post(`${GRAPH}/PN_A/media`, () =>
        HttpResponse.json({ error: { code: 100, message: "bad file" } }, { status: 400 }),
      ),
    );
    const { wa, ctx, account, adapter } = await setup();
    const { conversation } = await openConversation(ctx, account);
    const file = new Blob([new Uint8Array([1])], { type: "image/png" });
    await expect(wa.send.media(PHONE, { type: "image", file })).rejects.toBeInstanceOf(
      MetaApiError,
    );
    expect(graph.requests).toHaveLength(1);
    expect((await threadOf(adapter, conversation.id))[0]?.status).toBe("failed");
  });
});
