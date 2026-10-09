import { sendo } from "./sendo";

export async function examples(conversationId: string, userId: string) {
  // #region templates
  // Pull approved templates from Meta into sendo_templates (run after creating or editing one).
  await sendo.templates.sync(); // every active account, or { account }
  const templates = await sendo.templates.list({ status: "APPROVED" });
  console.log(templates.map((t) => `${t.name}/${t.language} (${t.variableCount} vars)`));
  // #endregion templates

  // #region conversations
  const conversation = await sendo.conversations.get(conversationId); // null if unknown
  const { open, expiresAt } = await sendo.conversations.windowStatus(conversationId);

  await sendo.conversations.handoff(conversationId, { reason: "Pide hablar con una persona" });
  await sendo.conversations.assign(conversationId, userId, { by: userId }); // also sets "human"
  await sendo.conversations.returnToAgent(conversationId, { by: userId });
  await sendo.conversations.close(conversationId, { by: userId });
  // #endregion conversations

  return { conversation, open, expiresAt };
}
