import type {
  BroadcastsErrorCode,
  BroadcastStatusValue,
  RecipientStatus,
  SkipReason,
} from "./types";

const number = new Intl.NumberFormat("es");
const n = (value: number) => number.format(value);
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** Every text of the `broadcasts` item. Override any of them through the `strings` prop. */
export interface BroadcastsStrings {
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
  progressShort: (done: number, total: number) => string;
  createdOn: (date: string) => string;
  perMinute: (rate: number) => string;

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
  audienceSize: (count: number) => string;
  stepRate: string;
  rateLabel: string;
  rateHint: string;
  rateInvalid: (max: number) => string;
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
  estimatedTime: (minutes: number, rate: number) => string;
  costTitle: string;
  costBody: (category: string) => string;
  costLink: string;
  billingReviewWarning: string;
  confirm: (eligible: number) => string;
  confirmNone: string;
  sending: string;

  progressTitle: string;
  processed: (done: number, total: number) => string;
  countsLabel: string;
  cancel: string;
  /** Screen-reader label of the dialogs' close (X) button. */
  close: string;
  cancelTitle: string;
  cancelBody: (pending: number) => string;
  cancelConfirm: string;
  cancelKeep: string;
  cancelling: string;
  billingBannerTitle: string;
  billingBannerBody: string;
  billingBannerLink: string;
  failedBannerTitle: string;
  failedBannerBody: string;
  cancelledBanner: (cancelled: number) => string;
  doneBanner: string;
  noneDeliveredTitle: string;
  noneDeliveredBody: string;
  queuedBanner: string;

  recipientsTitle: string;
  recipientsFilterLabel: string;
  filterAll: string;
  recipientsEmpty: string;
  recipientsShowing: (shown: number, total: number) => string;
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
  variablesError: (expected: number) => string;
}

export const defaultBroadcastsStrings: BroadcastsStrings = {
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
  progressShort: (done, total) => `${n(done)} de ${n(total)} procesados`,
  createdOn: (date) => `Creado ${date}`,
  perMinute: (rate) => `${n(rate)} por minuto`,

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
  audienceSize: (count) => `${n(count)} ${plural(count, "contacto", "contactos")}`,
  stepRate: "Ritmo",
  rateLabel: "Mensajes por minuto",
  rateHint:
    "Meta también limita según el nivel del número. Si se alcanza, el envío espera y sigue al minuto siguiente.",
  rateInvalid: (max) => `Escribe un número entero entre 1 y ${n(max)}.`,
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
  estimatedTime: (minutes, rate) =>
    minutes <= 1
      ? `Tarda alrededor de un minuto (${n(rate)} por minuto).`
      : `Tarda alrededor de ${n(minutes)} minutos (${n(rate)} por minuto).`,
  costTitle: "Costo",
  costBody: (category) =>
    `Meta cobra cada mensaje entregado directamente a la cuenta de WhatsApp Business del número, según la categoría de la plantilla (${category}) y el país de cada contacto. Sendo no cobra por mensaje.`,
  costLink: "Ver tarifas oficiales de Meta",
  billingReviewWarning:
    "El número no tiene método de pago en Meta: el envío quedará en pausa hasta que lo agregues.",
  confirm: (eligible) => `Enviar a ${n(eligible)} ${plural(eligible, "contacto", "contactos")}`,
  confirmNone: "Nadie puede recibirlo",
  sending: "Creando envío…",

  progressTitle: "Progreso",
  processed: (done, total) => `${n(done)} de ${n(total)} procesados`,
  countsLabel: "Resultado por estado",
  cancel: "Cancelar envío",
  close: "Cerrar",
  cancelTitle: "¿Cancelar este envío?",
  cancelBody: (pending) =>
    `${n(pending)} ${plural(pending, "contacto pendiente no recibirá", "contactos pendientes no recibirán")} el mensaje. Los mensajes ya enviados no se pueden retirar.`,
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
  cancelledBanner: (cancelled) =>
    `Cancelado. ${n(cancelled)} ${plural(cancelled, "contacto no recibió", "contactos no recibieron")} el mensaje.`,
  doneBanner: "Terminado. Las entregas y lecturas se siguen actualizando cuando Meta las informa.",
  noneDeliveredTitle: "Ningún mensaje salió",
  noneDeliveredBody:
    "Todos los envíos fallaron. Revisa el error de cada contacto abajo: suele ser la plantilla, el número o la calidad de la cuenta en Meta.",
  queuedBanner: "En cola: el primer lote sale en el próximo minuto.",

  recipientsTitle: "Destinatarios",
  recipientsFilterLabel: "Filtrar por estado",
  filterAll: "Todos",
  recipientsEmpty: "Nadie en este estado.",
  recipientsShowing: (shown, total) => `Mostrando ${n(shown)} de ${n(total)}`,
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
  variablesError: (expected) =>
    `La plantilla necesita ${n(expected)} ${plural(expected, "variable", "variables")} para cada contacto.`,
};

export function resolveBroadcastsStrings(
  overrides?: Partial<BroadcastsStrings>,
): BroadcastsStrings {
  return overrides ? { ...defaultBroadcastsStrings, ...overrides } : defaultBroadcastsStrings;
}
