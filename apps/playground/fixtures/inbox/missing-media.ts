import type { FixtureConversation } from "../types";

/** An inbound image whose download failed twice (`download_status = failed`). */
export const missingMedia: FixtureConversation = {
  key: "media-faltante",
  contact: { phone: "+50255551005", profileName: "Jorge Ixcot" },
  status: "agent",
  messages: [
    { direction: "in", minutesAgo: 9, text: "Le mando la foto de mi receta" },
    {
      direction: "in",
      minutesAgo: 8,
      type: "image",
      text: "Receta",
      content: { mediaId: "300000000009999", mimeType: "image/jpeg", caption: "Receta" },
      media: { mimeType: "image/jpeg", downloadStatus: "failed" },
    },
    {
      direction: "in",
      minutesAgo: 7,
      type: "image",
      text: null,
      content: { mediaId: "300000000009998", mimeType: "image/png" },
      media: { mimeType: "image/png", downloadStatus: "done", sizeBytes: 68 },
    },
  ],
};
