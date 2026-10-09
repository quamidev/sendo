import { describe, expect, it } from "vitest";
import { PayloadValidationError } from "../../errors/errors";
import {
  buildButtonsPayload,
  buildListPayload,
  buildMediaPayload,
  buildTemplatePayload,
  buildTextPayload,
  type ButtonsInput,
  type ListInput,
} from "./send";

const TO = "+50255551234";

function makeButtons(count: number): ButtonsInput["buttons"] {
  return Array.from({ length: count }, (_, i) => ({ id: `b${i}`, title: `Opción ${i}` }));
}

function makeList(overrides: Partial<ListInput> = {}): ListInput {
  return {
    body: "Elige un horario",
    button: "Ver horarios",
    sections: [{ title: "Mañana", rows: [{ id: "r1", title: "9:00" }] }],
    ...overrides,
  };
}

function expectInvalid(fn: () => unknown, field: string, limit?: number): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PayloadValidationError);
    const error = err as PayloadValidationError;
    expect(error.field).toBe(field);
    if (limit !== undefined) expect(error.limit).toBe(limit);
    return;
  }
  throw new Error(`expected PayloadValidationError on ${field}`);
}

describe("buildTextPayload", () => {
  it("rejects empty and oversized bodies", () => {
    expectInvalid(() => buildTextPayload(TO, "  "), "body");
    expectInvalid(() => buildTextPayload(TO, "a".repeat(4097)), "body", 4096);
  });
});

describe("buildMediaPayload", () => {
  it("builds a link-based image with caption", () => {
    const payload = buildMediaPayload(TO, {
      type: "image",
      url: "https://cdn.example.com/a.jpg",
      caption: "Receta",
    });
    expect(payload).toMatchObject({
      type: "image",
      image: { link: "https://cdn.example.com/a.jpg", caption: "Receta" },
    });
  });

  it("builds an id-based document with filename and reply context", () => {
    const payload = buildMediaPayload(
      TO,
      { type: "document", id: "media-1", filename: "orden.pdf" },
      { replyTo: "wamid.9" },
    );
    expect(payload).toMatchObject({
      type: "document",
      document: { id: "media-1", filename: "orden.pdf" },
      context: { message_id: "wamid.9" },
    });
  });

  it("requires exactly one of id or url", () => {
    expectInvalid(() => buildMediaPayload(TO, { type: "image" }), "media");
    expectInvalid(
      () => buildMediaPayload(TO, { type: "image", id: "1", url: "https://x.dev/a.png" }),
      "media",
    );
  });

  it("rejects non-http urls, captions on audio/sticker, filenames off documents and long captions", () => {
    expectInvalid(
      () => buildMediaPayload(TO, { type: "image", url: "file:///etc/passwd" }),
      "media.url",
    );
    expectInvalid(() => buildMediaPayload(TO, { type: "audio", id: "1", caption: "x" }), "caption");
    expectInvalid(
      () => buildMediaPayload(TO, { type: "sticker", id: "1", caption: "x" }),
      "caption",
    );
    expectInvalid(
      () => buildMediaPayload(TO, { type: "image", id: "1", filename: "a" }),
      "filename",
    );
    expectInvalid(
      () => buildMediaPayload(TO, { type: "video", id: "1", caption: "c".repeat(1025) }),
      "caption",
      1024,
    );
  });
});

describe("buildButtonsPayload", () => {
  it("builds reply buttons with header and footer", () => {
    const payload = buildButtonsPayload(TO, {
      body: "¿Confirmas tu cita?",
      buttons: makeButtons(3),
      header: "Cita",
      footer: "Clínica",
    });
    expect(payload.interactive).toEqual({
      type: "button",
      header: { type: "text", text: "Cita" },
      body: { text: "¿Confirmas tu cita?" },
      footer: { text: "Clínica" },
      action: {
        buttons: makeButtons(3).map((reply) => ({ type: "reply", reply })),
      },
    });
  });

  it("enforces Meta's limits", () => {
    expectInvalid(() => buildButtonsPayload(TO, { body: "x", buttons: [] }), "buttons");
    expectInvalid(
      () => buildButtonsPayload(TO, { body: "x", buttons: makeButtons(4) }),
      "buttons",
      3,
    );
    expectInvalid(
      () => buildButtonsPayload(TO, { body: "x", buttons: [{ id: "a", title: "t".repeat(21) }] }),
      "buttons[0].title",
      20,
    );
    expectInvalid(
      () => buildButtonsPayload(TO, { body: "b".repeat(1025), buttons: makeButtons(1) }),
      "body",
      1024,
    );
    expectInvalid(
      () => buildButtonsPayload(TO, { body: "x", buttons: makeButtons(1), header: "h".repeat(61) }),
      "header",
      60,
    );
    expectInvalid(
      () => buildButtonsPayload(TO, { body: "x", buttons: makeButtons(1), footer: "f".repeat(61) }),
      "footer",
      60,
    );
    expectInvalid(
      () =>
        buildButtonsPayload(TO, {
          body: "x",
          buttons: [
            { id: "a", title: "Sí" },
            { id: "a", title: "No" },
          ],
        }),
      "buttons.id[1]",
    );
  });
});

describe("buildListPayload", () => {
  it("builds a list message", () => {
    const payload = buildListPayload(
      TO,
      makeList({
        header: "Horarios",
        footer: "Clínica",
        sections: [
          { title: "Mañana", rows: [{ id: "r1", title: "9:00", description: "Dr. Pérez" }] },
          { title: "Tarde", rows: [{ id: "r2", title: "15:00" }] },
        ],
      }),
      { replyTo: "wamid.2" },
    );
    expect(payload.context).toEqual({ message_id: "wamid.2" });
    expect(payload.interactive).toEqual({
      type: "list",
      header: { type: "text", text: "Horarios" },
      body: { text: "Elige un horario" },
      footer: { text: "Clínica" },
      action: {
        button: "Ver horarios",
        sections: [
          { title: "Mañana", rows: [{ id: "r1", title: "9:00", description: "Dr. Pérez" }] },
          { title: "Tarde", rows: [{ id: "r2", title: "15:00" }] },
        ],
      },
    });
  });

  it("enforces Meta's limits", () => {
    const row = (i: number) => ({ id: `r${i}`, title: `Fila ${i}` });
    expectInvalid(() => buildListPayload(TO, makeList({ sections: [] })), "sections");
    expectInvalid(
      () =>
        buildListPayload(
          TO,
          makeList({
            sections: Array.from({ length: 11 }, (_, i) => ({ title: `S${i}`, rows: [row(i)] })),
          }),
        ),
      "sections",
      10,
    );
    expectInvalid(
      () =>
        buildListPayload(
          TO,
          makeList({
            sections: [
              { title: "A", rows: Array.from({ length: 6 }, (_, i) => row(i)) },
              { title: "B", rows: Array.from({ length: 5 }, (_, i) => row(i + 6)) },
            ],
          }),
        ),
      "sections.rows",
      10,
    );
    expectInvalid(
      () =>
        buildListPayload(
          TO,
          makeList({ sections: [{ title: "A", rows: [{ id: "1", title: "t".repeat(25) }] }] }),
        ),
      "sections[0].rows[0].title",
      24,
    );
    expectInvalid(
      () =>
        buildListPayload(
          TO,
          makeList({
            sections: [
              { title: "A", rows: [{ id: "1", title: "t", description: "d".repeat(73) }] },
            ],
          }),
        ),
      "sections[0].rows[0].description",
      72,
    );
    expectInvalid(() => buildListPayload(TO, makeList({ button: "b".repeat(21) })), "button", 20);
    expectInvalid(
      () =>
        buildListPayload(
          TO,
          makeList({ sections: [{ rows: [row(1)] }, { title: "B", rows: [row(2)] }] }),
        ),
      "sections[0].title",
    );
  });
});

describe("buildTemplatePayload", () => {
  it("maps positional variables to body parameters", () => {
    const payload = buildTemplatePayload(TO, {
      name: "recordatorio",
      language: "es",
      variables: ["Ana", "10:00"],
    });
    expect(payload.template).toEqual({
      name: "recordatorio",
      language: { code: "es" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Ana" },
            { type: "text", text: "10:00" },
          ],
        },
      ],
    });
  });

  it("maps named variables, header media and buttons", () => {
    const payload = buildTemplatePayload(TO, {
      name: "cita",
      language: "es_MX",
      variables: { nombre: "Ana" },
      headerMedia: { type: "document", id: "m1", filename: "orden.pdf" },
      buttons: [
        { index: 0, subType: "quick_reply", payload: "CONFIRMAR" },
        { index: 1, subType: "url", text: "abc123" },
      ],
      replyTo: "wamid.3",
    });
    expect(payload.context).toEqual({ message_id: "wamid.3" });
    expect(payload.template.components).toEqual([
      {
        type: "header",
        parameters: [{ type: "document", document: { id: "m1", filename: "orden.pdf" } }],
      },
      { type: "body", parameters: [{ type: "text", parameter_name: "nombre", text: "Ana" }] },
      {
        type: "button",
        sub_type: "quick_reply",
        index: "0",
        parameters: [{ type: "payload", payload: "CONFIRMAR" }],
      },
      {
        type: "button",
        sub_type: "url",
        index: "1",
        parameters: [{ type: "text", text: "abc123" }],
      },
    ]);
  });

  it("rejects missing name/language, empty variables and bad buttons", () => {
    expectInvalid(() => buildTemplatePayload(TO, { name: "", language: "es" }), "name");
    expectInvalid(() => buildTemplatePayload(TO, { name: "a", language: "" }), "language");
    expectInvalid(
      () => buildTemplatePayload(TO, { name: "a", language: "es", variables: ["ok", ""] }),
      "variables[1]",
    );
    expectInvalid(
      () =>
        buildTemplatePayload(TO, {
          name: "a",
          language: "es",
          buttons: [{ index: 0, subType: "quick_reply" }],
        }),
      "buttons[0].payload",
    );
    expectInvalid(
      () =>
        buildTemplatePayload(TO, {
          name: "a",
          language: "es",
          buttons: [{ index: -1, subType: "url", text: "x" }],
        }),
      "buttons[0].index",
    );
  });
});
