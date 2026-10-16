import type { SendoLocale } from "@/lib/sendo-ui";
import type { MetricsFormat } from "./format";

/** "3 received": the count and the plural form that goes with it. */
const count = (format: MetricsFormat, n: number, one: string, other: string): string =>
  `${format.integer(n)} ${format.plural(n, { one, other })}`;

/**
 * Every text of the `metrics` item, one object per `SendoLocale`. Override single keys through
 * `<MetricsScreen strings>`. Functions that show a count get `format` (the screen's
 * `formatLocale`), so numbers and plurals follow the locale.
 */
export interface MetricsStrings {
  /** The page `<title>` (`generateMetadata` in page.tsx) and the screen heading. */
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
  showAll: (count: number, format: MetricsFormat) => string;
  showLess: string;

  filtersLabel: string;
  rangeLabel: string;
  presetDays: (days: number, format: MetricsFormat) => string;
  customRange: string;
  fromLabel: string;
  toLabel: string;
  apply: string;
  rangeInvalid: string;
  rangeTooLong: (max: number, format: MetricsFormat) => string;
  numberLabel: string;
  allNumbers: string;
  disconnected: string;
  tagsLabel: string;
  allTags: string;
  tagsSelected: (count: number, format: MetricsFormat) => string;
  clearTags: string;
  timezoneNote: (timeZone: string) => string;

  kpiMessages: string;
  kpiMessagesDetail: (inbound: number, outbound: number, format: MetricsFormat) => string;
  kpiConversations: string;
  kpiConversationsDetail: (unanswered: number, format: MetricsFormat) => string;
  kpiFirstResponse: string;
  kpiFirstResponseDetail: (team: string) => string;
  kpiAiResolved: string;
  kpiAiResolvedDetail: (resolved: number, closed: number, format: MetricsFormat) => string;
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

const es: MetricsStrings = {
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
  showAll: (count, format) => `Mostrar los ${format.integer(count)}`,
  showLess: "Mostrar menos",

  filtersLabel: "Filtros",
  rangeLabel: "Periodo",
  presetDays: (days, format) => (days === 1 ? "Hoy" : count(format, days, "día", "días")),
  customRange: "Personalizado",
  fromLabel: "Desde",
  toLabel: "Hasta",
  apply: "Aplicar",
  rangeInvalid: "La fecha final no puede ser anterior a la inicial.",
  rangeTooLong: (max, format) =>
    `Elige un periodo de ${count(format, max, "día", "días")} o menos.`,
  numberLabel: "Número",
  allNumbers: "Todos los números",
  disconnected: "desconectado",
  tagsLabel: "Etiquetas",
  allTags: "Todas las etiquetas",
  tagsSelected: (n, format) => count(format, n, "etiqueta", "etiquetas"),
  clearTags: "Quitar filtro",
  timezoneNote: (timeZone) => `Días en la zona horaria ${timeZone}.`,

  kpiMessages: "Mensajes",
  kpiMessagesDetail: (inbound, outbound, format) =>
    `${count(format, inbound, "recibido", "recibidos")} · ${count(format, outbound, "enviado", "enviados")}`,
  kpiConversations: "Conversaciones nuevas",
  kpiConversationsDetail: (unanswered, format) =>
    unanswered === 0 ? "Todas con respuesta" : `${format.integer(unanswered)} sin respuesta`,
  kpiFirstResponse: "Primera respuesta (mediana)",
  kpiFirstResponseDetail: (team) => `Equipo: ${team}`,
  kpiAiResolved: "Resueltas por la IA",
  kpiAiResolvedDetail: (resolved, closed, format) =>
    closed === 0
      ? "Ninguna cerrada en el periodo"
      : `${format.integer(resolved)} de ${count(format, closed, "cerrada", "cerradas")}`,
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

const en: MetricsStrings = {
  pageTitle: "Metrics",
  pageDescription: "Volume, response times and resolution of your WhatsApp inbox.",
  backToInbox: "Back to inbox",
  forbiddenTitle: "You don't have access to Metrics",
  forbiddenBody: "Only supervisors and admins can see the inbox metrics.",
  noNumbersTitle: "No numbers yet",
  noNumbersBody: "Connect a WhatsApp number to start measuring conversations.",
  loadError: "Couldn't load the metrics.",
  retry: "Retry",
  updating: "Updating…",
  showAll: (count, format) => `Show all ${format.integer(count)}`,
  showLess: "Show less",

  filtersLabel: "Filters",
  rangeLabel: "Period",
  presetDays: (days, format) => (days === 1 ? "Today" : count(format, days, "day", "days")),
  customRange: "Custom",
  fromLabel: "From",
  toLabel: "To",
  apply: "Apply",
  rangeInvalid: "The end date can't be before the start date.",
  rangeTooLong: (max, format) => `Pick a period of ${count(format, max, "day", "days")} or fewer.`,
  numberLabel: "Number",
  allNumbers: "All numbers",
  disconnected: "disconnected",
  tagsLabel: "Tags",
  allTags: "All tags",
  tagsSelected: (n, format) => count(format, n, "tag", "tags"),
  clearTags: "Clear filter",
  timezoneNote: (timeZone) => `Days in the ${timeZone} time zone.`,

  kpiMessages: "Messages",
  kpiMessagesDetail: (inbound, outbound, format) =>
    `${format.integer(inbound)} received · ${format.integer(outbound)} sent`,
  kpiConversations: "New conversations",
  kpiConversationsDetail: (unanswered, format) =>
    unanswered === 0 ? "All answered" : `${format.integer(unanswered)} unanswered`,
  kpiFirstResponse: "First response (median)",
  kpiFirstResponseDetail: (team) => `Team: ${team}`,
  kpiAiResolved: "Resolved by AI",
  kpiAiResolvedDetail: (resolved, closed, format) =>
    closed === 0
      ? "None closed in the period"
      : `${format.integer(resolved)} of ${format.integer(closed)} closed`,
  noValue: "—",

  volumeTitle: "Messages per day",
  volumeDescription:
    "Received from and sent to the contact. Internal notes and drafts don't count.",
  seriesInbound: "Received",
  seriesOutbound: "Sent",
  seriesConversations: "New conversations",
  showTable: "Show table",
  showChart: "Show chart",
  dayColumn: "Day",
  chartEmpty: "No messages in this period.",
  chartLabel: (title, from, to) =>
    `${title}, from ${from} to ${to}. Use the arrow keys to move through the days.`,

  assigneesTitle: "By person",
  assigneesDescription: "What each team member answered in the period.",
  assigneeColumn: "Person",
  conversationDaysColumn: "Conversations",
  messagesColumn: "Messages",
  firstResponsesColumn: "First responses",
  medianColumn: "Median first response",
  assigneesEmpty: "Nobody on the team answered in this period.",
  businessApp: "WhatsApp Business app",
  unknownUser: (id) => `User ${id}`,
  unidentifiedPerson: "Unidentified",

  sourcesTitle: "By source",
  sourcesDescription: "New conversations by the link or ad they came from.",
  sourceColumn: "Source",
  conversationsColumn: "Conversations",
  shareColumn: "Share",
  directSource: "Direct",
  sourcesEmpty: "No new conversations in this period.",

  tagsTitle: "By tag",
  tagsDescription: "Conversations with contact messages in the period, by their current tags.",
  tagColumn: "Tag",
  closedColumn: "Closed",
  aiResolvedColumn: "Resolved by AI",
  untagged: "Untagged",
  tagsEmpty: "No conversations in this period.",

  costTitle: "AI cost",
  costDescription: "Model cost per day and per agent. Only admins see it.",
  costTotal: (amount) => `Period total: ${amount}`,
  costPerDayTitle: "Cost per day",
  seriesCost: "Cost",
  costPerAgentTitle: "By agent",
  agentColumn: "Agent",
  costColumn: "Cost",
  turnsColumn: "Turns",
  tokensColumn: "Tokens (input / output)",
  unnamedAgent: "Unnamed",
  costEmpty: "The AI had no recorded cost in this period.",
};

/** The metrics strings of every `SendoLocale`. Add an object here when you add a language. */
export const metricsStrings = { es, en } satisfies Record<SendoLocale, MetricsStrings>;

/** The strings of `locale`, with `overrides` on top (`<MetricsScreen strings>`). */
export function resolveMetricsStrings(
  locale: SendoLocale,
  overrides?: Partial<MetricsStrings>,
): MetricsStrings {
  const strings: MetricsStrings = metricsStrings[locale];
  return overrides === undefined ? strings : { ...strings, ...overrides };
}
