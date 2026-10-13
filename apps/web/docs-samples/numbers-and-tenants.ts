import { AccountStateError, AmbiguousAccountError } from "@quami/sendo";
import { sendo } from "./sendo";

export async function remindAppointment(tenantId: string, patientPhone: string) {
  // #region tenant
  // Goes out from the organization's default number. No account ids to pass around.
  await sendo.send.template(patientPhone, "recordatorio_cita", {
    tenant: tenantId,
    language: "es",
    variables: ["Ana", "mañana 10:00"],
  });
  await sendo.send.text(patientPhone, "Te esperamos.", { tenant: tenantId });
  await sendo.templates.sync({ tenant: tenantId }); // every active number of the tenant
  // #endregion tenant

  // #region ambiguous
  try {
    await sendo.send.text(patientPhone, "Hola", { tenant: tenantId });
  } catch (error) {
    // Two or more active numbers in the tenant and none is the default.
    if (error instanceof AmbiguousAccountError) console.error(error.tenantId, error.candidates);
  }
  // #endregion ambiguous
}

export async function manageNumbers(tenantId: string) {
  // #region manage
  const numbers = await sendo.accounts.list({ tenant: tenantId, includeInactive: true });
  const added = await sendo.accounts.add({
    tenantId,
    phoneNumberId: "333333333333333",
    wabaId: "444444444444444",
    displayPhone: "+502 5555 3333",
    tokenRef: "SENDO_TOKEN_CLINICA_ESTE", // env var NAME, never the token
    label: "Recepción",
  }); // the tenant's first number becomes its default
  await sendo.accounts.setDefault(added.id); // atomic swap within the tenant
  await sendo.accounts.setLabel(added.id, "Recepción principal");
  await sendo.accounts.pauseAgent(added.id, true, { by: "user_123" });
  await sendo.accounts.setAgentMode(added.id, "draft"); // null = the agent's own mode
  // #endregion manage
  return numbers;
}

export async function offboard(accountId: string) {
  // #region disconnect
  // Stops sending and routing, keeps the history readable, promotes the tenant's
  // only remaining number to default, calls deleteToken(tokenRef).
  await sendo.accounts.disconnect(accountId, { by: "user_123" });

  // Later, when the organization asks for its data to be deleted:
  try {
    await sendo.accounts.purge(accountId); // rows + media objects, no undo
  } catch (error) {
    if (error instanceof AccountStateError) console.error("Disconnect it first");
  }
  // #endregion disconnect
}

// #region events
sendo.on("account.default", ({ tenantId, account, previous }) => {
  console.log(
    "default of",
    tenantId,
    "is now",
    account?.displayPhone ?? "none",
    "was",
    previous?.id,
  );
});
sendo.on("account.disconnected", ({ account, by }) => {
  console.log(account.displayPhone, "disconnected by", by);
});
// #endregion events

// #region agents
// One definition for every organization: the tenant comes from the conversation's number.
const clinics = new Map([
  ["6f1c0c3e-0000-4000-8000-000000000001", { name: "Clínica Norte", hours: "8:00 a 17:00" }],
  ["6f1c0c3e-0000-4000-8000-000000000002", { name: "Clínica Sur", hours: "9:00 a 13:00" }],
]);

sendo.agent({
  name: "recepcion",
  tenants: (tenantId) => tenantId !== null && clinics.has(tenantId), // or a list of tenant ids
  model: "openai/gpt-5-mini",
  instructions: ({ account }) => {
    const clinic = clinics.get(account.tenantId ?? "");
    return `Eres la recepción de ${clinic?.name ?? "la clínica"}. Horario: ${clinic?.hours ?? "consultar"}.`;
  },
});

// A different agent for one organization: lists that overlap throw ConfigError at registration.
sendo.agent({
  name: "recepcion-pediatria",
  tenants: ["6f1c0c3e-0000-4000-8000-000000000003"],
  model: "openai/gpt-5-mini",
  instructions: "Eres la recepción de la clínica pediátrica.",
});
// #endregion agents
