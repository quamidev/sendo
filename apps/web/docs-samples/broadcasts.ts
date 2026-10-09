import { createSendo, type Actor } from "@quami/sendo";
import { memoryAdapter } from "@quami/sendo/adapters/memory";

declare const admin: Actor;
declare const patientContactId: string;

// #region config
const sendo = createSendo({
  adapter: memoryAdapter(),
  appSecret: process.env.SENDO_META_APP_SECRET ?? "",
  verifyToken: process.env.SENDO_VERIFY_TOKEN ?? "",
  resolveToken: (account) => process.env[account.tokenRef],
  // Optional: these are the defaults. `keywords: []` turns keyword opt-out off.
  optOut: {
    keywords: ["BAJA", "STOP", "ALTO", "CANCELAR"],
    confirmation:
      "Listo, ya no te enviaremos mensajes promocionales. Si cambias de opinión, escríbenos.",
  },
});
// #endregion config

// #region opt-in
// The contact said yes in your signup form: MARKETING broadcasts may reach them now.
await sendo.contacts.setOptIn(patientContactId, true, { source: "form" });

sendo.on("contact.opt_in", ({ contact, optIn, source, keyword }) => {
  // source "keyword" + keyword "baja" when they replied BAJA; mirror it in your own records.
  console.log(contact.id, optIn, source, keyword);
});
// #endregion opt-in

// #region preview
const input = {
  actor: admin,
  template: "recordatorio_cita",
  language: "es",
  recipients: [
    { phone: "+502 5555 0101", variables: ["Ana", "lunes 12"] },
    { contactId: patientContactId, variables: ["Luis", "martes 13"] },
  ],
  ratePerMinute: 60,
};
const preview = await sendo.broadcasts.preview(input);
// { total: 2, eligible: 2, skipped: { no_opt_in: 0, opted_out: 0, invalid_phone: 0 },
//   category: "UTILITY", ratePerMinute: 60, estimatedMinutes: 1, accountId: "…" }
// #endregion preview

// #region create
const broadcast = await sendo.broadcasts.create(input); // status "queued"; the tick sends it
const progress = await sendo.broadcasts.get(broadcast.id, { actor: admin });
// progress.counts → { pending, sent, delivered, read, failed, skipped, cancelled }
const failed = await sendo.broadcasts.recipients(broadcast.id, { actor: admin, status: "failed" });
// failed.items[0].error → { code: 131026, title: "Message undeliverable", message: "…" }
await sendo.broadcasts.cancel(broadcast.id, { actor: admin }); // pending → cancelled
// #endregion create

export { failed, preview, progress };
