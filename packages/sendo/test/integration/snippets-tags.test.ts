/**
 * Product spec 3.2 "Snippets" (AC-SN-1..4) and 3.3 "Tags" (AC-TG-1, TG-2 catalog read, TG-4),
 * through the public `sendo.actor`, `sendo.snippets.*`, `sendo.tags.*` and the exported picker
 * search, on a real client (memory adapter) whose conversation arrives as a signed webhook.
 * Adding tags to conversations is `sendo.inbox.tags` (SND-3.2); TG-4 seeds them via the adapter.
 *
 * Ways it could fail (one test each):
 * [AC-SN-1a] An agent or supervisor creates, edits or deletes a tenant snippet; or an admin cannot.
 * [AC-SN-1b] A personal snippet is listed, read, edited or deleted by anyone but its owner
 *            (admins included), or its owner (any role) cannot manage it.
 * [AC-SN-1c] A non-admin promotes a personal snippet to the team (or demotes a team one).
 * [AC-SN-1d] Another tenant's snippet is visible or editable.
 * [AC-SN-1e] An invalid shortcut, an empty or oversized body, an unknown visibility or another
 *            tenant's account scope is stored; the account filter of `list` is wrong.
 * [AC-SN-2]  The picker search misses accent/case variants or body matches, or ranks body-only
 *            matches above shortcut matches.
 * [AC-SN-3a] Built-ins are not filled: `nombre` (WhatsApp profile), `telefono`, `agente` (the
 *            rendering user's name via `resolveUsers`).
 * [AC-SN-3b] App variables are not merged, or cannot override a built-in.
 * [AC-SN-3c] Unknown or blank variables are dropped or blanked instead of kept and listed.
 * [AC-SN-3d] A failing app hook breaks rendering instead of leaving its variables unresolved.
 * [AC-SN-3e] Rendering on a conversation the actor cannot see succeeds (leaks contact data).
 * [AC-SN-4]  A taken shortcut (same tenant and owner) is not a typed, actionable error; or the
 *            same shortcut is refused for another owner or tenant.
 * [AC-TG-1a] A non-admin changes the catalog or reads usage; or every role cannot list it.
 * [AC-TG-1b] A duplicate name (ignoring case) is not a typed, actionable error.
 * [AC-TG-1c] A color outside the palette or a blank/oversized name is stored.
 * [AC-TG-1d] Another tenant's tag is visible, editable or deletable.
 * [AC-TG-4]  `usage` miscounts, or deleting a tag leaves it on conversations.
 */
import { describe, expect, it } from "vitest";
import { accountInput, useGraphServer } from "../../src/core/test-utils";
import {
  AccountNotFoundError,
  ConstraintViolationError,
  ForbiddenError,
  PayloadValidationError,
  RecordNotFoundError,
} from "../../src/errors/errors";
import { searchSnippets } from "../../src/index";
import type { ResolveRole, ResolveSnippetVariables, ResolveUsers } from "../../src/team/config";
import type { Role } from "../../src/team/permissions";
import { FIXTURE_IDS } from "../support/fixtures";
import { createHarness, freshFixture } from "./harness";

useGraphServer();

const DIRECTORY: Record<string, { role: Role; queues?: string[] }> = {
  "tenant-a:luis": { role: "agent", queues: ["cobranza"] },
  "tenant-a:marta": { role: "agent" },
  "tenant-a:sofia": { role: "supervisor" },
  "tenant-a:alma": { role: "admin" },
  "tenant-b:bruno": { role: "admin" },
};

const resolveRole: ResolveRole = ({ userId, tenantId }) =>
  Promise.resolve(DIRECTORY[`${tenantId ?? ""}:${userId}`] ?? null);

const resolveUsers: ResolveUsers = (ids) =>
  Promise.resolve(
    [
      { id: "luis", name: "Luis Gómez" },
      { id: "alma", name: "Alma Ruiz" },
    ].filter((u) => ids.includes(u.id)),
  );

async function setup(options: { resolveSnippetVariables?: ResolveSnippetVariables } = {}) {
  const h = await createHarness({ resolveRole, resolveUsers, ...options });
  const accountB = await h.adapter.accounts.insert(
    accountInput({
      tenantId: "tenant-b",
      phoneNumberId: FIXTURE_IDS.secondPhoneNumberId,
      wabaId: FIXTURE_IDS.secondWabaId,
      tokenRef: "SENDO_TOKEN_B",
    }),
  );
  await h.deliver(freshFixture("text"));
  const [conversation] = [...h.adapter.__state.conversations.values()];
  if (!conversation) throw new Error("the webhook stored no conversation");
  const actors = {
    luis: await h.sendo.actor("luis", "tenant-a"),
    marta: await h.sendo.actor("marta", "tenant-a"),
    sofia: await h.sendo.actor("sofia", "tenant-a"),
    alma: await h.sendo.actor("alma", "tenant-a"),
    bruno: await h.sendo.actor("bruno", "tenant-b"),
  };
  return { ...h, accountB, conversation, actors };
}

async function rejection<E extends Error>(
  promise: Promise<unknown>,
  type: abstract new (...args: never[]) => E,
): Promise<E> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(type);
  return error as E;
}

describe("sendo.snippets (AC-SN-1, SN-4)", () => {
  it("[AC-SN-1a] only admins create, edit and delete tenant snippets", async () => {
    const { sendo, actors } = await setup();
    for (const actor of [actors.luis, actors.sofia]) {
      const error = await rejection(
        sendo.snippets.upsert({ shortcut: "saludo", body: "Hola" }, { actor }),
        ForbiddenError,
      );
      expect(error.toJSON()).toMatchObject({
        code: "FORBIDDEN",
        capability: "snippets.manage_tenant",
        role: actor.role,
      });
    }

    const snippet = await sendo.snippets.upsert(
      { shortcut: "saludo", body: "Hola {{nombre}}" },
      { actor: actors.alma },
    );
    expect(snippet).toMatchObject({
      tenantId: "tenant-a",
      shortcut: "saludo",
      visibility: "tenant",
      ownerUserId: null,
      accountId: null,
      createdBy: "alma",
    });
    await expect(sendo.snippets.list({ actor: actors.luis })).resolves.toEqual([snippet]);

    const edit = { id: snippet.id, shortcut: "saludo", body: "Buenas" };
    await rejection(sendo.snippets.upsert(edit, { actor: actors.sofia }), ForbiddenError);
    await rejection(sendo.snippets.delete(snippet.id, { actor: actors.luis }), ForbiddenError);
    await expect(sendo.snippets.upsert(edit, { actor: actors.alma })).resolves.toMatchObject({
      id: snippet.id,
      body: "Buenas",
      updatedBy: "alma",
    });
    await sendo.snippets.delete(snippet.id, { actor: actors.alma });
    await expect(sendo.snippets.list({ actor: actors.alma })).resolves.toEqual([]);
  });

  it("[AC-SN-1b] a personal snippet is its owner's alone, whatever the roles", async () => {
    const { sendo, actors } = await setup();
    const mine = await sendo.snippets.upsert(
      { shortcut: "cita", body: "Su cita es mañana", visibility: "personal" },
      { actor: actors.luis },
    );
    expect(mine).toMatchObject({ visibility: "personal", ownerUserId: "luis" });
    await expect(sendo.snippets.get(mine.id, { actor: actors.luis })).resolves.toEqual(mine);

    for (const actor of [actors.marta, actors.sofia, actors.alma]) {
      await expect(sendo.snippets.list({ actor })).resolves.toEqual([]);
      await rejection(sendo.snippets.get(mine.id, { actor }), RecordNotFoundError);
      await rejection(
        sendo.snippets.upsert({ id: mine.id, shortcut: "cita", body: "x" }, { actor }),
        RecordNotFoundError,
      );
      await rejection(sendo.snippets.delete(mine.id, { actor }), RecordNotFoundError);
    }

    const edited = await sendo.snippets.upsert(
      { id: mine.id, shortcut: "cita2", body: "Le esperamos" },
      { actor: actors.luis },
    );
    expect(edited).toMatchObject({
      shortcut: "cita2",
      visibility: "personal",
      ownerUserId: "luis",
    });
    await sendo.snippets.delete(mine.id, { actor: actors.luis });
    await expect(sendo.snippets.list({ actor: actors.luis })).resolves.toEqual([]);
  });

  it("[AC-SN-1c] only admins move a snippet between personal and team", async () => {
    const { sendo, actors } = await setup();
    const mine = await sendo.snippets.upsert(
      { shortcut: "cita", body: "Hola", visibility: "personal" },
      { actor: actors.luis },
    );
    await rejection(
      sendo.snippets.upsert(
        { id: mine.id, shortcut: "cita", body: "Hola", visibility: "tenant" },
        { actor: actors.luis },
      ),
      ForbiddenError,
    );
    const team = await sendo.snippets.upsert(
      { shortcut: "horario", body: "Abrimos a las 8" },
      { actor: actors.alma },
    );
    await rejection(
      sendo.snippets.upsert(
        { id: team.id, shortcut: "horario", body: "x", visibility: "personal" },
        { actor: actors.sofia },
      ),
      ForbiddenError,
    );

    const almaOwn = await sendo.snippets.upsert(
      { shortcut: "firma", body: "Alma", visibility: "personal" },
      { actor: actors.alma },
    );
    const promoted = await sendo.snippets.upsert(
      { id: almaOwn.id, shortcut: "firma", body: "Equipo", visibility: "tenant" },
      { actor: actors.alma },
    );
    expect(promoted).toMatchObject({ visibility: "tenant", ownerUserId: null });
    await expect(sendo.snippets.get(promoted.id, { actor: actors.marta })).resolves.toMatchObject({
      body: "Equipo",
    });
  });

  it("[AC-SN-1d] another tenant's snippets are invisible and untouchable", async () => {
    const { sendo, actors } = await setup();
    const theirs = await sendo.snippets.upsert(
      { shortcut: "saludo", body: "Hola desde B" },
      { actor: actors.bruno },
    );
    await expect(sendo.snippets.list({ actor: actors.alma })).resolves.toEqual([]);
    await rejection(sendo.snippets.get(theirs.id, { actor: actors.alma }), RecordNotFoundError);
    await rejection(
      sendo.snippets.upsert(
        { id: theirs.id, shortcut: "saludo", body: "x" },
        { actor: actors.alma },
      ),
      RecordNotFoundError,
    );
    await rejection(sendo.snippets.delete(theirs.id, { actor: actors.alma }), RecordNotFoundError);
    await expect(sendo.snippets.get(theirs.id, { actor: actors.bruno })).resolves.toMatchObject({
      body: "Hola desde B",
    });
  });

  it("[AC-SN-1e] invalid input is refused with the field to fix; account scope stays in the tenant", async () => {
    const { sendo, adapter, actors, account, accountB } = await setup();
    const actor = actors.alma;
    const cases: [Parameters<typeof sendo.snippets.upsert>[0], string][] = [
      [{ shortcut: "/saludo", body: "Hola" }, "shortcut"],
      [{ shortcut: "Saludo", body: "Hola" }, "shortcut"],
      [{ shortcut: "a".repeat(33), body: "Hola" }, "shortcut"],
      [{ shortcut: "", body: "Hola" }, "shortcut"],
      [{ shortcut: "saludo", body: "   " }, "body"],
      [{ shortcut: "saludo", body: "x".repeat(4097) }, "body"],
      [
        {
          shortcut: "saludo",
          body: "Hola",
          visibility: "everyone" as unknown as "tenant",
        },
        "visibility",
      ],
    ];
    for (const [input, field] of cases) {
      const error = await rejection(
        sendo.snippets.upsert(input, { actor }),
        PayloadValidationError,
      );
      expect(error.field).toBe(field);
      expect(error.code).toBe("INVALID_PAYLOAD");
    }
    await rejection(
      sendo.snippets.upsert(
        { shortcut: "saludo", body: "Hola", accountId: accountB.id },
        { actor },
      ),
      AccountNotFoundError,
    );
    await expect(sendo.snippets.list({ actor })).resolves.toEqual([]);

    const scoped = await sendo.snippets.upsert(
      { shortcut: "pago", body: "Pague aquí", accountId: account.id },
      { actor },
    );
    const everywhere = await sendo.snippets.upsert({ shortcut: "hola", body: "Hola" }, { actor });
    const other = await adapter.accounts.insert(
      accountInput({ phoneNumberId: "PN_OTHER", wabaId: "WABA_OTHER" }),
    );
    const ids = (list: { id: string }[]) => list.map((s) => s.id);
    expect(ids(await sendo.snippets.list({ actor, accountId: account.id }))).toEqual([
      everywhere.id,
      scoped.id,
    ]);
    expect(ids(await sendo.snippets.list({ actor, accountId: other.id }))).toEqual([everywhere.id]);
    const unscoped = await sendo.snippets.upsert(
      { id: scoped.id, shortcut: "pago", body: "Pague aquí", accountId: null },
      { actor },
    );
    expect(unscoped.accountId).toBeNull();
  });

  it("[AC-SN-4] a taken shortcut is a typed error that says what to do; other owners and tenants may reuse it", async () => {
    const { sendo, actors } = await setup();
    await sendo.snippets.upsert({ shortcut: "saludo", body: "Hola" }, { actor: actors.alma });
    const team = await rejection(
      sendo.snippets.upsert({ shortcut: "saludo", body: "Otra" }, { actor: actors.alma }),
      ConstraintViolationError,
    );
    expect(team.toJSON()).toMatchObject({
      code: "CONSTRAINT_VIOLATION",
      constraint: "sendo_snippets_shortcut_key",
    });
    expect(team.message).toContain('"/saludo"');
    expect(team.message).toMatch(/Choose a different shortcut or edit the existing snippet/);

    await sendo.snippets.upsert(
      { shortcut: "saludo", body: "Mío", visibility: "personal" },
      { actor: actors.luis },
    );
    await sendo.snippets.upsert(
      { shortcut: "saludo", body: "Mío también", visibility: "personal" },
      { actor: actors.marta },
    );
    await sendo.snippets.upsert({ shortcut: "saludo", body: "B" }, { actor: actors.bruno });
    const personal = await rejection(
      sendo.snippets.upsert(
        { shortcut: "saludo", body: "Repetido", visibility: "personal" },
        { actor: actors.luis },
      ),
      ConstraintViolationError,
    );
    expect(personal.message).toContain("one of your personal snippets");

    const list = await sendo.snippets.list({ actor: actors.luis });
    expect(list.map((s) => [s.shortcut, s.visibility, s.body])).toEqual([
      ["saludo", "tenant", "Hola"],
      ["saludo", "personal", "Mío"],
    ]);
  });
});

describe("snippet picker search (AC-SN-2)", () => {
  it("[AC-SN-2] matches shortcut and body ignoring accents and case, shortcut matches first", async () => {
    const { sendo, actors } = await setup();
    const actor = actors.alma;
    for (const [shortcut, body] of [
      ["direccion", "Estamos en la 5a avenida"],
      ["horario", "Atendemos de lunes a sábado; dirección en el sitio"],
      ["pago", "Puede pagar con tarjeta o en efectivo"],
      ["cita-medica", "Su cita con el MÉDICO es mañana"],
    ] as const) {
      await sendo.snippets.upsert({ shortcut, body }, { actor });
    }
    const snippets = await sendo.snippets.list({ actor });
    const shortcuts = (query: string) => searchSnippets(snippets, query).map((s) => s.shortcut);

    expect(shortcuts("Dirección")).toEqual(["direccion", "horario"]);
    expect(shortcuts("/dir")).toEqual(["direccion", "horario"]);
    expect(shortcuts("medico")).toEqual(["cita-medica"]);
    expect(shortcuts("SABADO")).toEqual(["horario"]);
    expect(shortcuts("tarjeta efectivo")).toEqual(["pago"]);
    expect(shortcuts("tarjeta sábado")).toEqual([]);
    expect(shortcuts("  ")).toEqual(["cita-medica", "direccion", "horario", "pago"]);
  });
});

describe("sendo.snippets.render (AC-SN-3)", () => {
  async function withSnippet(
    body: string,
    options: { resolveSnippetVariables?: ResolveSnippetVariables } = {},
  ) {
    const s = await setup(options);
    const snippet = await s.sendo.snippets.upsert(
      { shortcut: "plantilla", body },
      { actor: s.actors.alma },
    );
    return { ...s, snippet };
  }

  it("[AC-SN-3a] fills nombre, telefono and the rendering user's name", async () => {
    const { sendo, actors, snippet, conversation } = await withSnippet(
      "Hola {{nombre}} ({{ telefono }}), le atiende {{agente}}.",
    );
    await expect(
      sendo.snippets.render(snippet.id, { actor: actors.luis, conversationId: conversation.id }),
    ).resolves.toEqual({
      text: `Hola ${FIXTURE_IDS.profileName} (+${FIXTURE_IDS.waId}), le atiende Luis Gómez.`,
      unresolved: [],
    });
  });

  it("[AC-SN-3b] merges the app's variables over the built-ins", async () => {
    const seen: unknown[] = [];
    const { sendo, actors, snippet, conversation, account } = await withSnippet(
      "{{nombre}}, su saldo es {{saldo}}.",
      {
        resolveSnippetVariables: (input) => {
          seen.push(input);
          return Promise.resolve({ saldo: "Q 120.00", nombre: "Sra. Pérez" });
        },
      },
    );
    await expect(
      sendo.snippets.render(snippet.id, { actor: actors.alma, conversationId: conversation.id }),
    ).resolves.toEqual({ text: "Sra. Pérez, su saldo es Q 120.00.", unresolved: [] });
    expect(seen).toEqual([
      {
        contact: expect.objectContaining({ id: conversation.contactId }) as unknown,
        conversation: expect.objectContaining({ id: conversation.id }) as unknown,
        account: expect.objectContaining({ id: account.id }) as unknown,
      },
    ]);
  });

  it("[AC-SN-3c] unknown, blank and unnamed-user variables stay as written and are listed once", async () => {
    const { sendo, actors, snippet, conversation } = await withSnippet(
      "{{saldo}} / {{vacio}} / {{agente}} / {{saldo}} / {{nombre}} / {{Mal}}",
      { resolveSnippetVariables: () => Promise.resolve({ vacio: "  " }) },
    );
    await expect(
      sendo.snippets.render(snippet.id, { actor: actors.sofia, conversationId: conversation.id }),
    ).resolves.toEqual({
      text: `{{saldo}} / {{vacio}} / {{agente}} / {{saldo}} / ${FIXTURE_IDS.profileName} / {{Mal}}`,
      unresolved: ["saldo", "vacio", "agente"],
    });
  });

  it("[AC-SN-3d] a failing app hook is logged and leaves only its variables unresolved", async () => {
    const { sendo, actors, snippet, conversation, logs } = await withSnippet(
      "Hola {{nombre}}, saldo {{saldo}}",
      { resolveSnippetVariables: () => Promise.reject(new Error("billing API down")) },
    );
    await expect(
      sendo.snippets.render(snippet.id, { actor: actors.alma, conversationId: conversation.id }),
    ).resolves.toEqual({
      text: `Hola ${FIXTURE_IDS.profileName}, saldo {{saldo}}`,
      unresolved: ["saldo"],
    });
    expect(logs.of("warn").join("\n")).toMatch(/resolveSnippetVariables failed.*billing API down/);
  });

  it("[AC-SN-3e] rendering needs the conversation to be visible to the actor", async () => {
    const { sendo, adapter, actors, snippet, conversation } = await withSnippet("Hola {{nombre}}");
    await adapter.conversations.update(conversation.id, { assignedTo: "marta" });
    const error = await rejection(
      sendo.snippets.render(snippet.id, { actor: actors.luis, conversationId: conversation.id }),
      ForbiddenError,
    );
    expect(error.message).not.toContain(FIXTURE_IDS.profileName);
    await rejection(
      sendo.snippets.render(snippet.id, { actor: actors.bruno, conversationId: conversation.id }),
      ForbiddenError,
    );
    await rejection(
      sendo.snippets.render(snippet.id, { actor: actors.alma, conversationId: "nope" }),
      RecordNotFoundError,
    );
    await expect(
      sendo.snippets.render(snippet.id, { actor: actors.marta, conversationId: conversation.id }),
    ).resolves.toMatchObject({ unresolved: [] });
  });
});

describe("sendo.tags (AC-TG-1, TG-4)", () => {
  it("[AC-TG-1a] only admins change the catalog or read usage; every role lists it", async () => {
    const { sendo, actors } = await setup();
    const tag = await sendo.tags.upsert({ name: "VIP", color: "violet" }, { actor: actors.alma });
    expect(tag).toMatchObject({ tenantId: "tenant-a", name: "VIP", color: "violet" });

    for (const actor of [actors.luis, actors.sofia]) {
      await expect(sendo.tags.list({ actor })).resolves.toEqual([tag]);
      for (const attempt of [
        () => sendo.tags.upsert({ name: "Urgente", color: "red" }, { actor }),
        () => sendo.tags.upsert({ id: tag.id, name: "VIP+", color: "violet" }, { actor }),
        () => sendo.tags.delete(tag.id, { actor }),
        () => sendo.tags.usage(tag.id, { actor }),
      ]) {
        const error = await rejection(attempt(), ForbiddenError);
        expect(error.capability).toBe("tags.manage");
      }
    }
    await expect(
      sendo.tags.upsert(
        { id: tag.id, name: "Cliente VIP", color: "amber" },
        { actor: actors.alma },
      ),
    ).resolves.toEqual({ ...tag, name: "Cliente VIP", color: "amber" });
  });

  it("[AC-TG-1b] a name taken in the tenant (ignoring case) is a typed error that says what to do", async () => {
    const { sendo, actors } = await setup();
    await sendo.tags.upsert({ name: "Urgente", color: "red" }, { actor: actors.alma });
    const other = await sendo.tags.upsert({ name: "Pago", color: "green" }, { actor: actors.alma });
    for (const attempt of [
      () => sendo.tags.upsert({ name: "  URGENTE ", color: "orange" }, { actor: actors.alma }),
      () =>
        sendo.tags.upsert(
          { id: other.id, name: "urgente", color: "green" },
          { actor: actors.alma },
        ),
    ]) {
      const error = await rejection(attempt(), ConstraintViolationError);
      expect(error.toJSON()).toMatchObject({
        code: "CONSTRAINT_VIOLATION",
        constraint: "sendo_tags_name_key",
      });
      expect(error.message).toMatch(
        /already exists.*Use the existing tag or choose a different name/,
      );
    }
    await expect(
      sendo.tags.upsert({ name: "urgente", color: "red" }, { actor: actors.bruno }),
    ).resolves.toMatchObject({ tenantId: "tenant-b" });
  });

  it("[AC-TG-1c] the color comes from the palette and the name is 1–64 characters", async () => {
    const { sendo, actors } = await setup();
    const actor = actors.alma;
    const cases: [{ name: string; color: string }, string][] = [
      [{ name: "VIP", color: "purple" }, "color"],
      [{ name: "VIP", color: "#ff0000" }, "color"],
      [{ name: "   ", color: "gray" }, "name"],
      [{ name: "x".repeat(65), color: "gray" }, "name"],
    ];
    for (const [input, field] of cases) {
      const error = await rejection(
        sendo.tags.upsert(input as Parameters<typeof sendo.tags.upsert>[0], { actor }),
        PayloadValidationError,
      );
      expect(error.field).toBe(field);
    }
    await expect(sendo.tags.list({ actor })).resolves.toEqual([]);
    await expect(
      sendo.tags.upsert({ name: "  Seguimiento  ", color: "teal" }, { actor }),
    ).resolves.toMatchObject({ name: "Seguimiento" });
  });

  it("[AC-TG-1d] another tenant's tags are invisible and untouchable", async () => {
    const { sendo, actors } = await setup();
    const theirs = await sendo.tags.upsert({ name: "VIP", color: "pink" }, { actor: actors.bruno });
    await expect(sendo.tags.list({ actor: actors.alma })).resolves.toEqual([]);
    for (const attempt of [
      () =>
        sendo.tags.upsert({ id: theirs.id, name: "Mío", color: "pink" }, { actor: actors.alma }),
      () => sendo.tags.delete(theirs.id, { actor: actors.alma }),
      () => sendo.tags.usage(theirs.id, { actor: actors.alma }),
    ]) {
      await rejection(attempt(), RecordNotFoundError);
    }
    await expect(sendo.tags.list({ actor: actors.bruno })).resolves.toEqual([theirs]);
  });

  it("[AC-TG-4] usage counts conversations; delete removes the tag from all of them", async () => {
    const { sendo, adapter, actors, conversation, account, deliver } = await setup();
    await deliver(
      freshFixture("text", (json) =>
        json
          .replaceAll(FIXTURE_IDS.waId, FIXTURE_IDS.secondWaId)
          .replace("wamid.TEXT0001", "wamid.SECOND01"),
      ),
    );
    const conversations = [...adapter.__state.conversations.values()].filter(
      (c) => c.accountId === account.id,
    );
    expect(conversations).toHaveLength(2);
    const tag = await sendo.tags.upsert({ name: "Moroso", color: "red" }, { actor: actors.alma });
    const keep = await sendo.tags.upsert({ name: "VIP", color: "blue" }, { actor: actors.alma });
    await expect(sendo.tags.usage(tag.id, { actor: actors.alma })).resolves.toBe(0);
    for (const c of conversations)
      await adapter.tags.addToConversation(c.id, tag.id, { by: "alma" });
    await adapter.tags.addToConversation(conversation.id, keep.id);
    await expect(sendo.tags.usage(tag.id, { actor: actors.alma })).resolves.toBe(2);

    await sendo.tags.delete(tag.id, { actor: actors.alma });
    const byConversation = await adapter.tags.forConversations(conversations.map((c) => c.id));
    expect(
      Object.values(byConversation)
        .flat()
        .map((t) => t.name),
    ).toEqual(["VIP"]);
    await expect(sendo.tags.list({ actor: actors.luis })).resolves.toEqual([keep]);
    await rejection(sendo.tags.usage(tag.id, { actor: actors.alma }), RecordNotFoundError);
    await rejection(sendo.tags.delete(tag.id, { actor: actors.alma }), RecordNotFoundError);
  });
});
