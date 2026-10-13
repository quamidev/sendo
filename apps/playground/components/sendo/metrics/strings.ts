import { formatInteger } from "./format";

const count = (n: number, one: string, many: string): string =>
  `${formatInteger(n)} ${n === 1 ? one : many}`;

/** Every text of the `metrics` item. Override any of them through the `strings` prop. */
export interface MetricsStrings {
  pageTitle: string;
  pageDescription: string;
  backToInbox: string;
  forbiddenTitle: string;
  forbiddenBody: string;
  noNumbersTitle: string;
  noNumbersBody: string;
  loadError: string;
  retry: string;
  updating: string;
  showAll: (count: number) => string;
  showLess: string;

  filtersLabel: string;
  rangeLabel: string;
  presetDays: (days: number) => string;
  customRange: string;
  fromLabel: string;
  toLabel: string;
  apply: string;
  rangeInvalid: string;
  rangeTooLong: (max: number) => string;
  numberLabel: string;
  allNumbers: string;
  disconnected: string;
  tagsLabel: string;
  allTags: string;
  tagsSelected: (count: number) => string;
  clearTags: string;
  timezoneNote: (timeZone: string) => string;

  kpiMessages: string;
  kpiMessagesDetail: (inbound: number, outbound: number) => string;
  kpiConversations: string;
  kpiConversationsDetail: (unanswered: number) => string;
  kpiFirstResponse: string;
  kpiFirstResponseDetail: (team: string) => string;
  kpiAiResolved: string;
  kpiAiResolvedDetail: (resolved: number, closed: number) => string;
  noValue: string;

  volumeTitle: string;
  volumeDescription: string;
  seriesInbound: string;
  seriesOutbound: string;
  seriesConversations: string;
  showTable: string;
  showChart: string;
  dayColumn: string;
  chartEmpty: string;
  chartLabel: (title: string, from: string, to: string) => string;

  assigneesTitle: string;
  assigneesDescription: string;
  assigneeColumn: string;
  conversationDaysColumn: string;
  messagesColumn: string;
  firstResponsesColumn: string;
  medianColumn: string;
  assigneesEmpty: string;
  businessApp: string;
  unknownUser: (id: string) => string;
  unidentifiedPerson: string;

  sourcesTitle: string;
  sourcesDescription: string;
  sourceColumn: string;
  conversationsColumn: string;
  shareColumn: string;
  directSource: string;
  sourcesEmpty: string;

  tagsTitle: string;
  tagsDescription: string;
  tagColumn: string;
  closedColumn: string;
  aiResolvedColumn: string;
  untagged: string;
  tagsEmpty: string;

  costTitle: string;
  costDescription: string;
  costTotal: (amount: string) => string;
  costPerDayTitle: string;
  seriesCost: string;
  costPerAgentTitle: string;
  agentColumn: string;
  costColumn: string;
  turnsColumn: string;
  tokensColumn: string;
  unnamedAgent: string;
  costEmpty: string;
}

export const defaultMetricsStrings: MetricsStrings = {
  pageTitle: "Métricas",
  pageDescription: "Volumen, tiempos de respuesta y resolución de tu bandeja de WhatsApp.",
  backToInbox: "Volver a la bandeja",
  forbiddenTitle: "No tienes acceso a Métricas",
  forbiddenBody: "Solo supervisores y administradores pueden ver las métricas de la bandeja.",
  noNumbersTitle: "Todavía no hay números",
  noNumbersBody: "Conecta un número de WhatsApp para empezar a medir conversaciones.",
  loadError: "No se pudieron cargar las métricas.",
  retry: "Reintentar",
  updating: "Actualizando…",
  showAll: (count) => `Mostrar los ${String(count)}`,
  showLess: "Mostrar menos",

  filtersLabel: "Filtros",
  rangeLabel: "Periodo",
  presetDays: (days) => (days === 1 ? "Hoy" : `${String(days)} días`),
  customRange: "Personalizado",
  fromLabel: "Desde",
  toLabel: "Hasta",
  apply: "Aplicar",
  rangeInvalid: "La fecha final no puede ser anterior a la inicial.",
  rangeTooLong: (max) => `Elige un periodo de ${String(max)} días o menos.`,
  numberLabel: "Número",
  allNumbers: "Todos los números",
  disconnected: "desconectado",
  tagsLabel: "Etiquetas",
  allTags: "Todas las etiquetas",
  tagsSelected: (count) => (count === 1 ? "1 etiqueta" : `${String(count)} etiquetas`),
  clearTags: "Quitar filtro",
  timezoneNote: (timeZone) => `Días en la zona horaria ${timeZone}.`,

  kpiMessages: "Mensajes",
  kpiMessagesDetail: (inbound, outbound) =>
    `${count(inbound, "recibido", "recibidos")} · ${count(outbound, "enviado", "enviados")}`,
  kpiConversations: "Conversaciones nuevas",
  kpiConversationsDetail: (unanswered) =>
    unanswered === 0 ? "Todas con respuesta" : `${formatInteger(unanswered)} sin respuesta`,
  kpiFirstResponse: "Primera respuesta (mediana)",
  kpiFirstResponseDetail: (team) => `Equipo: ${team}`,
  kpiAiResolved: "Resueltas por la IA",
  kpiAiResolvedDetail: (resolved, closed) =>
    closed === 0
      ? "Ninguna cerrada en el periodo"
      : `${formatInteger(resolved)} de ${count(closed, "cerrada", "cerradas")}`,
  noValue: "—",

  volumeTitle: "Mensajes por día",
  volumeDescription: "Recibidos y enviados al contacto. Notas internas y borradores no cuentan.",
  seriesInbound: "Recibidos",
  seriesOutbound: "Enviados",
  seriesConversations: "Conversaciones nuevas",
  showTable: "Ver tabla",
  showChart: "Ver gráfica",
  dayColumn: "Día",
  chartEmpty: "Sin mensajes en este periodo.",
  chartLabel: (title, from, to) =>
    `${title}, del ${from} al ${to}. Usa las flechas para recorrer los días.`,

  assigneesTitle: "Por persona",
  assigneesDescription: "Lo que respondió cada persona del equipo en el periodo.",
  assigneeColumn: "Persona",
  conversationDaysColumn: "Conversaciones",
  messagesColumn: "Mensajes",
  firstResponsesColumn: "Primeras respuestas",
  medianColumn: "Mediana 1.ª respuesta",
  assigneesEmpty: "Nadie del equipo respondió en este periodo.",
  businessApp: "App WhatsApp Business",
  unknownUser: (id) => `Usuario ${id}`,
  unidentifiedPerson: "Sin identificar",

  sourcesTitle: "Por origen",
  sourcesDescription: "Conversaciones nuevas según el enlace o anuncio por el que llegaron.",
  sourceColumn: "Origen",
  conversationsColumn: "Conversaciones",
  shareColumn: "Porcentaje",
  directSource: "Directo",
  sourcesEmpty: "Sin conversaciones nuevas en este periodo.",

  tagsTitle: "Por etiqueta",
  tagsDescription:
    "Conversaciones con mensajes del contacto en el periodo, según sus etiquetas actuales.",
  tagColumn: "Etiqueta",
  closedColumn: "Cerradas",
  aiResolvedColumn: "Resueltas por IA",
  untagged: "Sin etiqueta",
  tagsEmpty: "Sin conversaciones en este periodo.",

  costTitle: "Costo de la IA",
  costDescription: "Costo de los modelos por día y por agente. Solo lo ven administradores.",
  costTotal: (amount) => `Total del periodo: ${amount}`,
  costPerDayTitle: "Costo por día",
  seriesCost: "Costo",
  costPerAgentTitle: "Por agente",
  agentColumn: "Agente",
  costColumn: "Costo",
  turnsColumn: "Turnos",
  tokensColumn: "Tokens (entrada / salida)",
  unnamedAgent: "Sin nombre",
  costEmpty: "La IA no tuvo costo registrado en este periodo.",
};

export function resolveMetricsStrings(overrides?: Partial<MetricsStrings>): MetricsStrings {
  return overrides ? { ...defaultMetricsStrings, ...overrides } : defaultMetricsStrings;
}
