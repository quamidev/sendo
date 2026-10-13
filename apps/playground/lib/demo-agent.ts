import { agentTool, type AgentDefinition, type LinkContact } from "@quami/sendo";
import { z } from "zod";

export interface DemoAppointment {
  patientId: string;
  nombre: string;
  /** E.164. */
  telefono: string;
  fecha: string;
  medico: string;
}

/** Fake clinic data used by `buscar_cita` and `linkContact`. */
export const DEMO_APPOINTMENTS: readonly DemoAppointment[] = [
  {
    patientId: "pac_001",
    nombre: "Ana Pérez",
    telefono: "+50255550001",
    fecha: "2026-10-08 09:30",
    medico: "Dra. López",
  },
  {
    patientId: "pac_002",
    nombre: "Luis Hernández",
    telefono: "+50255550002",
    fecha: "2026-10-09 15:00",
    medico: "Dr. Morales",
  },
  {
    patientId: "pac_003",
    nombre: "María José Castillo",
    telefono: "+50255550003",
    fecha: "2026-10-12 11:15",
    medico: "Dra. López",
  },
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Matches by phone digits (at least 8) or by any word of the name. */
export function findAppointments(query: string): DemoAppointment[] {
  const digits = query.replace(/\D/g, "");
  const words = normalize(query)
    .split(/\s+/)
    .filter((word) => word.length >= 3);
  return DEMO_APPOINTMENTS.filter((appointment) => {
    if (digits.length >= 8 && appointment.telefono.replace(/\D/g, "").endsWith(digits.slice(-8))) {
      return true;
    }
    const name = normalize(appointment.nombre);
    return words.some((word) => name.split(" ").includes(word));
  });
}

export const linkDemoContact: LinkContact = ({ phone }) =>
  DEMO_APPOINTMENTS.find((appointment) => appointment.telefono === phone)?.patientId ?? null;

export const buscarCita = agentTool({
  description: "Busca las citas de un paciente por nombre o número de teléfono.",
  input: z.object({
    consulta: z.string().describe("Nombre del paciente o número de teléfono"),
  }),
  run: async ({ input, contact }) => {
    const byQuery = findAppointments(input.consulta);
    const matches = byQuery.length > 0 ? byQuery : findAppointments(contact.phone ?? "");
    if (matches.length === 0) return { encontrada: false };
    return {
      encontrada: true,
      citas: matches.map(({ nombre, fecha, medico }) => ({ nombre, fecha, medico })),
    };
  },
});

export function recepcionAgent(model: AgentDefinition["model"]): AgentDefinition {
  return {
    name: "recepcion",
    model,
    instructions:
      "Eres la recepcionista virtual de una clínica en Guatemala. Responde breve, amable y en español. " +
      "Usa buscar_cita cuando el paciente pregunte por su cita.",
    tools: { buscar_cita: buscarCita },
    handoff: {
      when: "el usuario pide hablar con una persona o está molesto",
      to: "recepcion",
    },
    fallbackMessage: "Lo siento, tuvimos un problema. Una persona del equipo te responderá pronto.",
  };
}
