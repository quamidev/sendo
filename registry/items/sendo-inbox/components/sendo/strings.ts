"use client";

import type { MessageType, TagColor, TranscriptionError } from "@quami/sendo";
import { createContext, useContext } from "react";

/** Every user-visible string of the inbox. Override any of them through `<Inbox strings>`. */
export interface InboxStrings {
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
  unreadCount: (count: number) => string;
  noMessagesPreview: string;
  previewYou: string;
  /** Prefix of a note in a preview. */
  previewNote: string;
  notLinked: string;
  flagDraft: string;
  flagPaused: string;
  moreTags: (count: number) => string;
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
  draftUsage: (tokensIn: number | null, tokensOut: number | null, cost: string | null) => string;
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
  costTurns: (turns: number) => string;
  costUnknown: string;
  /** Agent turns with no known cost, next to the total. */
  costUnpriced: (turns: number) => string;
  /** Hover line of an agent reply (admins): cost (or `costUnknown`) and tokens. */
  turnCost: (cost: string, tokensIn: number | null, tokensOut: number | null) => string;
  /** Screen-reader text of the hover line. */
  turnCostLabel: (cost: string, tokensIn: number | null, tokensOut: number | null) => string;
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
  /** Close button of the mobile sheets (template picker, media preview, details). */
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
  windowRemaining: (hours: number, minutes: number) => string;
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
  snippetUnresolved: (names: string[]) => string;
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
  tagDeleteConfirm: (name: string, conversations: number) => string;
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

const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
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

const TRANSCRIPTION_ERRORS: Record<TranscriptionError, string> = {
  too_large: "La nota de voz pasa de 25 MB.",
  timeout: "La transcripción tardó más de 30 s.",
  no_audio: "No se pudo descargar el audio.",
  empty: "No se entendió nada en el audio.",
  failed: "El modelo de transcripción falló.",
};

const TAG_COLOR_NAMES: Record<TagColor, string> = {
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

function quoted(names: string[]): string {
  const parts = names.map((name) => `{{${name}}}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts.at(-1) ?? ""}`;
}

export const defaultInboxStrings: InboxStrings = {
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
  unreadCount: (count) => (count === 1 ? "1 mensaje sin leer" : `${count} mensajes sin leer`),
  noMessagesPreview: "Sin mensajes",
  previewYou: "Tú:",
  previewNote: "Nota:",
  notLinked: "Sin vincular",
  flagDraft: "Borrador",
  flagPaused: "En pausa",
  moreTags: (count) => `+${String(count)}`,
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
  draftUsage: (tokensIn, tokensOut, cost) => {
    const tokens =
      tokensIn === null || tokensOut === null
        ? null
        : `${tokensIn.toLocaleString("es")} → ${tokensOut.toLocaleString("es")} tokens`;
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
  costTurns: (turns) => (turns === 1 ? "1 turno" : `${String(turns)} turnos`),
  costUnknown: "—",
  costUnpriced: (turns) => (turns === 1 ? "1 sin costo" : `${String(turns)} sin costo`),
  turnCost: (cost, tokensIn, tokensOut) =>
    tokensIn === null || tokensOut === null
      ? cost
      : `${cost} · ${tokensIn.toLocaleString("es")} → ${tokensOut.toLocaleString("es")} tokens`,
  turnCostLabel: (cost, tokensIn, tokensOut) =>
    tokensIn === null || tokensOut === null
      ? `Costo del turno: ${cost}`
      : `Costo del turno: ${cost}; ${String(tokensIn)} tokens de entrada, ${String(tokensOut)} de salida`,
  tagColorName: (color) => TAG_COLOR_NAMES[color],
  messageTemplate: "Plantilla",
  messageLocation: "Ubicación compartida",
  messageContacts: "Contacto compartido",
  messageReaction: (emoji) => `Reaccionó con ${emoji}`,
  messageReactionRemoved: "Quitó su reacción",
  messageUnsupported: "Tipo de mensaje no compatible",
  messageTypeLabel: (type) => MESSAGE_TYPE_LABELS[type],
  mediaUnavailable: "Archivo no disponible",
  mediaPending: "Descargando archivo…",
  mediaOpen: "Ver imagen",
  mediaDownload: "Descargar",
  mediaPreviewTitle: "Vista previa",
  mediaDocument: "Documento",
  transcriptMissing: "Sin transcripción",
  transcriptMissingReason: (error) => TRANSCRIPTION_ERRORS[error],
  transcriptLabel: "Transcripción:",
  sheetClose: "Cerrar",
  tickPending: "Enviando",
  tickSent: "Enviado",
  tickDelivered: "Entregado",
  tickRead: "Leído",
  tickFailed: "No se pudo enviar",
  errorCode: (code) => `Código ${String(code)}`,
  windowLabel: "Ventana de 24 h",
  windowRemaining: (hours, minutes) =>
    hours >= 2 || (hours > 0 && minutes === 0)
      ? `${String(hours)} h`
      : hours > 0
        ? `${String(hours)} h ${String(minutes)} min`
        : `${String(minutes)} min`,
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
  snippetUnresolved: (names) => `Completa ${quoted(names)} antes de enviar.`,
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
  tagDeleteConfirm: (name, conversations) =>
    conversations === 0
      ? `¿Eliminar «${name}»? Ninguna conversación la usa.`
      : `¿Eliminar «${name}»? Se quitará de ${conversations === 1 ? "1 conversación" : `${String(conversations)} conversaciones`}.`,
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

export function mergeStrings(overrides?: Partial<InboxStrings>): InboxStrings {
  return overrides === undefined ? defaultInboxStrings : { ...defaultInboxStrings, ...overrides };
}

export const InboxStringsContext = createContext<InboxStrings>(defaultInboxStrings);

export function useInboxStrings(): InboxStrings {
  return useContext(InboxStringsContext);
}
