import { AmbiguousAccountError } from "@quami/wa-li";
import { wa } from "./whatsapp";

export async function remindAppointment(tenantPhoneNumberId: string, patientPhone: string) {
  // #region account
  // With more than one active account, every send names its account:
  // the wa-li account id (uuid), the Meta phone_number_id, or the Account object.
  await wa.send.template(patientPhone, "recordatorio_cita", {
    account: tenantPhoneNumberId,
    language: "es",
    variables: ["Ana", "mañana 10:00"],
  });
  await wa.send.text(patientPhone, "Te esperamos.", { account: tenantPhoneNumberId });
  await wa.templates.sync({ account: tenantPhoneNumberId });
  // #endregion account

  // #region ambiguous
  try {
    await wa.send.text(patientPhone, "Hola"); // no account
  } catch (error) {
    if (error instanceof AmbiguousAccountError) console.error(error.candidates); // account ids
  }
  // #endregion ambiguous
}

// #region reply
// Replies to inbound messages go out from the number that received them.
wa.on("message", async ({ account, reply }) => {
  console.log("received on", account.displayPhone, "tenant", account.tenantId);
  await reply.text("Recibido");
});
// #endregion reply

// #region agents
const model = "openai/gpt-5-mini";
const surTenantId = "6f1c0c3e-0000-4000-8000-000000000002";

wa.agent({ name: "norte", accounts: ["111111111111111"], model, instructions: "…" });
wa.agent({
  name: "sur",
  accounts: (account) => account.tenantId === surTenantId,
  model,
  instructions: "…",
});
// #endregion agents
