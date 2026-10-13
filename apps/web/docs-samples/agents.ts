import { HANDOFF_TOOL_NAME, agentTool } from "@quami/sendo";
import { z } from "zod";
import { sendo } from "./sendo";

// #region tool
const agendarCita = agentTool({
  description: "Agenda una cita para el paciente vinculado a esta conversación",
  input: z.object({ fecha: z.iso.date(), hora: z.string().regex(/^\d{2}:\d{2}$/) }),
  // `input` is already validated (and typed) by the zod schema.
  async run({ input, contact, account }) {
    // Authorize inside the tool: only act on the entity linked to THIS contact.
    if (contact.appRef === null) {
      return { error: "Paciente no identificado. Pide su número de DPI." };
    }
    return bookAppointment({
      tenantId: account.tenantId,
      patientId: contact.appRef,
      date: input.fecha,
      time: input.hora,
    });
  },
});
// #endregion tool

// #region agent
const handle = sendo.agent({
  name: "recepcion",
  // Only numbers of tenants with the feature on (or a list of account / phone number ids).
  accounts: (account) => account.tenantId !== null,
  model: "openai/gpt-5-mini",
  instructions: async ({ contact, account }) =>
    `Eres la recepción de ${await clinicName(account.tenantId)}. ` +
    `Atiende a ${contact.profileName ?? "el paciente"} en español, en mensajes breves.`,
  tools: { agendar_cita: agendarCita },
  handoff: {
    when: "pide hablar con una persona, tiene una urgencia o está molesto",
    to: "recepcion",
    message: "Te comunico con una persona del equipo.", // null sends nothing
  },
  historyLimit: 20,
  maxStepsPerTurn: 5,
  maxMessagesPerMinutePerContact: 10,
  fallbackMessage: null,
  vision: true,
  timezone: "America/Guatemala",
});

console.log(handle.name, HANDOFF_TOOL_NAME); // "recepcion", "transferir_a_humano"
handle.remove(); // unregister
// #endregion agent

async function bookAppointment(_input: {
  tenantId: string | null;
  patientId: string;
  date: string;
  time: string;
}) {
  return { ok: true };
}
async function clinicName(_tenantId: string | null) {
  return "Clínica Central";
}
