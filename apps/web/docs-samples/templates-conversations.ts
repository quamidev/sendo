import { wa } from "./whatsapp";

export async function examples(conversationId: string, userId: string) {
  // #region templates
  // Pull approved templates from Meta into wa_templates (run after creating or editing one).
  await wa.templates.sync(); // every active account, or { account }
  const templates = await wa.templates.list({ status: "APPROVED" });
  console.log(templates.map((t) => `${t.name}/${t.language} (${t.variableCount} vars)`));
  // #endregion templates

  // #region conversations
  const conversation = await wa.conversations.get(conversationId); // null if unknown
  const { open, expiresAt } = await wa.conversations.windowStatus(conversationId);

  await wa.conversations.handoff(conversationId, { reason: "Pide hablar con una persona" });
  await wa.conversations.assign(conversationId, userId, { by: userId }); // also sets "human"
  await wa.conversations.returnToAgent(conversationId, { by: userId });
  await wa.conversations.close(conversationId, { by: userId });
  // #endregion conversations

  return { conversation, open, expiresAt };
}
