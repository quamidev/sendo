import type { Channel, OnboardedVia } from "@quami/sendo";
import type { SendoLocale } from "@/lib/sendo-ui";

/** Number formatting in the screen's `formatLocale` (the `format` argument of string functions). */
export interface NumbersFormat {
  number: (value: number) => string;
}

/** `Intl` formatters for `formatLocale` (a BCP-47 tag such as `es-GT`). */
export function numbersFormat(formatLocale: string): NumbersFormat {
  const numberFormat = new Intl.NumberFormat(formatLocale);
  return { number: (value) => numberFormat.format(value) };
}

/**
 * Every user-visible string of the numbers screen, one object per `SendoLocale` (`numbersStrings`).
 * Override any of them through `<NumbersScreen strings>`.
 */
export interface NumbersStrings {
  /** The page `<title>` (`generateMetadata` in page.tsx). */
  pageTitle: string;
  // Layout
  navLabel: string;
  navInbox: string;
  navNumbers: string;
  backToInbox: string;
  title: string;
  subtitle: string;
  count: (count: number, format: NumbersFormat) => string;
  // Access
  readOnlyNotice: string;
  hidden: string;
  forbidden: string;
  loadFailed: string;
  // Empty state
  emptyTitle: string;
  emptyDescription: string;
  emptyReadOnly: string;
  // Connect (Embedded Signup)
  connectFirst: string;
  connectAnother: string;
  connecting: string;
  connectPreparing: string;
  connectNotConfigured: string;
  connectChooseTitle: string;
  connectChooseDescription: string;
  connectCloudTitle: string;
  connectCloudDescription: string;
  connectCoexistenceTitle: string;
  connectCoexistenceDescription: string;
  connected: (phone: string) => string;
  reconnect: string;
  reconnected: (phone: string) => string;
  signupCancelled: string;
  signupMetaError: string;
  signupNoNumber: string;
  signupCodeExpired: string;
  signupPermissionMissing: string;
  signupPermissionDocs: string;
  signupAccountExists: string;
  signupAlreadyConnected: string;
  signupWrongNumber: (phone: string) => string;
  signupFailed: string;
  signupConfigError: string;
  sdkLoadFailed: string;
  // PIN (two-step verification)
  pinTitle: string;
  pinDescription: string;
  pinLabel: string;
  pinInvalid: string;
  pinSubmit: string;
  cancel: string;
  /** Screen-reader label of the dialogs' close (X) button. */
  close: string;
  // Status
  statusConnected: string;
  statusBillingMissing: string;
  statusBillingUnknown: string;
  statusTokenInvalid: string;
  statusDisconnected: string;
  billingAdd: string;
  billingVerify: string;
  billingVerifyUnknown: string;
  billingVerifying: string;
  billingConfirmed: string;
  billingStillMissing: string;
  billingStillUnknown: string;
  tokenInvalidHint: string;
  disconnectedHint: string;
  // Row
  badgeDefault: string;
  badgeCoexistence: string;
  channelLabel: (channel: Channel) => string;
  onboardedVia: (via: OnboardedVia) => string;
  // Label
  labelEdit: string;
  labelInput: string;
  labelPlaceholder: string;
  labelSave: string;
  labelCancel: string;
  // Agent
  agentPause: string;
  agentPausedOn: (phone: string) => string;
  agentResumedOn: (phone: string) => string;
  agentStatusPaused: string;
  agentStatusActive: string;
  agentMode: string;
  agentModeInherit: string;
  agentModeAuto: string;
  agentModeDraft: string;
  // Default
  setDefault: string;
  defaultSet: (phone: string) => string;
  // Disconnect
  disconnect: string;
  disconnectTitle: (phone: string) => string;
  disconnectDescription: string;
  /** The extra line of the disconnect dialog: history stays and admins can export it. */
  disconnectExportHint: string;
  disconnectConfirmLabel: (digits: string) => string;
  disconnectConfirm: string;
  disconnecting: string;
  disconnected: (phone: string) => string;
  disconnectMismatch: string;
  // Export (route handler download)
  exportConversations: string;
  /** Tooltip of the export link: what the file contains. */
  exportHint: string;
  // Delete history (`allowPurge`)
  purge: string;
  purgeTitle: (phone: string) => string;
  purgeDescription: string;
  purgeConfirmLabel: (phone: string) => string;
  purgeConfirm: string;
  purging: string;
  purged: (phone: string) => string;
  purgeMismatch: string;
  // Errors
  actionFailed: string;
  noPermission: string;
}

const ONBOARDED_VIA_ES: Record<OnboardedVia, string> = {
  manual: "Alta manual",
  embedded_signup: "Conectado con Meta",
  connect: "Sendo Connect",
};

const ONBOARDED_VIA_EN: Record<OnboardedVia, string> = {
  manual: "Added manually",
  embedded_signup: "Connected through Meta",
  connect: "Sendo Connect",
};

const es: NumbersStrings = {
  pageTitle: "Números de WhatsApp",
  navLabel: "Secciones",
  navInbox: "Bandeja",
  navNumbers: "Números",
  backToInbox: "Bandeja",
  title: "Números",
  subtitle: "Los números de WhatsApp de tu organización.",
  count: (count, format) => (count === 1 ? "1 número" : `${format.number(count)} números`),
  readOnlyNotice: "Solo los administradores pueden cambiar los números.",
  hidden: "Solo los administradores pueden ver los números.",
  forbidden: "No tienes acceso a los números.",
  loadFailed: "No se pudieron cargar los números.",
  emptyTitle: "Todavía no hay números conectados",
  emptyDescription:
    "Conecta el WhatsApp de tu organización. Meta abre una ventana para elegir la cuenta y el número; no necesitas salir de la app.",
  emptyReadOnly: "Pide a un administrador que conecte el número de WhatsApp.",
  connectFirst: "Conectar WhatsApp",
  connectAnother: "Conectar otro",
  connecting: "Conectando…",
  connectPreparing: "Preparando Meta…",
  connectNotConfigured:
    "Para conectar números configura NEXT_PUBLIC_SENDO_META_APP_ID y NEXT_PUBLIC_SENDO_META_CONFIG_ID.",
  connectChooseTitle: "Conectar un número de WhatsApp",
  connectChooseDescription:
    "Meta abrirá una ventana para elegir la cuenta de WhatsApp Business y el número.",
  connectCloudTitle: "Un número nuevo",
  connectCloudDescription: "Un número que no usas en la app WhatsApp Business del teléfono.",
  connectCoexistenceTitle: "El número que ya usas en el teléfono",
  connectCoexistenceDescription:
    "Sigues respondiendo desde la app WhatsApp Business y tu equipo, desde aquí.",
  connected: (phone) => `${phone} conectado`,
  reconnect: "Reconectar",
  reconnected: (phone) => `${phone} reconectado`,
  signupCancelled: "Conexión cancelada. No se creó nada.",
  signupMetaError: "Meta no pudo completar la conexión. Intenta de nuevo.",
  signupNoNumber: "Meta no devolvió un número. Vuelve a intentarlo y elige un número.",
  signupCodeExpired: "El enlace con Meta expiró, intenta de nuevo.",
  signupPermissionMissing:
    "Tu app de Meta todavía no tiene los permisos para conectar números (revisión de la app).",
  signupPermissionDocs: "Ver requisitos",
  signupAccountExists: "Este número ya está conectado en otra organización",
  signupAlreadyConnected: "Este número ya está conectado.",
  signupWrongNumber: (phone) => `Elegiste otro número en Meta. Para reconectar, elige ${phone}.`,
  signupFailed: "No se pudo conectar el número. Intenta de nuevo.",
  signupConfigError: "Falta configurar Embedded Signup en el servidor.",
  sdkLoadFailed: "No se pudo cargar Meta. Revisa la conexión o el bloqueador de anuncios.",
  pinTitle: "Este número tiene verificación en dos pasos",
  pinDescription:
    "Escribe el PIN de 6 dígitos del número. Meta abrirá la ventana otra vez para terminar.",
  pinLabel: "PIN de 6 dígitos",
  pinInvalid: "El PIN tiene 6 dígitos.",
  pinSubmit: "Conectar con el PIN",
  cancel: "Cancelar",
  close: "Cerrar",
  statusConnected: "Conectado",
  statusBillingMissing: "Conectado · falta método de pago",
  statusBillingUnknown: "Conectado · estado de pago desconocido",
  statusTokenInvalid: "Token inválido · reconectar",
  statusDisconnected: "Desconectado",
  billingAdd: "Agregar en Meta",
  billingVerify: "Ya lo agregué, verificar",
  billingVerifyUnknown: "Verificar",
  billingVerifying: "Verificando…",
  billingConfirmed: "Método de pago confirmado.",
  billingStillMissing: "Meta todavía no muestra un método de pago.",
  billingStillUnknown: "Meta no dijo si hay método de pago. El primer envío lo confirma.",
  tokenInvalidHint: "Meta rechazó el acceso. Conéctalo otra vez; el historial se conserva.",
  disconnectedHint: "Las conversaciones siguen visibles, sin respuestas.",
  badgeDefault: "Por defecto",
  badgeCoexistence: "También en la app del teléfono",
  channelLabel: () => "WhatsApp",
  onboardedVia: (via) => ONBOARDED_VIA_ES[via],
  labelEdit: "Editar etiqueta",
  labelInput: "Etiqueta",
  labelPlaceholder: "Ej. Cobranza",
  labelSave: "Guardar",
  labelCancel: "Cancelar",
  agentPause: "Pausar agente",
  agentPausedOn: (phone) => `Agente pausado en ${phone}`,
  agentResumedOn: (phone) => `Agente activo en ${phone}`,
  agentStatusPaused: "Agente pausado",
  agentStatusActive: "Agente activo",
  agentMode: "Modo del agente",
  agentModeInherit: "Según el agente",
  agentModeAuto: "Responde solo",
  agentModeDraft: "Propone borradores",
  setDefault: "Marcar por defecto",
  defaultSet: (phone) => `${phone} es el número por defecto`,
  disconnect: "Desconectar",
  disconnectTitle: (phone) => `Desconectar ${phone}`,
  disconnectDescription:
    "Las conversaciones anteriores siguen visibles, pero ya no se podrá responder desde este número y el agente deja de contestar. Puedes volver a conectarlo después.",
  disconnectExportHint:
    "El historial se conserva: un administrador puede exportarlo desde la pantalla de números.",
  disconnectConfirmLabel: (digits) => `Escribe ${digits}, los últimos 4 dígitos, para confirmar`,
  disconnectConfirm: "Desconectar número",
  disconnecting: "Desconectando…",
  disconnected: (phone) => `${phone} desconectado`,
  disconnectMismatch: "Los dígitos no coinciden.",
  exportConversations: "Exportar conversaciones",
  exportHint:
    "Descarga un archivo JSON con los contactos, conversaciones, notas, etiquetas y referencias a archivos de este número.",
  purge: "Borrar historial",
  purgeTitle: (phone) => `Borrar el historial de ${phone}`,
  purgeDescription:
    "Se borran para siempre los contactos, conversaciones, mensajes y archivos de este número. No se puede deshacer. Si necesitas una copia, exporta las conversaciones antes.",
  purgeConfirmLabel: (phone) => `Escribe el número completo, ${phone}, para confirmar`,
  purgeConfirm: "Borrar historial",
  purging: "Borrando…",
  purged: (phone) => `Historial de ${phone} borrado`,
  purgeMismatch: "El número no coincide.",
  actionFailed: "No se pudo actualizar el número.",
  noPermission: "No tienes permiso para cambiar los números.",
};

const en: NumbersStrings = {
  pageTitle: "WhatsApp numbers",
  navLabel: "Sections",
  navInbox: "Inbox",
  navNumbers: "Numbers",
  backToInbox: "Inbox",
  title: "Numbers",
  subtitle: "Your organization's WhatsApp numbers.",
  count: (count, format) => (count === 1 ? "1 number" : `${format.number(count)} numbers`),
  readOnlyNotice: "Only admins can change numbers.",
  hidden: "Only admins can see the numbers.",
  forbidden: "You don't have access to the numbers.",
  loadFailed: "The numbers couldn't be loaded.",
  emptyTitle: "No numbers connected yet",
  emptyDescription:
    "Connect your organization's WhatsApp. Meta opens a window to pick the account and the number; you don't need to leave the app.",
  emptyReadOnly: "Ask an admin to connect the WhatsApp number.",
  connectFirst: "Connect WhatsApp",
  connectAnother: "Connect another",
  connecting: "Connecting…",
  connectPreparing: "Preparing Meta…",
  connectNotConfigured:
    "To connect numbers, set NEXT_PUBLIC_SENDO_META_APP_ID and NEXT_PUBLIC_SENDO_META_CONFIG_ID.",
  connectChooseTitle: "Connect a WhatsApp number",
  connectChooseDescription:
    "Meta will open a window to pick the WhatsApp Business account and the number.",
  connectCloudTitle: "A new number",
  connectCloudDescription: "A number you don't use in the WhatsApp Business app on a phone.",
  connectCoexistenceTitle: "The number you already use on your phone",
  connectCoexistenceDescription:
    "You keep answering from the WhatsApp Business app, and your team answers from here.",
  connected: (phone) => `${phone} connected`,
  reconnect: "Reconnect",
  reconnected: (phone) => `${phone} reconnected`,
  signupCancelled: "Connection cancelled. Nothing was created.",
  signupMetaError: "Meta couldn't finish connecting. Try again.",
  signupNoNumber: "Meta didn't return a number. Try again and pick a number.",
  signupCodeExpired: "The link with Meta expired. Try again.",
  signupPermissionMissing:
    "Your Meta app doesn't have the permissions to connect numbers yet (app review).",
  signupPermissionDocs: "See requirements",
  signupAccountExists: "This number is already connected in another organization",
  signupAlreadyConnected: "This number is already connected.",
  signupWrongNumber: (phone) => `You picked another number in Meta. To reconnect, pick ${phone}.`,
  signupFailed: "The number couldn't be connected. Try again.",
  signupConfigError: "Embedded Signup isn't set up on the server.",
  sdkLoadFailed: "Meta couldn't be loaded. Check your connection or ad blocker.",
  pinTitle: "This number has two-step verification",
  pinDescription: "Type the number's 6-digit PIN. Meta will open the window again to finish.",
  pinLabel: "6-digit PIN",
  pinInvalid: "The PIN has 6 digits.",
  pinSubmit: "Connect with the PIN",
  cancel: "Cancel",
  close: "Close",
  statusConnected: "Connected",
  statusBillingMissing: "Connected · payment method missing",
  statusBillingUnknown: "Connected · payment status unknown",
  statusTokenInvalid: "Invalid token · reconnect",
  statusDisconnected: "Disconnected",
  billingAdd: "Add in Meta",
  billingVerify: "I added it, check again",
  billingVerifyUnknown: "Check",
  billingVerifying: "Checking…",
  billingConfirmed: "Payment method confirmed.",
  billingStillMissing: "Meta doesn't show a payment method yet.",
  billingStillUnknown:
    "Meta didn't say whether there's a payment method. The first send confirms it.",
  tokenInvalidHint: "Meta rejected the access. Connect it again; the history is kept.",
  disconnectedHint: "Conversations stay readable, without replies.",
  badgeDefault: "Default",
  badgeCoexistence: "Also in the phone app",
  channelLabel: () => "WhatsApp",
  onboardedVia: (via) => ONBOARDED_VIA_EN[via],
  labelEdit: "Edit label",
  labelInput: "Label",
  labelPlaceholder: "E.g. Billing",
  labelSave: "Save",
  labelCancel: "Cancel",
  agentPause: "Pause agent",
  agentPausedOn: (phone) => `Agent paused on ${phone}`,
  agentResumedOn: (phone) => `Agent active on ${phone}`,
  agentStatusPaused: "Agent paused",
  agentStatusActive: "Agent active",
  agentMode: "Agent mode",
  agentModeInherit: "As the agent says",
  agentModeAuto: "Replies on its own",
  agentModeDraft: "Proposes drafts",
  setDefault: "Make default",
  defaultSet: (phone) => `${phone} is the default number`,
  disconnect: "Disconnect",
  disconnectTitle: (phone) => `Disconnect ${phone}`,
  disconnectDescription:
    "Past conversations stay readable, but nobody can reply from this number and the agent stops answering. You can connect it again later.",
  disconnectExportHint: "The history is kept: an admin can export it from the numbers screen.",
  disconnectConfirmLabel: (digits) => `Type ${digits}, the last 4 digits, to confirm`,
  disconnectConfirm: "Disconnect number",
  disconnecting: "Disconnecting…",
  disconnected: (phone) => `${phone} disconnected`,
  disconnectMismatch: "The digits don't match.",
  exportConversations: "Export conversations",
  exportHint:
    "Downloads a JSON file with this number's contacts, conversations, notes, tags and media references.",
  purge: "Delete history",
  purgeTitle: (phone) => `Delete the history of ${phone}`,
  purgeDescription:
    "This permanently deletes the contacts, conversations, messages and media of this number. It can't be undone. If you need a copy, export the conversations first.",
  purgeConfirmLabel: (phone) => `Type the full number, ${phone}, to confirm`,
  purgeConfirm: "Delete history",
  purging: "Deleting…",
  purged: (phone) => `History of ${phone} deleted`,
  purgeMismatch: "The number doesn't match.",
  actionFailed: "The number couldn't be updated.",
  noPermission: "You don't have permission to change numbers.",
};

/** The numbers strings of every `SendoLocale`. Add an object here when you add a language. */
export const numbersStrings = { es, en } satisfies Record<SendoLocale, NumbersStrings>;

/** The strings of `locale`, with `overrides` on top (`<NumbersScreen strings>`). */
export function resolveNumbersStrings(
  locale: SendoLocale,
  overrides?: Partial<NumbersStrings>,
): NumbersStrings {
  const strings: NumbersStrings = numbersStrings[locale];
  return overrides === undefined ? strings : { ...strings, ...overrides };
}
