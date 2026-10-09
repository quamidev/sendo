import { createSendo, searchSnippets, type Actor, type Snippet } from "@quami/sendo";
import { memoryAdapter } from "@quami/sendo/adapters/memory";

declare function findBalance(appRef: string | null): Promise<string | null>;

// #region config
const sendo = createSendo({
  adapter: memoryAdapter(),
  appSecret: process.env.SENDO_META_APP_SECRET ?? "",
  verifyToken: process.env.SENDO_VERIFY_TOKEN ?? "",
  resolveToken: (account) => process.env[account.tokenRef],
  resolveRole: () => Promise.resolve({ role: "admin" }),
  // App values for snippets, merged over the built-ins {{nombre}}, {{telefono}} and {{agente}}.
  // Leave a variable out (or blank) and it stays highlighted in the composer, blocking the send.
  resolveSnippetVariables: async ({ contact }) => {
    const values: Record<string, string> = {};
    const saldo = await findBalance(contact.appRef);
    if (saldo !== null) values.saldo = saldo;
    return values;
  },
});
// #endregion config

declare const admin: Actor;
declare const conversationId: string;
declare const accountId: string;

// #region snippets
// A team snippet (admins: `snippets.manage_tenant`); anyone can create `visibility: "personal"`.
const saldo = await sendo.snippets.upsert(
  {
    shortcut: "saldo",
    body: "Hola {{nombre}}, tu saldo pendiente es de {{saldo}}. Vence el {{fecha_limite}}.",
  },
  { actor: admin },
);

// The picker list: team snippets plus the actor's personal ones, usable on this number.
const usable: Snippet[] = await sendo.snippets.list({ actor: admin, accountId });
const matches = searchSnippets(usable, "/sal"); // accent- and case-insensitive

// Filled for one conversation. Variables without a value stay as written and are listed.
const filled = await sendo.snippets.render(saldo.id, { actor: admin, conversationId });
// filled.text       → "Hola María José, tu saldo pendiente es de Q 2,450.00. Vence el {{fecha_limite}}."
// filled.unresolved → ["fecha_limite"]
// #endregion snippets

// #region tags
const urgente = await sendo.tags.upsert({ name: "urgente", color: "red" }, { actor: admin });
await sendo.inbox.tags.add(conversationId, urgente.id, { actor: admin });
const catalog = await sendo.tags.list({ actor: admin }); // every role can read the catalog
const using = await sendo.tags.usage(urgente.id, { actor: admin }); // ask before deleting
await sendo.tags.delete(urgente.id, { actor: admin }); // also removes it from every conversation
// #endregion tags

export { catalog, filled, matches, using };
