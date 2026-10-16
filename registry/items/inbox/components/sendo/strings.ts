import type { InboxSystemLine, MessageType, TagColor, TranscriptionError } from "@quami/sendo";
import type { SendoLocale } from "@/lib/sendo-ui";
import type { InboxFormat } from "./utils";

/** Display names a system line needs, resolved by the inbox (team names, agent names). */
export interface InboxSystemEventNames {
  /** Who did it (`line.by`); `null` when unknown, e.g. a legacy row of a user with no name. */
  by: string | null;
  /** `params.assignedTo`; `null` when the line has no assignee. */
  assignee: string | null;
}

/**
 * Every user-visible string of the inbox, one object per `SendoLocale` (`inboxStrings`). Override
 * any of them through `<Inbox strings>`. Functions that show a number or a list get `format`
 * (`Intl` bound to the inbox's `formatLocale`).
 */
export interface InboxStrings {
  /** `<title>` of the inbox page (`generateMetadata`). */
  pageTitle: string;
  inboxTitle: string;
  // Rail
  navLabel: string;
  navInbox: string;
  navNumbers: string;
  navRules: string;
  navBroadcasts: string;
  navMetrics: string;
  navLinks: string;
  navSnippets: string;
  navTags: string;
  /** The operator when no name is known. */
  you: string;
  // Access (AC-RL-4)
  accessDeniedTitle: string;
  accessDeniedHint: string;
  // Conversation list
  numberAll: string;
  /** The number selector's default: conversations of connected numbers only. */
  numberAllActive: string;
  /** Selector option that adds the conversations of disconnected numbers. */
  numberShowDisconnected: string;
  numberLabel: string;
  numberDisconnected: (label: string) => string;
  searchLabel: string;
  searchPlaceholder: string;
  searchClear: string;
  tabsLabel: string;
  tabOpen: string;
  tabMine: string;
  tabAgent: string;
  tabHuman: string;
  tabClosed: string;
  tagFilterLabel: string;
  listEmpty: string;
  listEmptyFiltered: string;
  listLoading: string;
  loadMoreConversations: string;
  unreadCount: (count: number, format: InboxFormat) => string;
  noMessagesPreview: string;
  previewYou: string;
  /** Prefix of a note in a preview. */
  previewNote: string;
  notLinked: string;
  flagDraft: string;
  flagPaused: string;
  /** Row badge of a conversation whose number is disconnected (when its label isn't known). */
  flagDisconnected: string;
  moreTags: (count: number, format: InboxFormat) => string;
  assignedTo: (name: string) => string;
  unassigned: string;
  channelWhatsApp: string;
  timeYesterday: string;
  // Status badge
  statusHuman: string;
  statusAgent: string;
  statusClosed: string;
  // Thread header
  selectConversation: string;
  back: string;
  pauseAgent: string;
  agentPausedSwitch: string;
  pauseAgentHint: string;
  pausedOnNumber: string;
  take: string;
  returnToAgent: string;
  close: string;
  details: string;
  detailsTitle: string;
  // Thread
  loadOlder: string;
  loadingOlder: string;
  threadLoading: string;
  threadEmpty: string;
  threadEmptyHint: string;
  dayToday: string;
  dayYesterday: string;
  // Banners
  handoffBannerTitle: string;
  pausedBannerTitle: string;
  pausedBannerBy: (name: string) => string;
  pausedBannerHint: string;
  pausedByPhone: string;
  pausedAccountTitle: string;
  pausedAccountHint: string;
  resume: string;
  disconnectedTitle: string;
  disconnectedHint: string;
  composerDisconnected: string;
  // Who did it (handoff `by`, system lines, approvals)
  actorAgent: (name: string | null) => string;
  actorRule: (key: string) => string;
  actorSystem: string;
  actorPhone: string;
  actorPerson: string;
  /**
   * A system line (handoff, assignment, pause, rules) from its `event` and `params`, or `null` to
   * show the stored `text` instead (unknown event, or a legacy row without the params it needs).
   */
  systemEvent: (
    line: InboxSystemLine,
    names: InboxSystemEventNames,
    format: InboxFormat,
  ) => string | null;
  // Messages
  senderContact: string;
  senderAgent: string;
  senderHuman: string;
  senderSystem: string;
  fromPhone: string;
  importedMessage: string;
  approvedBy: (name: string) => string;
  editedSuffix: string;
  origin: (code: string) => string;
  noteLabel: (name: string) => string;
  noteAudience: string;
  // Draft card (AC-IB-4)
  draftTitle: (agent: string) => string;
  draftAwaiting: string;
  draftBeforeHandoff: string;
  draftDiscard: string;
  draftEdit: string;
  draftEditLabel: string;
  draftCancelEdit: string;
  draftApprove: string;
  draftSendEdited: string;
  draftWindowClosed: string;
  draftDisconnected: string;
  draftUsage: (
    tokensIn: number | null,
    tokensOut: number | null,
    cost: string | null,
    format: InboxFormat,
  ) => string;
  draftFailed: string;
  // Context panel
  contactLabel: string;
  openInApp: (ref: string) => string;
  sectionAssignment: string;
  queueLabel: (queue: string | null) => string;
  sectionTags: string;
  tagsEmpty: string;
  sectionConversation: string;
  fieldChannel: string;
  fieldNumber: string;
  fieldOrigin: string;
  originDirect: string;
  fieldWindow: string;
  sectionCost: string;
  costTurns: (turns: number, format: InboxFormat) => string;
  costUnknown: string;
  /** Agent turns with no known cost, next to the total. */
  costUnpriced: (turns: number, format: InboxFormat) => string;
  /** Hover line of an agent reply (admins): cost (or `costUnknown`) and tokens. */
  turnCost: (
    cost: string,
    tokensIn: number | null,
    tokensOut: number | null,
    format: InboxFormat,
  ) => string;
  /** Screen-reader text of the hover line. */
  turnCostLabel: (
    cost: string,
    tokensIn: number | null,
    tokensOut: number | null,
    format: InboxFormat,
  ) => string;
  tagColorName: (color: TagColor) => string;
  // Message content
  messageTemplate: string;
  messageLocation: string;
  messageContacts: string;
  messageReaction: (emoji: string) => string;
  messageReactionRemoved: string;
  messageUnsupported: string;
  /** Short label for non-text messages (list previews, media without a stored file). */
  messageTypeLabel: (type: MessageType) => string;
  // Media
  mediaUnavailable: string;
  mediaPending: string;
  mediaOpen: string;
  mediaDownload: string;
  mediaPreviewTitle: string;
  mediaDocument: string;
  /** Voice note whose transcription failed or was skipped (AC-VN-2). */
  transcriptMissing: string;
  /** Why, as the label's tooltip. */
  transcriptMissingReason: (error: TranscriptionError) => string;
  /** Screen-reader prefix of a voice-note transcript. */
  transcriptLabel: string;
  /** Close button of the mobile sheets and the dialogs (template picker, media preview, details, catalogs). */
  sheetClose: string;
  // Status ticks
  tickPending: string;
  tickSent: string;
  tickDelivered: string;
  tickRead: string;
  tickFailed: string;
  errorCode: (code: number) => string;
  // Window (AC-IB-7)
  windowLabel: string;
  windowRemaining: (hours: number, minutes: number, format: InboxFormat) => string;
  windowClosed: string;
  windowNeverOpened: string;
  windowNeverOpenedShort: string;
  // Composer
  composerPlaceholder: string;
  composerLabel: string;
  attach: string;
  removeAttachment: string;
  send: string;
  sending: string;
  sendFailed: string;
  // Composer modes, snippet picker (SND-3.6)
  composerModeLabel: string;
  composerModeReply: string;
  composerModeNote: string;
  composerHintStepIn: string;
  composerHintHuman: (name: string) => string;
  composerHintNote: string;
  composerPlaceholderReply: string;
  composerPlaceholderNote: string;
  composerTemplateButton: string;
  windowClosedBarTitle: string;
  windowClosedBarText: string;
  sentStepIn: string;
  noteSaved: string;
  noteFailed: string;
  draftDiscardedByReply: string;
  snippetPickerOpen: string;
  snippetPickerTitle: string;
  snippetPickerEmpty: string;
  snippetPickerKeys: string;
  snippetScopeTenant: string;
  snippetScopePersonal: string;
  snippetUnresolved: (names: string[], format: InboxFormat) => string;
  snippetRenderFailed: string;
  // Tag picker, assign menu (SND-3.6)
  tagAdd: string;
  tagMenuEmpty: string;
  tagRemove: (name: string) => string;
  assignMenuLabel: string;
  assignToMe: string;
  unassign: string;
  assigneesLoading: string;
  assigneesEmpty: string;
  // Admin sheets (SND-3.6)
  snippetsManagerTitle: string;
  snippetsManagerDescription: string;
  snippetNew: string;
  snippetShortcut: string;
  snippetShortcutHint: string;
  snippetBody: string;
  snippetBodyHint: string;
  snippetVisibility: string;
  snippetsEmpty: string;
  snippetDeleteConfirm: (shortcut: string) => string;
  snippetShortcutTaken: string;
  tagsManagerTitle: string;
  tagsManagerDescription: string;
  tagNew: string;
  tagName: string;
  tagColor: string;
  tagsCatalogEmpty: string;
  tagDeleteConfirm: (name: string, conversations: number, format: InboxFormat) => string;
  tagNameTaken: string;
  managerSave: string;
  managerCancel: string;
  managerDelete: string;
  managerSaved: string;
  managerSaveFailed: string;
  // Template picker
  templateExplanation: string;
  templateChoose: string;
  templateOpen: string;
  templateLabel: string;
  templatePlaceholder: string;
  templateNone: string;
  templateLoading: string;
  templateVariable: (index: number) => string;
  templateSend: string;
  templatesLoadFailed: string;
  // Errors
  actionFailed: string;
  loadFailed: string;
  forbiddenConversation: string;
}

/** The sentences of the system lines in one language (`systemEvent`). */
interface SystemEventPhrases {
  handoff: (by: string, reason: string, assignee: string | null) => string;
  took: (assignee: string) => string;
  assigned: (by: string, assignee: string) => string;
  unassigned: (by: string) => string;
  returned: (by: string) => string;
  closed: (by: string) => string;
  agentPaused: (by: string) => string;
  agentResumed: (by: string) => string;
  /** "rule «key»" in the middle of a sentence. */
  rule: (key: string) => string;
  waited: (minutes: string) => string;
  queue: (queue: string) => string;
  tags: (tags: string) => string;
  ruleHandoff: (rule: string, detail: string) => string;
  ruleRouted: (rule: string, detail: string) => string;
  ruleAssigned: (assignee: string, rule: string) => string;
  ruleReassigned: (assignee: string, rule: string, waited: string) => string;
  ruleEscalated: (rule: string, waited: string) => string;
  ruleReturned: (rule: string, waited: string) => string;
  ruleClosed: (rule: string, days: number, daysText: string) => string;
  ruleAfterHours: (rule: string) => string;
  ruleUnassigned: (rule: string) => string;
  ruleAgentPaused: (rule: string) => string;
  ruleAgentResumed: (rule: string) => string;
}

const SYSTEM_EVENTS_ES: SystemEventPhrases = {
  handoff: (by, reason, assignee) =>
    `${by} pasó la conversación a una persona · ${reason}${assignee === null ? "" : ` · Asignada a ${assignee}`}`,
  took: (assignee) => `${assignee} tomó la conversación`,
  assigned: (by, assignee) => `${by} asignó la conversación a ${assignee}`,
  unassigned: (by) => `${by} quitó la asignación`,
  returned: (by) => `${by} devolvió la conversación al agente`,
  closed: (by) => `${by} cerró la conversación`,
  agentPaused: (by) => `${by} pausó al agente en esta conversación`,
  agentResumed: (by) => `${by} reanudó al agente`,
  rule: (key) => `la regla «${key}»`,
  waited: (minutes) => ` (${minutes} min sin respuesta)`,
  queue: (queue) => `cola «${queue}»`,
  tags: (tags) => `etiquetas: ${tags}`,
  ruleHandoff: (rule, detail) => `Pasada a una persona por ${rule}${detail}`,
  ruleRouted: (rule, detail) => `Enrutada por ${rule}${detail}`,
  ruleAssigned: (assignee, rule) => `Asignada a ${assignee} por ${rule}`,
  ruleReassigned: (assignee, rule, waited) => `Reasignada a ${assignee} por ${rule}${waited}`,
  ruleEscalated: (rule, waited) => `Escalada por ${rule}${waited}`,
  ruleReturned: (rule, waited) => `Devuelta al agente por ${rule}${waited}`,
  ruleClosed: (rule, days, daysText) =>
    `Cerrada por ${rule} tras ${daysText} ${days === 1 ? "día" : "días"} sin actividad`,
  ruleAfterHours: (rule) => `Mensaje fuera de horario enviado por ${rule}`,
  ruleUnassigned: (rule) => `Asignación quitada por ${rule}`,
  ruleAgentPaused: (rule) => `Agente pausado por ${rule}`,
  ruleAgentResumed: (rule) => `Agente reanudado por ${rule}`,
};

const SYSTEM_EVENTS_EN: SystemEventPhrases = {
  handoff: (by, reason, assignee) =>
    `${by} handed the conversation to a person · ${reason}${assignee === null ? "" : ` · Assigned to ${assignee}`}`,
  took: (assignee) => `${assignee} took the conversation`,
  assigned: (by, assignee) => `${by} assigned the conversation to ${assignee}`,
  unassigned: (by) => `${by} removed the assignment`,
  returned: (by) => `${by} returned the conversation to the agent`,
  closed: (by) => `${by} closed the conversation`,
  agentPaused: (by) => `${by} paused the agent in this conversation`,
  agentResumed: (by) => `${by} resumed the agent`,
  rule: (key) => `rule «${key}»`,
  waited: (minutes) => ` (${minutes} min without a reply)`,
  queue: (queue) => `queue «${queue}»`,
  tags: (tags) => `tags: ${tags}`,
  ruleHandoff: (rule, detail) => `Handed to a person by ${rule}${detail}`,
  ruleRouted: (rule, detail) => `Routed by ${rule}${detail}`,
  ruleAssigned: (assignee, rule) => `Assigned to ${assignee} by ${rule}`,
  ruleReassigned: (assignee, rule, waited) => `Reassigned to ${assignee} by ${rule}${waited}`,
  ruleEscalated: (rule, waited) => `Escalated by ${rule}${waited}`,
  ruleReturned: (rule, waited) => `Returned to the agent by ${rule}${waited}`,
  ruleClosed: (rule, days, daysText) =>
    `Closed by ${rule} after ${daysText} ${days === 1 ? "day" : "days"} without activity`,
  ruleAfterHours: (rule) => `After-hours message sent by ${rule}`,
  ruleUnassigned: (rule) => `Assignment removed by ${rule}`,
  ruleAgentPaused: (rule) => `Agent paused by ${rule}`,
  ruleAgentResumed: (rule) => `Agent resumed by ${rule}`,
};

/** Rule lines (`kind: "rule"`, and routing events): `null` without the rule key (legacy rows). */
function ruleEventText(
  line: InboxSystemLine,
  names: InboxSystemEventNames,
  format: InboxFormat,
  phrases: SystemEventPhrases,
): string | null {
  const { params } = line;
  if (typeof params.ruleKey !== "string") return null;
  const rule = phrases.rule(params.ruleKey);
  const waited =
    typeof params.minutesWaiting === "number"
      ? phrases.waited(format.number(params.minutesWaiting))
      : "";
  const tags =
    typeof params.tags === "string"
      ? params.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag !== "")
      : [];
  const routing = [
    typeof params.queue === "string" ? phrases.queue(params.queue) : null,
    tags.length > 0 ? phrases.tags(format.list(tags)) : null,
  ].filter((part) => part !== null);
  const detail = routing.length > 0 ? ` (${routing.join("; ")})` : "";
  switch (line.event) {
    case "handoff":
      return phrases.ruleHandoff(rule, detail);
    case "routed":
      return phrases.ruleRouted(rule, detail);
    case "assigned":
      if (names.assignee === null) return null;
      return waited === ""
        ? phrases.ruleAssigned(names.assignee, rule)
        : phrases.ruleReassigned(names.assignee, rule, waited);
    case "escalated":
      return phrases.ruleEscalated(rule, waited);
    case "returned":
      return phrases.ruleReturned(rule, waited);
    case "closed":
      return typeof params.afterDays === "number"
        ? phrases.ruleClosed(rule, params.afterDays, format.number(params.afterDays))
        : null;
    case "after_hours":
      return phrases.ruleAfterHours(rule);
    case "unassigned":
      return phrases.ruleUnassigned(rule);
    case "agent_paused":
      return phrases.ruleAgentPaused(rule);
    case "agent_resumed":
      return phrases.ruleAgentResumed(rule);
    default:
      return null;
  }
}

/** `systemEvent` of every locale: the same params checks, the locale's sentences. */
function systemEventText(
  line: InboxSystemLine,
  names: InboxSystemEventNames,
  format: InboxFormat,
  phrases: SystemEventPhrases,
): string | null {
  if (
    line.kind === "rule" ||
    line.event === "routed" ||
    line.event === "after_hours" ||
    line.event === "escalated"
  ) {
    return ruleEventText(line, names, format, phrases);
  }
  const { by, assignee } = names;
  if (by === null) return null;
  switch (line.event) {
    case "handoff":
      return typeof line.params.reason === "string"
        ? phrases.handoff(by, line.params.reason, assignee)
        : null;
    case "assigned":
      if (assignee === null) return null;
      return line.params.assignedTo === line.by
        ? phrases.took(assignee)
        : phrases.assigned(by, assignee);
    case "unassigned":
      return phrases.unassigned(by);
    case "returned":
      return phrases.returned(by);
    case "closed":
      return phrases.closed(by);
    case "agent_paused":
      return phrases.agentPaused(by);
    case "agent_resumed":
      return phrases.agentResumed(by);
    default:
      return null;
  }
}

const MESSAGE_TYPE_LABELS_ES: Record<MessageType, string> = {
  text: "Mensaje",
  image: "Imagen",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  sticker: "Sticker",
  location: "Ubicación",
  contacts: "Contacto",
  reaction: "Reacción",
  interactive: "Respuesta",
  button: "Respuesta",
  template: "Plantilla",
  unsupported: "Mensaje no compatible",
  status_placeholder: "Mensaje",
};

const TRANSCRIPTION_ERRORS_ES: Record<TranscriptionError, string> = {
  too_large: "La nota de voz pasa de 25 MB.",
  timeout: "La transcripción tardó más de 30 s.",
  no_audio: "No se pudo descargar el audio.",
  empty: "No se entendió nada en el audio.",
  failed: "El modelo de transcripción falló.",
};

const TAG_COLOR_NAMES_ES: Record<TagColor, string> = {
  gray: "Gris",
  red: "Rojo",
  orange: "Naranja",
  amber: "Ámbar",
  green: "Verde",
  teal: "Turquesa",
  blue: "Azul",
  violet: "Violeta",
  pink: "Rosa",
};

const quoted = (names: string[], format: InboxFormat): string =>
  format.list(names.map((name) => `{{${name}}}`));

const es: InboxStrings = {
  pageTitle: "Bandeja",
  inboxTitle: "Bandeja",
  navLabel: "Secciones de Sendo",
  navInbox: "Bandeja",
  navNumbers: "Números",
  navRules: "Reglas",
  navBroadcasts: "Envíos",
  navMetrics: "Métricas",
  navLinks: "Enlaces y QR",
  navSnippets: "Respuestas rápidas",
  navTags: "Etiquetas",
  you: "Tú",
  accessDeniedTitle: "No tienes acceso a la bandeja",
  accessDeniedHint: "Pide a un administrador de tu equipo que te asigne un rol.",
  numberAll: "Todos los números",
  numberAllActive: "Todos los números activos",
  numberShowDisconnected: "Mostrar desconectados",
  numberLabel: "Número",
  numberDisconnected: (label) => `${label} · desconectado`,
  searchLabel: "Buscar conversaciones",
  searchPlaceholder: "Buscar por nombre, referencia o teléfono",
  searchClear: "Borrar búsqueda",
  tabsLabel: "Estado de las conversaciones",
  tabOpen: "Abiertas",
  tabMine: "Asignadas a mí",
  tabAgent: "Agente IA",
  tabHuman: "Personas",
  tabClosed: "Cerradas",
  tagFilterLabel: "Filtrar por etiqueta",
  listEmpty: "No hay conversaciones en esta vista.",
  listEmptyFiltered: "No hay conversaciones con este filtro.",
  listLoading: "Cargando conversaciones…",
  loadMoreConversations: "Cargar más",
  unreadCount: (count, format) =>
    count === 1 ? "1 mensaje sin leer" : `${format.number(count)} mensajes sin leer`,
  noMessagesPreview: "Sin mensajes",
  previewYou: "Tú:",
  previewNote: "Nota:",
  notLinked: "Sin vincular",
  flagDraft: "Borrador",
  flagPaused: "En pausa",
  flagDisconnected: "Desconectado",
  moreTags: (count, format) => `+${format.number(count)}`,
  assignedTo: (name) => `Asignada a ${name}`,
  unassigned: "Sin asignar",
  channelWhatsApp: "WhatsApp",
  timeYesterday: "Ayer",
  statusHuman: "Persona",
  statusAgent: "Agente IA",
  statusClosed: "Cerrada",
  selectConversation: "Selecciona una conversación para ver los mensajes.",
  back: "Volver a la lista",
  pauseAgent: "Pausar agente",
  agentPausedSwitch: "Agente en pausa",
  pauseAgentHint: "Pausar al agente en esta conversación",
  pausedOnNumber: "El agente está en pausa en todo el número",
  take: "Tomar conversación",
  returnToAgent: "Devolver al agente",
  close: "Cerrar",
  details: "Detalles",
  detailsTitle: "Detalles de la conversación",
  loadOlder: "Cargar anteriores",
  loadingOlder: "Cargando…",
  threadLoading: "Cargando mensajes…",
  threadEmpty: "Todavía no hay mensajes",
  threadEmptyHint: "Cuando el contacto escriba, sus mensajes aparecerán aquí.",
  dayToday: "Hoy",
  dayYesterday: "Ayer",
  handoffBannerTitle: "Por qué se pasó a una persona:",
  pausedBannerTitle: "El agente está en pausa en esta conversación.",
  pausedBannerBy: (name) => `Pausado por ${name}. No responderá hasta que lo reanudes.`,
  pausedBannerHint: "No responderá hasta que lo reanudes.",
  pausedByPhone:
    "Se pausó porque alguien respondió desde el teléfono. No responderá hasta que lo reanudes.",
  pausedAccountTitle: "El agente está en pausa en este número.",
  pausedAccountHint: "Solo un administrador puede reanudarlo desde Números.",
  resume: "Reanudar",
  disconnectedTitle: "Número desconectado.",
  disconnectedHint:
    "Puedes leer la conversación, pero no responder ni dejar notas desde este número.",
  composerDisconnected:
    "Este número está desconectado. Un administrador puede reconectarlo en Números.",
  actorAgent: (name) => (name === null ? "Agente IA" : `Agente IA · ${name}`),
  actorRule: (key) => `Regla «${key}»`,
  actorSystem: "Sendo",
  actorPhone: "El teléfono",
  actorPerson: "Persona del equipo",
  systemEvent: (line, names, format) => systemEventText(line, names, format, SYSTEM_EVENTS_ES),
  senderContact: "Contacto",
  senderAgent: "Agente IA",
  senderHuman: "Persona del equipo",
  senderSystem: "Sistema",
  fromPhone: "Desde el teléfono",
  importedMessage: "Importado del teléfono",
  approvedBy: (name) => `aprobado por ${name}`,
  editedSuffix: "editado",
  origin: (code) => `Origen: ${code}`,
  noteLabel: (name) => `Nota interna · ${name}`,
  noteAudience: "solo el equipo la ve",
  draftTitle: (agent) => `Borrador de ${agent}`,
  draftAwaiting: "espera tu aprobación",
  draftBeforeHandoff: "propuesto antes del traspaso",
  draftDiscard: "Descartar",
  draftEdit: "Editar",
  draftEditLabel: "Texto del borrador",
  draftCancelEdit: "Cancelar",
  draftApprove: "Aprobar y enviar",
  draftSendEdited: "Enviar editado",
  draftWindowClosed: "La ventana cerró; usa una plantilla.",
  draftDisconnected: "El número está desconectado; no se puede enviar.",
  draftUsage: (tokensIn, tokensOut, cost, format) => {
    const tokens =
      tokensIn === null || tokensOut === null
        ? null
        : `${format.number(tokensIn)} → ${format.number(tokensOut)} tokens`;
    return [tokens, cost].filter((part) => part !== null).join(" · ");
  },
  draftFailed: "No se pudo actualizar el borrador.",
  contactLabel: "Contacto",
  openInApp: (ref) => `Ver ${ref} en la app`,
  sectionAssignment: "Asignación",
  queueLabel: (queue) => `Cola: ${queue ?? "—"}`,
  sectionTags: "Etiquetas",
  tagsEmpty: "Sin etiquetas",
  sectionConversation: "Conversación",
  fieldChannel: "Canal",
  fieldNumber: "Número",
  fieldOrigin: "Origen",
  originDirect: "Directo",
  fieldWindow: "Ventana",
  sectionCost: "Costo del agente",
  costTurns: (turns, format) => (turns === 1 ? "1 turno" : `${format.number(turns)} turnos`),
  costUnknown: "—",
  costUnpriced: (turns, format) =>
    turns === 1 ? "1 sin costo" : `${format.number(turns)} sin costo`,
  turnCost: (cost, tokensIn, tokensOut, format) =>
    tokensIn === null || tokensOut === null
      ? cost
      : `${cost} · ${format.number(tokensIn)} → ${format.number(tokensOut)} tokens`,
  turnCostLabel: (cost, tokensIn, tokensOut, format) =>
    tokensIn === null || tokensOut === null
      ? `Costo del turno: ${cost}`
      : `Costo del turno: ${cost}; ${format.number(tokensIn)} tokens de entrada, ${format.number(tokensOut)} de salida`,
  tagColorName: (color) => TAG_COLOR_NAMES_ES[color],
  messageTemplate: "Plantilla",
  messageLocation: "Ubicación compartida",
  messageContacts: "Contacto compartido",
  messageReaction: (emoji) => `Reaccionó con ${emoji}`,
  messageReactionRemoved: "Quitó su reacción",
  messageUnsupported: "Tipo de mensaje no compatible",
  messageTypeLabel: (type) => MESSAGE_TYPE_LABELS_ES[type],
  mediaUnavailable: "Archivo no disponible",
  mediaPending: "Descargando archivo…",
  mediaOpen: "Ver imagen",
  mediaDownload: "Descargar",
  mediaPreviewTitle: "Vista previa",
  mediaDocument: "Documento",
  transcriptMissing: "Sin transcripción",
  transcriptMissingReason: (error) => TRANSCRIPTION_ERRORS_ES[error],
  transcriptLabel: "Transcripción:",
  sheetClose: "Cerrar",
  tickPending: "Enviando",
  tickSent: "Enviado",
  tickDelivered: "Entregado",
  tickRead: "Leído",
  tickFailed: "No se pudo enviar",
  errorCode: (code) => `Código ${String(code)}`,
  windowLabel: "Ventana de 24 h",
  windowRemaining: (hours, minutes, format) =>
    hours >= 2 || (hours > 0 && minutes === 0)
      ? `${format.number(hours)} h`
      : hours > 0
        ? `${format.number(hours)} h ${format.number(minutes)} min`
        : `${format.number(minutes)} min`,
  windowClosed: "Solo plantillas",
  windowNeverOpened: "El contacto no ha escrito",
  windowNeverOpenedShort: "No ha escrito",
  composerPlaceholder: "Escribe un mensaje",
  composerLabel: "Mensaje",
  attach: "Adjuntar archivo",
  removeAttachment: "Quitar adjunto",
  send: "Enviar",
  sending: "Enviando…",
  sendFailed: "No se pudo enviar el mensaje.",
  composerModeLabel: "Tipo de mensaje",
  composerModeReply: "Responder",
  composerModeNote: "Nota interna",
  composerHintStepIn: "El agente sigue a cargo; tu mensaje sale como persona del equipo.",
  composerHintHuman: (name) => `Respondes como ${name}.`,
  composerHintNote: "Solo el equipo verá esta nota.",
  composerPlaceholderReply: "Escribe un mensaje o / para respuestas rápidas",
  composerPlaceholderNote: "Escribe una nota para el equipo…",
  composerTemplateButton: "Plantilla",
  windowClosedBarTitle: "Ventana de 24 h cerrada.",
  windowClosedBarText: "Solo puedes enviar una plantilla aprobada.",
  sentStepIn: "Enviado · el agente sigue a cargo",
  noteSaved: "Nota guardada",
  noteFailed: "No se pudo guardar la nota.",
  draftDiscardedByReply: "Respondiste tú; el borrador se descartó",
  snippetPickerOpen: "Respuestas rápidas",
  snippetPickerTitle: "Respuestas rápidas",
  snippetPickerEmpty: "Sin resultados",
  snippetPickerKeys: "↑ ↓ para elegir · Enter para insertar · Esc para cerrar",
  snippetScopeTenant: "Equipo",
  snippetScopePersonal: "Personal",
  snippetUnresolved: (names, format) => `Completa ${quoted(names, format)} antes de enviar.`,
  snippetRenderFailed: "No se pudo insertar la respuesta rápida.",
  tagAdd: "+ Etiqueta",
  tagMenuEmpty: "Ya tiene todas.",
  tagRemove: (name) => `Quitar ${name}`,
  assignMenuLabel: "Asignar a",
  assignToMe: "Asignarme",
  unassign: "Quitar asignación",
  assigneesLoading: "Cargando personas…",
  assigneesEmpty: "No hay personas para esta cola.",
  snippetsManagerTitle: "Respuestas rápidas",
  snippetsManagerDescription:
    "Textos con variables como {{nombre}} que el equipo inserta escribiendo / en el mensaje.",
  snippetNew: "Nueva respuesta",
  snippetShortcut: "Atajo",
  snippetShortcutHint: "Minúsculas, números, - o _, sin la barra.",
  snippetBody: "Texto",
  snippetBodyHint: "Variables: {{nombre}}, {{telefono}}, {{agente}} y las de tu app.",
  snippetVisibility: "Visible para",
  snippetsEmpty: "Todavía no hay respuestas rápidas.",
  snippetDeleteConfirm: (shortcut) => `¿Eliminar /${shortcut}?`,
  snippetShortcutTaken: "Ya existe una respuesta con ese atajo.",
  tagsManagerTitle: "Etiquetas",
  tagsManagerDescription: "El catálogo de etiquetas del equipo.",
  tagNew: "Nueva etiqueta",
  tagName: "Nombre",
  tagColor: "Color",
  tagsCatalogEmpty: "Todavía no hay etiquetas.",
  tagDeleteConfirm: (name, conversations, format) =>
    conversations === 0
      ? `¿Eliminar «${name}»? Ninguna conversación la usa.`
      : `¿Eliminar «${name}»? Se quitará de ${conversations === 1 ? "1 conversación" : `${format.number(conversations)} conversaciones`}.`,
  tagNameTaken: "Ya existe una etiqueta con ese nombre.",
  managerSave: "Guardar",
  managerCancel: "Cancelar",
  managerDelete: "Eliminar",
  managerSaved: "Guardado",
  managerSaveFailed: "No se pudo guardar.",
  templateExplanation:
    "Pasaron más de 24 horas desde el último mensaje del contacto. Solo puedes escribirle con una plantilla aprobada.",
  templateChoose: "Elige una plantilla",
  templateOpen: "Enviar plantilla",
  templateLabel: "Plantilla",
  templatePlaceholder: "Selecciona una plantilla",
  templateNone: "No hay plantillas aprobadas para este número.",
  templateLoading: "Cargando plantillas…",
  templateVariable: (index) => `Variable {{${String(index)}}}`,
  templateSend: "Enviar plantilla",
  templatesLoadFailed: "No se pudieron cargar las plantillas.",
  actionFailed: "No se pudo actualizar la conversación.",
  loadFailed: "No se pudo cargar la información.",
  forbiddenConversation: "Ya no tienes acceso a esta conversación.",
};

const MESSAGE_TYPE_LABELS_EN: Record<MessageType, string> = {
  text: "Message",
  image: "Image",
  audio: "Audio",
  video: "Video",
  document: "Document",
  sticker: "Sticker",
  location: "Location",
  contacts: "Contact",
  reaction: "Reaction",
  interactive: "Reply",
  button: "Reply",
  template: "Template",
  unsupported: "Unsupported message",
  status_placeholder: "Message",
};

const TRANSCRIPTION_ERRORS_EN: Record<TranscriptionError, string> = {
  too_large: "The voice note is over 25 MB.",
  timeout: "The transcription took more than 30 s.",
  no_audio: "The audio couldn't be downloaded.",
  empty: "Nothing could be understood in the audio.",
  failed: "The transcription model failed.",
};

const TAG_COLOR_NAMES_EN: Record<TagColor, string> = {
  gray: "Gray",
  red: "Red",
  orange: "Orange",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  violet: "Violet",
  pink: "Pink",
};

const en: InboxStrings = {
  pageTitle: "Inbox",
  inboxTitle: "Inbox",
  navLabel: "Sendo sections",
  navInbox: "Inbox",
  navNumbers: "Numbers",
  navRules: "Rules",
  navBroadcasts: "Broadcasts",
  navMetrics: "Metrics",
  navLinks: "Links and QR",
  navSnippets: "Quick replies",
  navTags: "Tags",
  you: "You",
  accessDeniedTitle: "You don't have access to the inbox",
  accessDeniedHint: "Ask an admin on your team to give you a role.",
  numberAll: "All numbers",
  numberAllActive: "All active numbers",
  numberShowDisconnected: "Show disconnected",
  numberLabel: "Number",
  numberDisconnected: (label) => `${label} · disconnected`,
  searchLabel: "Search conversations",
  searchPlaceholder: "Search by name, reference or phone",
  searchClear: "Clear search",
  tabsLabel: "Conversation status",
  tabOpen: "Open",
  tabMine: "Assigned to me",
  tabAgent: "AI agent",
  tabHuman: "People",
  tabClosed: "Closed",
  tagFilterLabel: "Filter by tag",
  listEmpty: "No conversations in this view.",
  listEmptyFiltered: "No conversations match this filter.",
  listLoading: "Loading conversations…",
  loadMoreConversations: "Load more",
  unreadCount: (count, format) =>
    count === 1 ? "1 unread message" : `${format.number(count)} unread messages`,
  noMessagesPreview: "No messages",
  previewYou: "You:",
  previewNote: "Note:",
  notLinked: "Not linked",
  flagDraft: "Draft",
  flagPaused: "Paused",
  flagDisconnected: "Disconnected",
  moreTags: (count, format) => `+${format.number(count)}`,
  assignedTo: (name) => `Assigned to ${name}`,
  unassigned: "Unassigned",
  channelWhatsApp: "WhatsApp",
  timeYesterday: "Yesterday",
  statusHuman: "Person",
  statusAgent: "AI agent",
  statusClosed: "Closed",
  selectConversation: "Select a conversation to see its messages.",
  back: "Back to the list",
  pauseAgent: "Pause agent",
  agentPausedSwitch: "Agent paused",
  pauseAgentHint: "Pause the agent in this conversation",
  pausedOnNumber: "The agent is paused on the whole number",
  take: "Take conversation",
  returnToAgent: "Return to agent",
  close: "Close",
  details: "Details",
  detailsTitle: "Conversation details",
  loadOlder: "Load earlier",
  loadingOlder: "Loading…",
  threadLoading: "Loading messages…",
  threadEmpty: "No messages yet",
  threadEmptyHint: "When the contact writes, their messages will show up here.",
  dayToday: "Today",
  dayYesterday: "Yesterday",
  handoffBannerTitle: "Why it was handed to a person:",
  pausedBannerTitle: "The agent is paused in this conversation.",
  pausedBannerBy: (name) => `Paused by ${name}. It won't reply until you resume it.`,
  pausedBannerHint: "It won't reply until you resume it.",
  pausedByPhone:
    "Paused because someone replied from the phone. It won't reply until you resume it.",
  pausedAccountTitle: "The agent is paused on this number.",
  pausedAccountHint: "Only an admin can resume it from Numbers.",
  resume: "Resume",
  disconnectedTitle: "Number disconnected.",
  disconnectedHint: "You can read the conversation, but not reply or add notes from this number.",
  composerDisconnected: "This number is disconnected. An admin can reconnect it in Numbers.",
  actorAgent: (name) => (name === null ? "AI agent" : `AI agent · ${name}`),
  actorRule: (key) => `Rule «${key}»`,
  actorSystem: "Sendo",
  actorPhone: "The WhatsApp Business app",
  actorPerson: "Team member",
  systemEvent: (line, names, format) => systemEventText(line, names, format, SYSTEM_EVENTS_EN),
  senderContact: "Contact",
  senderAgent: "AI agent",
  senderHuman: "Team member",
  senderSystem: "System",
  fromPhone: "From the phone",
  importedMessage: "Imported from the phone",
  approvedBy: (name) => `approved by ${name}`,
  editedSuffix: "edited",
  origin: (code) => `Origin: ${code}`,
  noteLabel: (name) => `Internal note · ${name}`,
  noteAudience: "only the team sees it",
  draftTitle: (agent) => `Draft by ${agent}`,
  draftAwaiting: "awaiting your approval",
  draftBeforeHandoff: "proposed before the handoff",
  draftDiscard: "Discard",
  draftEdit: "Edit",
  draftEditLabel: "Draft text",
  draftCancelEdit: "Cancel",
  draftApprove: "Approve and send",
  draftSendEdited: "Send edited",
  draftWindowClosed: "The window closed; use a template.",
  draftDisconnected: "The number is disconnected; it can't be sent.",
  draftUsage: (tokensIn, tokensOut, cost, format) => {
    const tokens =
      tokensIn === null || tokensOut === null
        ? null
        : `${format.number(tokensIn)} → ${format.number(tokensOut)} tokens`;
    return [tokens, cost].filter((part) => part !== null).join(" · ");
  },
  draftFailed: "The draft couldn't be updated.",
  contactLabel: "Contact",
  openInApp: (ref) => `View ${ref} in the app`,
  sectionAssignment: "Assignment",
  queueLabel: (queue) => `Queue: ${queue ?? "—"}`,
  sectionTags: "Tags",
  tagsEmpty: "No tags",
  sectionConversation: "Conversation",
  fieldChannel: "Channel",
  fieldNumber: "Number",
  fieldOrigin: "Origin",
  originDirect: "Direct",
  fieldWindow: "Window",
  sectionCost: "Agent cost",
  costTurns: (turns, format) => (turns === 1 ? "1 turn" : `${format.number(turns)} turns`),
  costUnknown: "—",
  costUnpriced: (turns, format) =>
    turns === 1 ? "1 without cost" : `${format.number(turns)} without cost`,
  turnCost: (cost, tokensIn, tokensOut, format) =>
    tokensIn === null || tokensOut === null
      ? cost
      : `${cost} · ${format.number(tokensIn)} → ${format.number(tokensOut)} tokens`,
  turnCostLabel: (cost, tokensIn, tokensOut, format) =>
    tokensIn === null || tokensOut === null
      ? `Turn cost: ${cost}`
      : `Turn cost: ${cost}; ${format.number(tokensIn)} input tokens, ${format.number(tokensOut)} output`,
  tagColorName: (color) => TAG_COLOR_NAMES_EN[color],
  messageTemplate: "Template",
  messageLocation: "Shared location",
  messageContacts: "Shared contact",
  messageReaction: (emoji) => `Reacted with ${emoji}`,
  messageReactionRemoved: "Removed their reaction",
  messageUnsupported: "Unsupported message type",
  messageTypeLabel: (type) => MESSAGE_TYPE_LABELS_EN[type],
  mediaUnavailable: "File not available",
  mediaPending: "Downloading file…",
  mediaOpen: "View image",
  mediaDownload: "Download",
  mediaPreviewTitle: "Preview",
  mediaDocument: "Document",
  transcriptMissing: "No transcript",
  transcriptMissingReason: (error) => TRANSCRIPTION_ERRORS_EN[error],
  transcriptLabel: "Transcript:",
  sheetClose: "Close",
  tickPending: "Sending",
  tickSent: "Sent",
  tickDelivered: "Delivered",
  tickRead: "Read",
  tickFailed: "Couldn't send",
  errorCode: (code) => `Code ${String(code)}`,
  windowLabel: "24-hour window",
  windowRemaining: (hours, minutes, format) =>
    hours >= 2 || (hours > 0 && minutes === 0)
      ? `${format.number(hours)} h`
      : hours > 0
        ? `${format.number(hours)} h ${format.number(minutes)} min`
        : `${format.number(minutes)} min`,
  windowClosed: "Templates only",
  windowNeverOpened: "The contact hasn't written",
  windowNeverOpenedShort: "Hasn't written",
  composerPlaceholder: "Write a message",
  composerLabel: "Message",
  attach: "Attach file",
  removeAttachment: "Remove attachment",
  send: "Send",
  sending: "Sending…",
  sendFailed: "The message couldn't be sent.",
  composerModeLabel: "Message type",
  composerModeReply: "Reply",
  composerModeNote: "Internal note",
  composerHintStepIn: "The agent stays in charge; your message goes out as a team member.",
  composerHintHuman: (name) => `You're replying as ${name}.`,
  composerHintNote: "Only the team will see this note.",
  composerPlaceholderReply: "Write a message or / for quick replies",
  composerPlaceholderNote: "Write a note for the team…",
  composerTemplateButton: "Template",
  windowClosedBarTitle: "24-hour window closed.",
  windowClosedBarText: "You can only send an approved template.",
  sentStepIn: "Sent · the agent stays in charge",
  noteSaved: "Note saved",
  noteFailed: "The note couldn't be saved.",
  draftDiscardedByReply: "You replied; the draft was discarded",
  snippetPickerOpen: "Quick replies",
  snippetPickerTitle: "Quick replies",
  snippetPickerEmpty: "No results",
  snippetPickerKeys: "↑ ↓ to choose · Enter to insert · Esc to close",
  snippetScopeTenant: "Team",
  snippetScopePersonal: "Personal",
  snippetUnresolved: (names, format) => `Fill in ${quoted(names, format)} before sending.`,
  snippetRenderFailed: "The quick reply couldn't be inserted.",
  tagAdd: "+ Tag",
  tagMenuEmpty: "It has them all.",
  tagRemove: (name) => `Remove ${name}`,
  assignMenuLabel: "Assign to",
  assignToMe: "Assign to me",
  unassign: "Remove assignment",
  assigneesLoading: "Loading people…",
  assigneesEmpty: "No people for this queue.",
  snippetsManagerTitle: "Quick replies",
  snippetsManagerDescription:
    "Texts with variables like {{nombre}} that the team inserts by typing / in the message.",
  snippetNew: "New quick reply",
  snippetShortcut: "Shortcut",
  snippetShortcutHint: "Lowercase letters, numbers, - or _, without the slash.",
  snippetBody: "Text",
  snippetBodyHint: "Variables: {{nombre}}, {{telefono}}, {{agente}} and your app's.",
  snippetVisibility: "Visible to",
  snippetsEmpty: "No quick replies yet.",
  snippetDeleteConfirm: (shortcut) => `Delete /${shortcut}?`,
  snippetShortcutTaken: "A quick reply with that shortcut already exists.",
  tagsManagerTitle: "Tags",
  tagsManagerDescription: "Your team's tag catalog.",
  tagNew: "New tag",
  tagName: "Name",
  tagColor: "Color",
  tagsCatalogEmpty: "No tags yet.",
  tagDeleteConfirm: (name, conversations, format) =>
    conversations === 0
      ? `Delete «${name}»? No conversation uses it.`
      : `Delete «${name}»? It will be removed from ${conversations === 1 ? "1 conversation" : `${format.number(conversations)} conversations`}.`,
  tagNameTaken: "A tag with that name already exists.",
  managerSave: "Save",
  managerCancel: "Cancel",
  managerDelete: "Delete",
  managerSaved: "Saved",
  managerSaveFailed: "Couldn't save.",
  templateExplanation:
    "More than 24 hours have passed since the contact's last message. You can only write to them with an approved template.",
  templateChoose: "Choose a template",
  templateOpen: "Send template",
  templateLabel: "Template",
  templatePlaceholder: "Select a template",
  templateNone: "There are no approved templates for this number.",
  templateLoading: "Loading templates…",
  templateVariable: (index) => `Variable {{${String(index)}}}`,
  templateSend: "Send template",
  templatesLoadFailed: "The templates couldn't be loaded.",
  actionFailed: "The conversation couldn't be updated.",
  loadFailed: "The information couldn't be loaded.",
  forbiddenConversation: "You no longer have access to this conversation.",
};

/** The inbox strings of every `SendoLocale`. Add an object here when you add a language. */
export const inboxStrings = { es, en } satisfies Record<SendoLocale, InboxStrings>;

/** The strings of `locale`, with `overrides` on top (`<Inbox strings>`). */
export function resolveInboxStrings(
  locale: SendoLocale,
  overrides?: Partial<InboxStrings>,
): InboxStrings {
  const strings: InboxStrings = inboxStrings[locale];
  return overrides === undefined ? strings : { ...strings, ...overrides };
}
