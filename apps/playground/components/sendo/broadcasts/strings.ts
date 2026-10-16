import type { SendoLocale } from "@/lib/sendo-ui";
import type { BroadcastsFormat } from "./format";
import type {
  BroadcastsErrorCode,
  BroadcastStatusValue,
  RecipientStatus,
  SkipReason,
} from "./types";

/**
 * Every text of the `broadcasts` item, one object per `SendoLocale`. Override single keys through
 * `<BroadcastsScreen strings>`. Functions that show a count get `format` (the screen's
 * `formatLocale`), so numbers and plurals follow the locale.
 */
export interface BroadcastsStrings {
  /** The page `<title>` (`generateMetadata` in page.tsx) and the screen heading. */
  pageTitle: string;
  backToInbox: string;
  pageDescription: string;
  forbiddenTitle: string;
  forbiddenBody: string;
  noNumbersTitle: string;
  noNumbersBody: string;

  newBroadcast: string;
  listLabel: string;
  emptyTitle: string;
  emptyBody: string;
  loadMore: string;
  loading: string;
  retry: string;
  dismiss: string;
  back: string;
  backToList: string;

  statusLabels: Record<BroadcastStatusValue, string>;
  pausedBilling: string;
  recipientStatusLabels: Record<RecipientStatus, string>;
  skipReasonLabels: Record<SkipReason, string>;
  skipReasonHints: Record<SkipReason, string>;
  unknownSkipReason: string;
  categoryLabels: Record<string, string>;
  categoryRules: Record<string, string>;
  unknownCategoryRule: string;

  numberName: (label: string | null, phone: string) => string;
  unknownNumber: string;
  disconnected: string;
  progressShort: (done: number, total: number, format: BroadcastsFormat) => string;
  createdOn: (date: string) => string;
  perMinute: (rate: number, format: BroadcastsFormat) => string;

  composeTitle: string;
  composeDescription: string;
  stepTemplate: string;
  numberLabel: string;
  numberPlaceholder: string;
  billingWarning: string;
  templateLabel: string;
  templatePlaceholder: string;
  templatesLoading: string;
  templatesEmpty: string;
  templatesFailed: string;
  templatePreview: string;
  stepVariables: string;
  variablesHint: string;
  variableLabel: (index: number) => string;
  variablesIncomplete: string;
  stepRecipients: string;
  recipientsHint: string;
  audiencesLoading: string;
  audiencesFailed: string;
  audiencesEmptyTitle: string;
  audiencesEmptyBody: string;
  audienceSize: (count: number, format: BroadcastsFormat) => string;
  stepRate: string;
  rateLabel: string;
  rateHint: string;
  rateInvalid: (max: number, format: BroadcastsFormat) => string;
  cancelCompose: string;
  review: string;
  reviewing: string;

  reviewTitle: string;
  reviewDescription: string;
  summaryTemplate: string;
  summaryNumber: string;
  summaryAudience: string;
  summaryRate: string;
  previewTotal: string;
  previewEligible: string;
  previewSkipped: string;
  previewBreakdown: string;
  noneEligibleTitle: string;
  noneEligibleBody: (category: string) => string;
  estimatedTime: (minutes: number, rate: number, format: BroadcastsFormat) => string;
  costTitle: string;
  costBody: (category: string) => string;
  costLink: string;
  billingReviewWarning: string;
  confirm: (eligible: number, format: BroadcastsFormat) => string;
  confirmNone: string;
  sending: string;

  progressTitle: string;
  processed: (done: number, total: number, format: BroadcastsFormat) => string;
  countsLabel: string;
  cancel: string;
  /** Screen-reader label of the dialogs' close (X) button. */
  close: string;
  cancelTitle: string;
  cancelBody: (pending: number, format: BroadcastsFormat) => string;
  cancelConfirm: string;
  cancelKeep: string;
  cancelling: string;
  billingBannerTitle: string;
  billingBannerBody: string;
  billingBannerLink: string;
  failedBannerTitle: string;
  failedBannerBody: string;
  cancelledBanner: (cancelled: number, format: BroadcastsFormat) => string;
  doneBanner: string;
  noneDeliveredTitle: string;
  noneDeliveredBody: string;
  queuedBanner: string;

  recipientsTitle: string;
  recipientsFilterLabel: string;
  filterAll: string;
  recipientsEmpty: string;
  recipientsShowing: (shown: number, total: number, format: BroadcastsFormat) => string;
  refreshAvailable: string;
  refresh: string;
  colContact: string;
  colStatus: string;
  colDetail: string;
  noName: string;
  noPhone: string;
  metaError: (code: number | null) => string;
  updatedAt: (time: string) => string;

  errors: Record<BroadcastsErrorCode, string>;
  variablesError: (expected: number, format: BroadcastsFormat) => string;
}

const es: BroadcastsStrings = {
  pageTitle: "Envíos",
  backToInbox: "Volver a la bandeja",
  pageDescription:
    "Manda una plantilla aprobada a muchos contactos a la vez. Solo la reciben quienes pueden recibirla, y ves el resultado de cada uno.",
  forbiddenTitle: "No tienes acceso a Envíos",
  forbiddenBody: "Solo los administradores pueden crear y ver envíos masivos.",
  noNumbersTitle: "Aún no hay números conectados",
  noNumbersBody: "Conecta un número de WhatsApp para poder hacer envíos.",

  newBroadcast: "Nuevo envío",
  listLabel: "Envíos recientes",
  emptyTitle: "Aún no hay envíos",
  emptyBody:
    "Elige una plantilla aprobada y una lista de contactos. Antes de enviar verás cuántos la recibirán.",
  loadMore: "Cargar más",
  loading: "Cargando…",
  retry: "Reintentar",
  dismiss: "Cerrar aviso",
  back: "Volver",
  backToList: "Envíos",

  statusLabels: {
    queued: "En cola",
    sending: "Enviando",
    paused: "En pausa",
    done: "Terminado",
    cancelled: "Cancelado",
    failed: "Detenido",
  },
  pausedBilling: "En pausa · falta método de pago",
  recipientStatusLabels: {
    pending: "Pendiente",
    sent: "Enviado",
    delivered: "Entregado",
    read: "Leído",
    failed: "Falló",
    skipped: "Omitido",
    cancelled: "Cancelado",
  },
  skipReasonLabels: {
    no_opt_in: "Sin permiso de marketing",
    opted_out: "Pidió no recibir mensajes",
    invalid_phone: "Teléfono inválido",
  },
  skipReasonHints: {
    no_opt_in: "Las plantillas de marketing solo van a contactos que aceptaron recibirlas.",
    opted_out:
      "Respondieron BAJA (u otra palabra de baja) o tu app registró que no quieren mensajes.",
    invalid_phone: "El número no tiene un formato válido; no se guardó como contacto.",
  },
  unknownSkipReason: "Omitido",
  categoryLabels: {
    MARKETING: "Marketing",
    UTILITY: "Utilidad",
    AUTHENTICATION: "Autenticación",
  },
  categoryRules: {
    MARKETING: "Marketing: solo contactos que aceptaron recibir promociones.",
    UTILITY: "Utilidad: todos los contactos que no se dieron de baja.",
    AUTHENTICATION: "Autenticación: todos los contactos que no se dieron de baja.",
  },
  unknownCategoryRule:
    "Categoría desconocida: se trata como marketing (solo contactos que aceptaron).",

  numberName: (label, phone) =>
    label === null || label.trim() === "" ? phone : `${label} · ${phone}`,
  unknownNumber: "Número eliminado",
  disconnected: "desconectado",
  progressShort: (done, total, format) =>
    `${format.number(done)} de ${format.number(total)} procesados`,
  createdOn: (date) => `Creado ${date}`,
  perMinute: (rate, format) => `${format.number(rate)} por minuto`,

  composeTitle: "Nuevo envío",
  composeDescription: "Nada se envía hasta que revises cuántos contactos lo recibirán y confirmes.",
  stepTemplate: "Número y plantilla",
  numberLabel: "Número",
  numberPlaceholder: "Elige un número",
  billingWarning:
    "Este número no tiene método de pago en Meta. El envío quedará en pausa hasta que lo agregues.",
  templateLabel: "Plantilla aprobada",
  templatePlaceholder: "Elige una plantilla",
  templatesLoading: "Cargando plantillas…",
  templatesEmpty:
    "Este número no tiene plantillas aprobadas. Créalas en WhatsApp Manager y sincronízalas.",
  templatesFailed: "No se pudieron cargar las plantillas.",
  templatePreview: "Vista previa",
  stepVariables: "Variables",
  variablesHint:
    "Iguales para todos. Déjalas vacías si tu lista ya trae los valores de cada contacto.",
  variableLabel: (index) => `Variable {{${String(index)}}}`,
  variablesIncomplete: "Completa todas las variables o deja todas vacías.",
  stepRecipients: "Destinatarios",
  recipientsHint: "Listas y filtros que define tu app.",
  audiencesLoading: "Cargando listas…",
  audiencesFailed: "No se pudieron cargar las listas de contactos.",
  audiencesEmptyTitle: "Tu app aún no ofrece listas de contactos",
  audiencesEmptyBody:
    "Agrégalas en broadcastAudiences (app/(protected)/inbox/broadcasts/broadcasts-config.ts).",
  audienceSize: (count, format) =>
    `${format.number(count)} ${format.plural(count, { one: "contacto", other: "contactos" })}`,
  stepRate: "Ritmo",
  rateLabel: "Mensajes por minuto",
  rateHint:
    "Meta también limita según el nivel del número. Si se alcanza, el envío espera y sigue al minuto siguiente.",
  rateInvalid: (max, format) => `Escribe un número entero entre 1 y ${format.number(max)}.`,
  cancelCompose: "Cancelar",
  review: "Revisar envío",
  reviewing: "Calculando…",

  reviewTitle: "Revisa y confirma",
  reviewDescription: "Así quedaría el envío. Todavía no se ha enviado nada.",
  summaryTemplate: "Plantilla",
  summaryNumber: "Número",
  summaryAudience: "Destinatarios",
  summaryRate: "Ritmo",
  previewTotal: "En la lista",
  previewEligible: "Lo recibirán",
  previewSkipped: "Se omitirán",
  previewBreakdown: "Por qué se omiten",
  noneEligibleTitle: "Nadie de esta lista puede recibir esta plantilla",
  noneEligibleBody: (category) =>
    category === "MARKETING"
      ? "Las plantillas de marketing solo van a contactos que aceptaron recibirlas. Elige otra lista o una plantilla de utilidad."
      : "Todos los contactos se dieron de baja o tienen un teléfono inválido. Elige otra lista.",
  estimatedTime: (minutes, rate, format) =>
    minutes <= 1
      ? `Tarda alrededor de un minuto (${format.number(rate)} por minuto).`
      : `Tarda alrededor de ${format.number(minutes)} minutos (${format.number(rate)} por minuto).`,
  costTitle: "Costo",
  costBody: (category) =>
    `Meta cobra cada mensaje entregado directamente a la cuenta de WhatsApp Business del número, según la categoría de la plantilla (${category}) y el país de cada contacto. Sendo no cobra por mensaje.`,
  costLink: "Ver tarifas oficiales de Meta",
  billingReviewWarning:
    "El número no tiene método de pago en Meta: el envío quedará en pausa hasta que lo agregues.",
  confirm: (eligible, format) =>
    `Enviar a ${format.number(eligible)} ${format.plural(eligible, { one: "contacto", other: "contactos" })}`,
  confirmNone: "Nadie puede recibirlo",
  sending: "Creando envío…",

  progressTitle: "Progreso",
  processed: (done, total, format) =>
    `${format.number(done)} de ${format.number(total)} procesados`,
  countsLabel: "Resultado por estado",
  cancel: "Cancelar envío",
  close: "Cerrar",
  cancelTitle: "¿Cancelar este envío?",
  cancelBody: (pending, format) =>
    `${format.number(pending)} ${format.plural(pending, { one: "contacto pendiente no recibirá", other: "contactos pendientes no recibirán" })} el mensaje. Los mensajes ya enviados no se pueden retirar.`,
  cancelConfirm: "Cancelar envío",
  cancelKeep: "Seguir enviando",
  cancelling: "Cancelando…",
  billingBannerTitle: "En pausa: falta método de pago en Meta",
  billingBannerBody:
    "Meta rechazó el envío porque la cuenta de WhatsApp Business no tiene método de pago. Los pendientes siguen en cola y el envío se reanuda solo cuando Meta confirme el método de pago.",
  billingBannerLink: "Agregar método de pago",
  failedBannerTitle: "El envío se detuvo",
  failedBannerBody:
    "La plantilla dejó de estar aprobada en Meta. Los contactos pendientes se cancelaron.",
  cancelledBanner: (cancelled, format) =>
    `Cancelado. ${format.number(cancelled)} ${format.plural(cancelled, { one: "contacto no recibió", other: "contactos no recibieron" })} el mensaje.`,
  doneBanner: "Terminado. Las entregas y lecturas se siguen actualizando cuando Meta las informa.",
  noneDeliveredTitle: "Ningún mensaje salió",
  noneDeliveredBody:
    "Todos los envíos fallaron. Revisa el error de cada contacto abajo: suele ser la plantilla, el número o la calidad de la cuenta en Meta.",
  queuedBanner: "En cola: el primer lote sale en el próximo minuto.",

  recipientsTitle: "Destinatarios",
  recipientsFilterLabel: "Filtrar por estado",
  filterAll: "Todos",
  recipientsEmpty: "Nadie en este estado.",
  recipientsShowing: (shown, total, format) =>
    `Mostrando ${format.number(shown)} de ${format.number(total)}`,
  refreshAvailable: "Hay resultados nuevos.",
  refresh: "Actualizar",
  colContact: "Contacto",
  colStatus: "Estado",
  colDetail: "Detalle",
  noName: "Sin nombre",
  noPhone: "Sin teléfono",
  metaError: (code) => (code === null ? "No se envió" : `Error de Meta ${String(code)}`),
  updatedAt: (time) => `Actualizado ${time}`,

  errors: {
    FORBIDDEN: "No tienes permiso para hacer envíos.",
    NOT_FOUND: "No se encontró el envío o el número.",
    TEMPLATE: "La plantilla ya no está aprobada o no existe en este número.",
    VARIABLES: "La plantilla necesita otras variables.",
    INVALID: "Revisa los datos del envío.",
    AUDIENCE: "No se pudo obtener la lista de contactos de tu app.",
    EMPTY_AUDIENCE: "Esta lista no tiene contactos. Elige otra.",
    UNKNOWN: "Algo salió mal. Intenta de nuevo.",
  },
  variablesError: (expected, format) =>
    `La plantilla necesita ${format.number(expected)} ${format.plural(expected, { one: "variable", other: "variables" })} para cada contacto.`,
};

const en: BroadcastsStrings = {
  pageTitle: "Broadcasts",
  backToInbox: "Back to inbox",
  pageDescription:
    "Send an approved template to many contacts at once. Only contacts who can receive it get it, and you see the result for each one.",
  forbiddenTitle: "You don't have access to Broadcasts",
  forbiddenBody: "Only admins can create and view broadcasts.",
  noNumbersTitle: "No numbers connected yet",
  noNumbersBody: "Connect a WhatsApp number to start sending broadcasts.",

  newBroadcast: "New broadcast",
  listLabel: "Recent broadcasts",
  emptyTitle: "No broadcasts yet",
  emptyBody:
    "Pick an approved template and a contact list. Before sending you'll see how many contacts will get it.",
  loadMore: "Load more",
  loading: "Loading…",
  retry: "Retry",
  dismiss: "Dismiss",
  back: "Back",
  backToList: "Broadcasts",

  statusLabels: {
    queued: "Queued",
    sending: "Sending",
    paused: "Paused",
    done: "Done",
    cancelled: "Cancelled",
    failed: "Stopped",
  },
  pausedBilling: "Paused · payment method missing",
  recipientStatusLabels: {
    pending: "Pending",
    sent: "Sent",
    delivered: "Delivered",
    read: "Read",
    failed: "Failed",
    skipped: "Skipped",
    cancelled: "Cancelled",
  },
  skipReasonLabels: {
    no_opt_in: "No marketing opt-in",
    opted_out: "Opted out",
    invalid_phone: "Invalid phone",
  },
  skipReasonHints: {
    no_opt_in: "Marketing templates only go to contacts who agreed to receive them.",
    opted_out:
      "They replied STOP (or another opt-out keyword), or your app recorded that they don't want messages.",
    invalid_phone: "The number isn't in a valid format; it wasn't saved as a contact.",
  },
  unknownSkipReason: "Skipped",
  categoryLabels: {
    MARKETING: "Marketing",
    UTILITY: "Utility",
    AUTHENTICATION: "Authentication",
  },
  categoryRules: {
    MARKETING: "Marketing: only contacts who agreed to receive promotions.",
    UTILITY: "Utility: every contact who hasn't opted out.",
    AUTHENTICATION: "Authentication: every contact who hasn't opted out.",
  },
  unknownCategoryRule: "Unknown category: treated as marketing (only contacts who agreed).",

  numberName: (label, phone) =>
    label === null || label.trim() === "" ? phone : `${label} · ${phone}`,
  unknownNumber: "Deleted number",
  disconnected: "disconnected",
  progressShort: (done, total, format) =>
    `${format.number(done)} of ${format.number(total)} processed`,
  createdOn: (date) => `Created ${date}`,
  perMinute: (rate, format) => `${format.number(rate)} per minute`,

  composeTitle: "New broadcast",
  composeDescription:
    "Nothing goes out until you review how many contacts will get it and confirm.",
  stepTemplate: "Number and template",
  numberLabel: "Number",
  numberPlaceholder: "Pick a number",
  billingWarning:
    "This number has no payment method in Meta. The broadcast will stay paused until you add one.",
  templateLabel: "Approved template",
  templatePlaceholder: "Pick a template",
  templatesLoading: "Loading templates…",
  templatesEmpty:
    "This number has no approved templates. Create them in WhatsApp Manager and sync them.",
  templatesFailed: "Couldn't load the templates.",
  templatePreview: "Preview",
  stepVariables: "Variables",
  variablesHint:
    "The same for everyone. Leave them empty if your list already has each contact's values.",
  variableLabel: (index) => `Variable {{${String(index)}}}`,
  variablesIncomplete: "Fill in every variable or leave them all empty.",
  stepRecipients: "Recipients",
  recipientsHint: "Lists and filters your app defines.",
  audiencesLoading: "Loading lists…",
  audiencesFailed: "Couldn't load the contact lists.",
  audiencesEmptyTitle: "Your app doesn't offer contact lists yet",
  audiencesEmptyBody:
    "Add them in broadcastAudiences (app/(protected)/inbox/broadcasts/broadcasts-config.ts).",
  audienceSize: (count, format) =>
    `${format.number(count)} ${format.plural(count, { one: "contact", other: "contacts" })}`,
  stepRate: "Pace",
  rateLabel: "Messages per minute",
  rateHint:
    "Meta also limits by the number's tier. When the limit is hit, the broadcast waits and continues the next minute.",
  rateInvalid: (max, format) => `Enter a whole number from 1 to ${format.number(max)}.`,
  cancelCompose: "Cancel",
  review: "Review broadcast",
  reviewing: "Calculating…",

  reviewTitle: "Review and confirm",
  reviewDescription: "This is how the broadcast would go out. Nothing has been sent yet.",
  summaryTemplate: "Template",
  summaryNumber: "Number",
  summaryAudience: "Recipients",
  summaryRate: "Pace",
  previewTotal: "On the list",
  previewEligible: "Will get it",
  previewSkipped: "Will be skipped",
  previewBreakdown: "Why they're skipped",
  noneEligibleTitle: "Nobody on this list can receive this template",
  noneEligibleBody: (category) =>
    category === "MARKETING"
      ? "Marketing templates only go to contacts who agreed to receive them. Pick another list or a utility template."
      : "Every contact opted out or has an invalid phone. Pick another list.",
  estimatedTime: (minutes, rate, format) =>
    minutes <= 1
      ? `Takes about a minute (${format.number(rate)} per minute).`
      : `Takes about ${format.number(minutes)} minutes (${format.number(rate)} per minute).`,
  costTitle: "Cost",
  costBody: (category) =>
    `Meta charges each delivered message directly to the number's WhatsApp Business account, based on the template category (${category}) and each contact's country. Sendo doesn't charge per message.`,
  costLink: "See Meta's official rates",
  billingReviewWarning:
    "The number has no payment method in Meta: the broadcast will stay paused until you add one.",
  confirm: (eligible, format) =>
    `Send to ${format.number(eligible)} ${format.plural(eligible, { one: "contact", other: "contacts" })}`,
  confirmNone: "Nobody can receive it",
  sending: "Creating broadcast…",

  progressTitle: "Progress",
  processed: (done, total, format) => `${format.number(done)} of ${format.number(total)} processed`,
  countsLabel: "Results by status",
  cancel: "Cancel broadcast",
  close: "Close",
  cancelTitle: "Cancel this broadcast?",
  cancelBody: (pending, format) =>
    `${format.number(pending)} pending ${format.plural(pending, { one: "contact won't", other: "contacts won't" })} get the message. Messages already sent can't be taken back.`,
  cancelConfirm: "Cancel broadcast",
  cancelKeep: "Keep sending",
  cancelling: "Cancelling…",
  billingBannerTitle: "Paused: payment method missing in Meta",
  billingBannerBody:
    "Meta rejected the broadcast because the WhatsApp Business account has no payment method. Pending contacts stay queued, and the broadcast resumes on its own once Meta confirms the payment method.",
  billingBannerLink: "Add payment method",
  failedBannerTitle: "The broadcast stopped",
  failedBannerBody: "The template is no longer approved in Meta. Pending contacts were cancelled.",
  cancelledBanner: (cancelled, format) =>
    `Cancelled. ${format.number(cancelled)} ${format.plural(cancelled, { one: "contact didn't", other: "contacts didn't" })} get the message.`,
  doneBanner: "Done. Deliveries and reads keep updating as Meta reports them.",
  noneDeliveredTitle: "No message went out",
  noneDeliveredBody:
    "Every send failed. Check each contact's error below: it's usually the template, the number or the account's quality in Meta.",
  queuedBanner: "Queued: the first batch goes out within the next minute.",

  recipientsTitle: "Recipients",
  recipientsFilterLabel: "Filter by status",
  filterAll: "All",
  recipientsEmpty: "Nobody in this status.",
  recipientsShowing: (shown, total, format) =>
    `Showing ${format.number(shown)} of ${format.number(total)}`,
  refreshAvailable: "New results are available.",
  refresh: "Refresh",
  colContact: "Contact",
  colStatus: "Status",
  colDetail: "Detail",
  noName: "No name",
  noPhone: "No phone",
  metaError: (code) => (code === null ? "Not sent" : `Meta error ${String(code)}`),
  updatedAt: (time) => `Updated ${time}`,

  errors: {
    FORBIDDEN: "You don't have permission to send broadcasts.",
    NOT_FOUND: "The broadcast or the number wasn't found.",
    TEMPLATE: "The template is no longer approved or doesn't exist on this number.",
    VARIABLES: "The template needs different variables.",
    INVALID: "Check the broadcast details.",
    AUDIENCE: "Couldn't get the contact list from your app.",
    EMPTY_AUDIENCE: "This list has no contacts. Pick another one.",
    UNKNOWN: "Something went wrong. Try again.",
  },
  variablesError: (expected, format) =>
    `The template needs ${format.number(expected)} ${format.plural(expected, { one: "variable", other: "variables" })} for each contact.`,
};

/** The broadcasts strings of every `SendoLocale`. Add an object here when you add a language. */
export const broadcastsStrings = { es, en } satisfies Record<SendoLocale, BroadcastsStrings>;

/** The strings of `locale`, with `overrides` on top (`<BroadcastsScreen strings>`). */
export function resolveBroadcastsStrings(
  locale: SendoLocale,
  overrides?: Partial<BroadcastsStrings>,
): BroadcastsStrings {
  const strings: BroadcastsStrings = broadcastsStrings[locale];
  return overrides === undefined ? strings : { ...strings, ...overrides };
}
