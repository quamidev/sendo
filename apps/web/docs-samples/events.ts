import { sendo } from "./sendo";

// #region on
const unsubscribe = sendo.on("message", async ({ message, contact, conversation, reply }) => {
  if (message.type === "text" && message.text?.trim().toLowerCase() === "menu") {
    await reply.buttons({
      body: `Hola ${contact.profileName ?? ""}, ¿qué necesitas?`,
      buttons: [
        { id: "cita", title: "Agendar cita" },
        { id: "humano", title: "Hablar con alguien" },
      ],
    });
  }
  if (message.media?.downloadStatus === "done") {
    console.log("stored at", message.media.storagePath, "in", conversation.id);
  }
});

sendo.on("status", ({ message, status, error }) => {
  if (status === "failed") console.warn("send failed", message.id, error?.code, error?.message);
});

sendo.on("handoff", async ({ conversation, assignees, reason }) => {
  await notifyStaff(assignees, `Conversación ${conversation.id}: ${reason}`);
});

sendo.on("conversation.status", ({ conversation, from, to, by }) => {
  console.log(conversation.id, from, "→", to, "by", by);
});

sendo.on("account.error", ({ account, error }) => {
  if (error.isInvalidToken) console.error(`Token ${account.tokenRef} expired or was revoked`);
});

sendo.on("event.unrouted", ({ phoneNumberId }) => {
  console.warn("Webhook for an unknown phone_number_id", phoneNumberId);
});

unsubscribe(); // stop listening
// #endregion on

async function notifyStaff(_userIds: string[], _text: string) {}
