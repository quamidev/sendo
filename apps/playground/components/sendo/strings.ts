"use client";

import type { MessageType } from "@quami/sendo";
import { createContext, useContext } from "react";

/** Every user-visible string of the inbox. Override any of them through `<Inbox strings>`. */
export interface InboxStrings {
  inboxTitle: string;
  // Conversation list
  filtersLabel: string;
  filterHuman: string;
  filterAgent: string;
  filterClosed: string;
  filterAll: string;
  assignedToMe: string;
  listEmpty: string;
  listLoading: string;
  loadMoreConversations: string;
  unreadCount: (count: number) => string;
  noMessagesPreview: string;
  previewYou: string;
  // Status badge
  statusHuman: string;
  statusAgent: string;
  statusClosed: string;
  // Thread
  selectConversation: string;
  back: string;
  loadOlder: string;
  loadingOlder: string;
  threadLoading: string;
  threadEmpty: string;
  threadEmptyHint: string;
  senderContact: string;
  senderAgent: string;
  senderHuman: string;
  senderSystem: string;
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
  /** Close button of the mobile sheets (template picker, media preview). */
  sheetClose: string;
  // Status ticks
  tickPending: string;
  tickSent: string;
  tickDelivered: string;
  tickRead: string;
  tickFailed: string;
  errorCode: (code: number) => string;
  // Actions
  take: string;
  returnToAgent: string;
  close: string;
  actionFailed: string;
  // Window
  windowOpen: (remaining: string) => string;
  windowClosed: string;
  windowNeverOpened: string;
  // Composer
  composerPlaceholder: string;
  composerLabel: string;
  attach: string;
  removeAttachment: string;
  send: string;
  sending: string;
  sendFailed: string;
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
  loadFailed: string;
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

export const defaultInboxStrings: InboxStrings = {
  inboxTitle: "WhatsApp",
  filtersLabel: "Filtrar conversaciones",
  filterHuman: "Humano",
  filterAgent: "Agente",
  filterClosed: "Cerradas",
  filterAll: "Todas",
  assignedToMe: "Asignadas a mí",
  listEmpty: "No hay conversaciones en esta vista.",
  listLoading: "Cargando conversaciones…",
  loadMoreConversations: "Cargar más",
  unreadCount: (count) => (count === 1 ? "1 mensaje sin leer" : `${count} mensajes sin leer`),
  noMessagesPreview: "Sin mensajes",
  previewYou: "Tú:",
  statusHuman: "Humano",
  statusAgent: "Agente",
  statusClosed: "Cerrada",
  selectConversation: "Selecciona una conversación para ver los mensajes.",
  back: "Volver a la lista",
  loadOlder: "Cargar anteriores",
  loadingOlder: "Cargando…",
  threadLoading: "Cargando mensajes…",
  threadEmpty: "Todavía no hay mensajes",
  threadEmptyHint: "Cuando el contacto escriba, sus mensajes aparecerán aquí.",
  senderContact: "Contacto",
  senderAgent: "Agente",
  senderHuman: "Operador",
  senderSystem: "Sistema",
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
  sheetClose: "Cerrar",
  tickPending: "Enviando",
  tickSent: "Enviado",
  tickDelivered: "Entregado",
  tickRead: "Leído",
  tickFailed: "No se pudo enviar",
  errorCode: (code) => `Código ${String(code)}`,
  take: "Tomar",
  returnToAgent: "Devolver al agente",
  close: "Cerrar",
  actionFailed: "No se pudo actualizar la conversación.",
  windowOpen: (remaining) => `Ventana abierta · ${remaining}`,
  windowClosed: "Ventana cerrada",
  windowNeverOpened: "Sin ventana",
  composerPlaceholder: "Escribe un mensaje",
  composerLabel: "Mensaje",
  attach: "Adjuntar archivo",
  removeAttachment: "Quitar adjunto",
  send: "Enviar",
  sending: "Enviando…",
  sendFailed: "No se pudo enviar el mensaje.",
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
  loadFailed: "No se pudo cargar la información.",
};

export function mergeStrings(overrides?: Partial<InboxStrings>): InboxStrings {
  return overrides === undefined ? defaultInboxStrings : { ...defaultInboxStrings, ...overrides };
}

export const InboxStringsContext = createContext<InboxStrings>(defaultInboxStrings);

export function useInboxStrings(): InboxStrings {
  return useContext(InboxStringsContext);
}
