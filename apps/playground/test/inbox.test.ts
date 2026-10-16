/**
 * The installed inbox server actions end to end in fixtures mode: the real
 * `app/(protected)/inbox/actions.ts`, `sendo.actor` with the playground's `resolveRole`, the
 * memory adapter seeded from `fixtures/inbox/` (team.ts: drafts, pause, notes, 12 tags,
 * coexistence, `[#garita]`, a disconnected number) and the fake Graph API.
 *
 * [IB-UI-1] AC-TG-3 / Flow D 1: tabs, counts, "Asignadas a mí", tag any-match and search are
 *           applied server-side and agree with each other.
 * [IB-UI-2] AC-IB-3/6/7, AC-WG-4: a thread page carries notes, system lines, the phone-app echo,
 *           the `[#garita]` origin, the handoff (`by`, `at`) and the names of the people in it.
 * [IB-UI-3] AC-IB-4: approving an edited draft sends it as the agent, approved by the operator,
 *           and the conversation no longer has a pending draft.
 * [IB-UI-4] AC-IB-4: discarding the draft proposed before the handoff removes it.
 * [IB-UI-5] AC-IB-2: Reanudar resumes the paused agent and the thread records who did it.
 * [IB-UI-6] AC-IB-8: a disconnected number stays readable and replies come back ACCOUNT_INACTIVE.
 * [IB-UI-7] AC-TG-2: removing and adding tags returns the conversation's tags.
 * [IB-UI-8] AC-RL-4: a user without a role gets FORBIDDEN from every action.
 * [IB-UI-9] AC-IB-3: a note is stored internal, by the operator, never sent, and shows in the
 *           thread; a blank note is refused.
 * [IB-UI-10] AC-SN-1/2/3: the picker list is the team's plus the operator's own personal
 *           snippets usable on the conversation's number; rendering fills built-ins and the
 *           app's `saldo`, and leaves `{{fecha_limite}}` unresolved.
 * [IB-UI-11] AC-SN-1/4: snippets CRUD through the actions; a taken shortcut is CONFLICT.
 * [IB-UI-12] AC-TG-1/4: tag catalog CRUD; usage counts the conversations; deleting removes the
 *           tag from them; a taken name is CONFLICT.
 * [IB-UI-13] AC-DN-1: the default list ("All active numbers") leaves out conversations of a
 *           disconnected number; "Show disconnected", picking that number and search bring them
 *           back (marked `accountActive: false`), with counts that agree.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as ActionsModule from "@/app/(protected)/inbox/actions";
import type { InboxConversationView, InboxListInput } from "@/components/sendo/types";
import {
  FIXTURE_SNIPPETS,
  LONGEST_SHORTCUT,
  UNRESOLVED_SNIPPET,
  visibleToDevUser,
} from "@/fixtures/inbox";
import { FIXTURES_DEV_USER_ID, PLAYGROUND_TENANT_ID } from "@/lib/playground-env";

const user = { userId: FIXTURES_DEV_USER_ID, tenantId: PLAYGROUND_TENANT_ID };

vi.mock("@/lib/auth", () => ({
  requireUser: () => Promise.resolve({ ...user }),
}));

let actions: typeof ActionsModule;

async function listOf(input: InboxListInput) {
  const result = await actions.list(input);
  if (!result.ok) throw new Error(`list failed: ${result.code} ${result.message}`);
  return result.data;
}

async function conversation(name: string, tab: InboxListInput["tab"] = "open") {
  const page = await listOf({ tab, search: name });
  const found = page.items.find((item) => item.contact.displayName === name);
  if (found === undefined) throw new Error(`fixture ${name} not found`);
  return found;
}

async function threadOf(item: InboxConversationView) {
  const result = await actions.thread(item.id);
  if (!result.ok) throw new Error(`thread failed: ${result.code}`);
  return result.data;
}

beforeAll(async () => {
  vi.stubEnv("SENDO_PLAYGROUND_MODE", "fixtures");
  vi.stubEnv("SENDO_AGENT_MODEL", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
  actions = await import("@/app/(protected)/inbox/actions");
  await (
    await import("@/lib/sendo")
  ).playground.ready;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("inbox actions in fixtures mode", () => {
  it("[IB-UI-1] filters tabs, tags and search on the server, with matching counts", async () => {
    const open = await listOf({ tab: "open" });
    const counts = open.counts;
    if (counts === null) throw new Error("first page has counts");
    expect(open.items.every((item) => item.status !== "closed")).toBe(true);
    expect(counts.open).toBe(counts.agent + counts.human);
    expect(counts.closed).toBeGreaterThan(0);

    const mine = await listOf({ tab: "mine" });
    expect(mine.items.length).toBe(counts.mine);
    expect(mine.items.every((item) => item.assignedTo === FIXTURES_DEV_USER_ID)).toBe(true);

    const tags = await actions.listTags();
    if (!tags.ok) throw new Error("listTags failed");
    expect(tags.data).toHaveLength(12);
    const ids = tags.data
      .filter((tag) => tag.name === "visita" || tag.name === "mudanza")
      .map((tag) => tag.id);
    const tagged = await listOf({ tab: "open", tagIds: ids });
    expect(tagged.items.map((item) => item.contact.displayName).sort()).toEqual([
      "Aleksandra Wiśniewska-Kowalczyk",
      "Carlos Pérez",
    ]);
    expect(tagged.counts?.open).toBe(2);

    const search = await listOf({ tab: "open", search: "apto 4b" });
    expect(search.items.map((item) => item.contact.displayName)).toEqual(["María José Castillo"]);
  });

  it("[IB-UI-2] returns every message kind of the garita thread with names", async () => {
    const garita = await conversation("María José Castillo");
    expect(garita.source).toBe("garita");
    expect(garita.handoff?.by).toBe("agent:recepcion");
    expect(garita.assignee?.name).toBe("Ana López");
    const page = await threadOf(garita);
    const items = [...page.items].reverse();
    expect(items.find((message) => message.direction === "in")?.source).toBe("garita");
    expect(items.some((message) => message.internal && message.sender === "human")).toBe(true);
    expect(items.some((message) => message.systemLine?.kind === "rule")).toBe(true);
    expect(items.some((message) => message.origin === "business_app")).toBe(true);
    expect(page.names).toMatchObject({ "operador-2": "Javier Ruiz" });
    // Admins see the agent's cost.
    expect(items.some((message) => message.costCents !== null)).toBe(true);
  });

  it("[IB-UI-3] approves an edited draft as the agent, approved by the operator", async () => {
    const diego = await conversation("Diego Hernández");
    expect(diego.hasPendingDraft).toBe(true);
    const draft = (await threadOf(diego)).items.find((message) => message.draft);
    if (draft === undefined) throw new Error("fixture has a draft");

    const result = await actions.approveDraft(draft.id, "El plomero llega mañana a las 9:00.");
    if (!result.ok) throw new Error(`approve failed: ${result.code} ${result.message}`);
    expect(result.data).toMatchObject({
      id: draft.id,
      sender: "agent",
      draft: false,
      approvedBy: FIXTURES_DEV_USER_ID,
      edited: true,
      text: "El plomero llega mañana a las 9:00.",
    });
    expect((await conversation("Diego Hernández")).hasPendingDraft).toBe(false);
  });

  it("[IB-UI-4] discards the draft proposed before the handoff", async () => {
    const carlos = await conversation("Carlos Pérez");
    const draft = (await threadOf(carlos)).items.find((message) => message.draft);
    expect(draft?.handoffAfterDraft).toBe(true);
    if (draft === undefined) throw new Error("fixture has a draft");
    expect((await actions.discardDraft(draft.id)).ok).toBe(true);
    expect((await threadOf(carlos)).items.some((message) => message.draft)).toBe(false);
  });

  it("[IB-UI-5] resumes the paused agent and records the resume line", async () => {
    const lucia = await conversation("Lucía Morales");
    expect(lucia.agentPaused).toBe(true);
    expect(lucia.agentPausedOn).toBe("conversation");
    const result = await actions.pauseAgent(lucia.id, false);
    if (!result.ok) throw new Error(`resume failed: ${result.code}`);
    expect(result.data.agentPaused).toBe(false);
    const lines = (await threadOf(lucia)).items.map((message) => message.systemLine?.event);
    expect(lines).toContain("agent_resumed");
  });

  it("[IB-UI-6] keeps a disconnected number readable and refuses replies", async () => {
    const rosa = await conversation("Rosa Méndez");
    expect(rosa.accountActive).toBe(false);
    expect((await threadOf(rosa)).items.length).toBeGreaterThan(0);
    const reply = await actions.reply(rosa.id, { kind: "text", body: "Hola" });
    expect(reply.ok ? "ok" : reply.code).toBe("ACCOUNT_INACTIVE");
  });

  it("[IB-UI-7] removes and adds tags", async () => {
    const aleksandra = await conversation("Aleksandra Wiśniewska-Kowalczyk");
    expect(aleksandra.tags).toHaveLength(12);
    const vip = aleksandra.tags.find((tag) => tag.name === "vip");
    if (vip === undefined) throw new Error("fixture has vip");
    const removed = await actions.removeTag(aleksandra.id, vip.id);
    expect(removed.ok && removed.data.map((tag) => tag.name)).not.toContain("vip");
    const added = await actions.addTag(aleksandra.id, vip.id);
    expect(added.ok && added.data).toHaveLength(12);
  });

  it("[IB-UI-8] answers FORBIDDEN to a user without a role", async () => {
    user.userId = "stranger";
    try {
      const results = await Promise.all([
        actions.list({ tab: "open" }),
        actions.listTags(),
        actions.thread("any"),
        actions.take("any"),
      ]);
      expect(results.map((result) => (result.ok ? "ok" : result.code))).toEqual([
        "FORBIDDEN",
        "FORBIDDEN",
        "FORBIDDEN",
        "FORBIDDEN",
      ]);
    } finally {
      user.userId = FIXTURES_DEV_USER_ID;
    }
  });

  it("[IB-UI-9] stores a note for the team without sending it", async () => {
    const garita = await conversation("María José Castillo");
    const result = await actions.note(garita.id, "  Llamó a la oficina; paga el viernes.  ");
    if (!result.ok) throw new Error(`note failed: ${result.code} ${result.message}`);
    expect(result.data).toMatchObject({
      internal: true,
      sender: "human",
      senderRef: FIXTURES_DEV_USER_ID,
      status: "sent",
      metaMessageId: null,
      text: "Llamó a la oficina; paga el viernes.",
    });
    const thread = await threadOf(garita);
    expect(thread.items.some((message) => message.id === result.data.id)).toBe(true);
    const blank = await actions.note(garita.id, "   ");
    expect(blank.ok ? "ok" : blank.code).toBe("INVALID");
  });

  it("[IB-UI-10] lists the snippets of the conversation's number and renders variables", async () => {
    const garita = await conversation("María José Castillo");
    const listed = await actions.listSnippets(garita.id);
    if (!listed.ok) throw new Error(`listSnippets failed: ${listed.code}`);
    const shortcuts = listed.data.map((snippet) => snippet.shortcut);
    // Every-number snippets of the team plus the dev user's personal ones; not Javier's private
    // snippet, not the disconnected number's.
    expect(shortcuts).toHaveLength(
      FIXTURE_SNIPPETS.filter((each) => visibleToDevUser(each) && each.disconnectedOnly !== true)
        .length,
    );
    expect(shortcuts).toContain(LONGEST_SHORTCUT);
    expect(shortcuts).not.toContain("javier-privado");
    expect(shortcuts).not.toContain("garita-norte");
    expect(listed.data.find((snippet) => snippet.shortcut === "gracias")).toMatchObject({
      visibility: "personal",
      own: true,
    });
    const all = await actions.listSnippets(null);
    expect(all.ok && all.data.length).toBe(50);

    const planPagos = listed.data.find((snippet) => snippet.shortcut === UNRESOLVED_SNIPPET);
    if (planPagos === undefined) throw new Error("fixture has plan-pagos");
    const rendered = await actions.renderSnippet(planPagos.id, garita.id);
    if (!rendered.ok) throw new Error(`render failed: ${rendered.code}`);
    expect(rendered.data.unresolved).toEqual(["fecha_limite"]);
    expect(rendered.data.text).toContain(
      "María José Castillo, podemos dividir tu saldo de Q 2,450.00",
    );
    expect(rendered.data.text).toContain("antes del {{fecha_limite}}");
  });

  it("[IB-UI-11] creates, edits and deletes snippets; a taken shortcut is CONFLICT", async () => {
    const created = await actions.upsertSnippet({
      shortcut: "prueba-e2e",
      body: "Hola {{nombre}}",
      visibility: "personal",
      accountId: null,
    });
    if (!created.ok) throw new Error(`create failed: ${created.code} ${created.message}`);
    expect(created.data).toMatchObject({ visibility: "personal", own: true });

    const taken = await actions.upsertSnippet({
      shortcut: "saldo",
      body: "Otra",
      visibility: "tenant",
    });
    expect(taken.ok ? "ok" : taken.code).toBe("CONFLICT");
    const invalid = await actions.upsertSnippet({ shortcut: "/Con Espacios", body: "x" });
    expect(invalid.ok ? "ok" : invalid.code).toBe("INVALID");

    const edited = await actions.upsertSnippet({
      id: created.data.id,
      shortcut: "prueba-e2e",
      body: "Hola de nuevo {{nombre}}",
      visibility: "tenant",
    });
    expect(edited.ok && edited.data).toMatchObject({
      body: "Hola de nuevo {{nombre}}",
      visibility: "tenant",
    });

    expect((await actions.deleteSnippet(created.data.id)).ok).toBe(true);
    const after = await actions.listSnippets(null);
    expect(after.ok && after.data.some((snippet) => snippet.id === created.data.id)).toBe(false);
  });

  it("[IB-UI-12] manages the tag catalog and counts usage before deleting", async () => {
    const created = await actions.upsertTag({ name: "  Prueba E2E ", color: "teal" });
    if (!created.ok) throw new Error(`create failed: ${created.code} ${created.message}`);
    expect(created.data).toMatchObject({ name: "Prueba E2E", color: "teal" });

    const taken = await actions.upsertTag({ name: "VIP", color: "red" });
    expect(taken.ok ? "ok" : taken.code).toBe("CONFLICT");

    const renamed = await actions.upsertTag({ id: created.data.id, name: "Prueba", color: "pink" });
    expect(renamed.ok && renamed.data).toMatchObject({ name: "Prueba", color: "pink" });

    const garita = await conversation("María José Castillo");
    const lucia = await conversation("Lucía Morales");
    await actions.addTag(garita.id, created.data.id);
    await actions.addTag(lucia.id, created.data.id);
    const usage = await actions.tagUsage(created.data.id);
    expect(usage.ok && usage.data).toBe(2);

    expect((await actions.deleteTag(created.data.id)).ok).toBe(true);
    expect((await conversation("María José Castillo")).tags.map((tag) => tag.id)).not.toContain(
      created.data.id,
    );
    const tags = await actions.listTags();
    expect(tags.ok && tags.data).toHaveLength(12);
  });

  it("[IB-UI-13] keeps disconnected numbers out of the default view, but reachable", async () => {
    const isRosa = (item: InboxConversationView) => item.contact.displayName === "Rosa Méndez";
    const rosa = await conversation("Rosa Méndez");
    expect(rosa.accountActive).toBe(false);

    const byDefault = await listOf({ tab: "open" });
    expect(byDefault.items.some(isRosa)).toBe(false);
    expect(byDefault.items.every((item) => item.accountActive)).toBe(true);

    const withDisconnected = await listOf({ tab: "open", includeInactiveAccounts: true });
    expect(withDisconnected.items.filter(isRosa)).toHaveLength(1);
    expect(withDisconnected.counts?.open).toBe((byDefault.counts?.open ?? 0) + 1);

    const onlyThatNumber = await listOf({ tab: "open", accountId: rosa.accountId });
    expect(onlyThatNumber.items.map((item) => item.id)).toEqual([rosa.id]);
    expect(onlyThatNumber.counts?.open).toBe(1);
  });
});
