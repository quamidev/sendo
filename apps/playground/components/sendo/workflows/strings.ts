import type { RuleType, Weekday } from "@quami/sendo/rules";
import type { SendoLocale } from "@/lib/sendo-ui";
import type { WorkflowsErrorCode } from "./types";

/**
 * Every text of the `workflows` item, one object per `SendoLocale`. Override single keys through
 * `<RulesScreen strings>`. Functions that show a count get `format` (the screen's `formatLocale`),
 * so numbers, plurals and lists follow the locale.
 */
export interface WorkflowsStrings {
  /** The page `<title>` (`generateMetadata` in page.tsx) and the screen heading. */
  pageTitle: string;
  backToInbox: string;
  pageDescription: string;
  forbiddenTitle: string;
  forbiddenBody: string;

  newRule: string;
  emptyTitle: string;
  emptyBody: string;
  emptyCodeHint: string;
  createFirst: string;
  orderHint: string;
  listLabel: string;

  typeLabels: Record<RuleType, string>;
  typeDescriptions: Record<RuleType, string>;

  allNumbers: string;
  unknownNumber: (ref: string) => string;
  disconnectedNumber: (name: string) => string;
  originCode: string;
  originCodeHint: string;
  inactive: string;
  activeLabel: (key: string) => string;
  moveUp: (key: string) => string;
  moveDown: (key: string) => string;
  edit: string;
  editLabel: (key: string) => string;
  remove: string;
  removeLabel: (key: string) => string;
  invalidTitle: string;
  invalidBody: string;
  updatedBy: (name: string, date: string) => string;
  updatedByYou: (date: string) => string;
  updatedOn: (date: string) => string;
  syncedOn: (date: string) => string;

  summaryClosedAllWeek: string;
  summaryHolidays: (count: number, format: WorkflowsFormat) => string;
  summaryAppliesTo: Record<"human" | "all", string>;
  summaryAnyConversation: string;
  summaryKeywords: (shown: string[], more: number, format: WorkflowsFormat) => string;
  summarySource: (source: string) => string;
  summaryChannel: string;
  summaryNumber: (name: string) => string;
  summaryToQueue: (queue: string) => string;
  summaryTags: (shown: string[], more: number, format: WorkflowsFormat) => string;
  invalidMore: (count: number, format: WorkflowsFormat) => string;
  summaryTo: Record<"agent" | "human", string>;
  summaryAnyQueue: string;
  summaryNoQueue: string;
  summaryQueue: (queue: string) => string;
  strategyLabels: Record<"least_open" | "round_robin", string>;
  escalateActionLabels: Record<"reassign" | "notify" | "return_to_agent", string>;
  summaryEscalate: (minutes: string, action: string) => string;
  summaryAutoClose: (days: string) => string;
  minutes: (count: number, format: WorkflowsFormat) => string;
  days: (count: number, format: WorkflowsFormat) => string;

  editorCreateTitle: string;
  editorEditTitle: string;
  editorTypeLegend: string;
  keyLabel: string;
  keyHint: string;
  keyLockedHint: string;
  keyDuplicate: string;
  numberLabel: string;
  numberHint: string;
  codeOriginNote: string;
  invalidStoredNote: string;
  cancel: string;
  /** Screen-reader label of the editor's and dialogs' close (X) button. */
  close: string;
  save: string;
  saving: string;
  fixErrors: string;

  timezoneLabel: string;
  timezoneHint: string;
  scheduleLegend: string;
  scheduleHint: string;
  weekdayLabels: Record<Weekday, string>;
  weekdayShort: Record<Weekday, string>;
  closedDay: string;
  openDay: (day: string) => string;
  rangeStart: (day: string, index: number) => string;
  rangeEnd: (day: string, index: number) => string;
  addRange: string;
  addRangeLabel: (day: string) => string;
  removeRangeLabel: (day: string, index: number) => string;
  copyMondayToWeekdays: string;
  holidaysLegend: string;
  holidaysHint: string;
  addHoliday: string;
  holidayInputLabel: string;
  removeHolidayLabel: (date: string) => string;
  noHolidays: string;
  outsideMessageLabel: string;
  outsideMessageHint: string;
  appliesToLegend: string;
  appliesToOptions: Record<"human" | "all", { label: string; hint: string }>;

  matchLegend: string;
  matchHint: string;
  keywordsLabel: string;
  keywordsHint: string;
  keywordsPlaceholder: string;
  sourceLabel: string;
  sourcePlaceholder: string;
  sourceHint: string;
  channelLabel: string;
  channelAny: string;
  channelWhatsApp: string;
  matchNumberLabel: string;
  matchNumberAny: string;
  actionLegend: string;
  toLegend: string;
  toOptions: Record<"agent" | "human", { label: string; hint: string }>;
  routeQueueLabel: string;
  routeQueueHint: string;
  tagsLabel: string;
  tagsHint: string;
  tagsPlaceholder: string;
  reasonLabel: string;
  reasonHint: string;
  removeChipLabel: (value: string) => string;

  queueLabel: string;
  queueModes: Record<"any" | "none" | "named", string>;
  queueNamePlaceholder: string;
  strategyLegend: string;
  strategyHints: Record<"least_open" | "round_robin", string>;
  afterMinutesLabel: string;
  afterMinutesHint: string;
  escalateActionLegend: string;
  escalateActionHints: Record<"reassign" | "notify" | "return_to_agent", string>;
  afterDaysLabel: string;
  afterDaysHint: string;

  errorRequired: string;
  errorNumber: string;
  errorInteger: string;
  errorMin: (min: number, format: WorkflowsFormat) => string;
  errorMax: (max: number, format: WorkflowsFormat) => string;
  errorMaxItems: (max: number, format: WorkflowsFormat) => string;
  errorMaxLength: (max: number, format: WorkflowsFormat) => string;
  errorChoose: string;
  errorInvalid: string;
  /** The package schemas' own checks (`validation.ts` maps them by issue code and path). */
  errorTime: string;
  errorDate: string;
  errorTimezone: string;
  errorRangeOrder: string;
  errorSource: string;

  deleteTitle: (key: string) => string;
  deleteBody: string;
  deleteCodeBody: string;
  deleteConfirm: string;

  saved: (key: string) => string;
  deleted: (key: string) => string;
  moved: (key: string, position: number, total: number, format: WorkflowsFormat) => string;
  errorTitle: string;
  retry: string;
  dismiss: string;
  /** A failed action by code (the server's `message` is an English detail for logs). */
  errorMessages: Record<WorkflowsErrorCode, string>;
}

/** "3 feriados", "1 day": the count in `format`'s locale and the matching plural form. */
const counted = (count: number, format: WorkflowsFormat, one: string, other: string) =>
  `${format.number(count)} ${format.plural(count, { one, other })}`;

const es: WorkflowsStrings = {
  pageTitle: "Reglas",
  backToInbox: "Volver a la bandeja",
  pageDescription:
    "Horario de atención, enrutamiento, asignación, escalamiento y cierre automático. Los cambios se aplican en menos de un minuto, sin desplegar.",
  forbiddenTitle: "No tienes acceso a Reglas",
  forbiddenBody: "Solo los administradores ven y cambian las reglas.",

  newRule: "Nueva regla",
  emptyTitle: "Aún no hay reglas",
  emptyBody:
    "Sin reglas, cada conversación nueva la atiende el agente de IA y nada se asigna ni se cierra solo.",
  emptyCodeHint:
    "¿Tienes reglas en el código? Ejecuta npx @quami/sendo rules sync y aparecerán aquí.",
  createFirst: "Crear la primera regla",
  orderHint: "Se evalúan de arriba abajo: en enrutamiento gana la primera que coincide.",
  listLabel: "Reglas en orden de evaluación",

  typeLabels: {
    business_hours: "Horario de atención",
    route: "Enrutamiento",
    auto_assign: "Asignación automática",
    escalate: "Escalamiento",
    auto_close: "Cierre automático",
  },
  typeDescriptions: {
    business_hours: "Cuándo atiende el equipo y qué responder fuera de horario.",
    route: "Manda la conversación nueva a una cola, con etiquetas, a la IA o a una persona.",
    auto_assign: "Reparte las conversaciones que pasan a una persona.",
    escalate: "Qué hacer si nadie responde a tiempo.",
    auto_close: "Cierra las conversaciones sin actividad.",
  },

  allNumbers: "Todos los números",
  unknownNumber: (ref) => `Número ${ref}`,
  disconnectedNumber: (name) => `${name} (desconectado)`,
  originCode: "Desde código",
  originCodeHint:
    "Creada con sendo rules sync. Tus cambios aquí se conservan, salvo que alguien sincronice con --force.",
  inactive: "Apagada",
  activeLabel: (key) => `Regla «${key}» activa`,
  moveUp: (key) => `Subir «${key}»`,
  moveDown: (key) => `Bajar «${key}»`,
  edit: "Editar",
  editLabel: (key) => `Editar «${key}»`,
  remove: "Eliminar",
  removeLabel: (key) => `Eliminar «${key}»`,
  invalidTitle: "Regla inválida",
  invalidBody: "El motor la ignora hasta que la corrijas.",
  updatedBy: (name, date) => `Editada por ${name} · ${date}`,
  updatedByYou: (date) => `Editada por ti · ${date}`,
  updatedOn: (date) => `Editada · ${date}`,
  syncedOn: (date) => `Sincronizada · ${date}`,

  summaryClosedAllWeek: "Cerrado toda la semana",
  summaryHolidays: (count, format) => counted(count, format, "feriado", "feriados"),
  summaryAppliesTo: { human: "La IA sigue respondiendo", all: "También pausa la IA" },
  summaryAnyConversation: "Toda conversación nueva",
  summaryKeywords: (shown, more, format) =>
    `Si el primer mensaje dice ${shown.map((word) => `«${word}»`).join(", ")}${
      more > 0 ? ` y ${format.number(more)} más` : ""
    }`,
  summarySource: (source) => `origen ${source}`,
  summaryChannel: "WhatsApp",
  summaryNumber: (name) => `número ${name}`,
  summaryToQueue: (queue) => `cola ${queue}`,
  summaryTags: (shown, more, format) =>
    `etiquetas ${more > 0 ? `${shown.join(", ")} y ${format.number(more)} más` : format.list(shown)}`,
  invalidMore: (count, format) => `y ${counted(count, format, "problema más", "problemas más")}`,
  summaryTo: { agent: "a la IA", human: "a una persona" },
  summaryAnyQueue: "Cualquier cola",
  summaryNoQueue: "Sin cola",
  summaryQueue: (queue) => `Cola ${queue}`,
  strategyLabels: {
    least_open: "A quien tenga menos conversaciones abiertas",
    round_robin: "Por turnos",
  },
  escalateActionLabels: {
    reassign: "reasignar",
    notify: "avisar",
    return_to_agent: "devolver a la IA",
  },
  summaryEscalate: (minutes, action) => `Tras ${minutes} sin respuesta → ${action}`,
  summaryAutoClose: (days) => `Tras ${days} sin actividad`,
  minutes: (count, format) => counted(count, format, "minuto", "minutos"),
  days: (count, format) => counted(count, format, "día", "días"),

  editorCreateTitle: "Nueva regla",
  editorEditTitle: "Editar regla",
  editorTypeLegend: "Tipo",
  keyLabel: "Nombre",
  keyHint: "Aparece en la conversación: «Asignada por la regla Turno cobranza».",
  keyLockedHint: "El nombre no cambia: para renombrarla, crea otra y elimina esta.",
  keyDuplicate: "Ya existe una regla con ese nombre.",
  numberLabel: "Número",
  numberHint: "Limita la regla a un número, o aplícala a todos.",
  codeOriginNote:
    "Esta regla viene del código (sendo rules sync). Lo que cambies aquí se conserva, salvo que alguien sincronice con --force.",
  invalidStoredNote:
    "La regla guardada no es válida y el motor la ignora. Corrige los campos marcados y guarda.",
  cancel: "Cancelar",
  close: "Cerrar",
  save: "Guardar",
  saving: "Guardando…",
  fixErrors: "Revisa los campos marcados.",

  timezoneLabel: "Zona horaria",
  timezoneHint: "Zona IANA, por ejemplo America/Guatemala.",
  scheduleLegend: "Horario semanal",
  scheduleHint: "Horas locales; el fin no se incluye. Usa 24:00 para medianoche.",
  weekdayLabels: {
    mon: "Lunes",
    tue: "Martes",
    wed: "Miércoles",
    thu: "Jueves",
    fri: "Viernes",
    sat: "Sábado",
    sun: "Domingo",
  },
  weekdayShort: { mon: "L", tue: "M", wed: "X", thu: "J", fri: "V", sat: "S", sun: "D" },
  closedDay: "Cerrado",
  openDay: (day) => `${day} abierto`,
  rangeStart: (day, index) => `${day}, inicio del tramo ${String(index + 1)}`,
  rangeEnd: (day, index) => `${day}, fin del tramo ${String(index + 1)}`,
  addRange: "Agregar tramo",
  addRangeLabel: (day) => `Agregar tramo el ${day.toLowerCase()}`,
  removeRangeLabel: (day, index) => `Quitar el tramo ${String(index + 1)} del ${day.toLowerCase()}`,
  copyMondayToWeekdays: "Copiar el lunes a martes–viernes",
  holidaysLegend: "Feriados",
  holidaysHint: "Días cerrados completos.",
  addHoliday: "Agregar",
  holidayInputLabel: "Fecha del feriado",
  removeHolidayLabel: (date) => `Quitar el feriado ${date}`,
  noHolidays: "Sin feriados.",
  outsideMessageLabel: "Mensaje fuera de horario",
  outsideMessageHint: "Se envía una vez por cierre, solo si la ventana de 24 h está abierta.",
  appliesToLegend: "Fuera de horario",
  appliesToOptions: {
    human: {
      label: "Solo el equipo descansa",
      hint: "La IA sigue respondiendo; el mensaje sale en conversaciones con una persona.",
    },
    all: {
      label: "También la IA",
      hint: "La IA no responde fuera de horario; el mensaje sale en toda conversación.",
    },
  },

  matchLegend: "Cuando",
  matchHint: "Se evalúa en la conversación nueva. Sin condiciones, coincide con todas.",
  keywordsLabel: "Palabras clave",
  keywordsHint:
    "En el primer mensaje, como palabra completa; sin distinguir mayúsculas ni acentos. Enter o coma para agregar.",
  keywordsPlaceholder: "factura, pago…",
  sourceLabel: "Origen",
  sourcePlaceholder: "garita",
  sourceHint: "Código del enlace (garita) o ad:<id> de un anuncio.",
  channelLabel: "Canal",
  channelAny: "Cualquiera",
  channelWhatsApp: "WhatsApp",
  matchNumberLabel: "Llega al número",
  matchNumberAny: "Cualquiera",
  actionLegend: "Entonces",
  toLegend: "Atiende",
  toOptions: {
    agent: { label: "La IA", hint: "El agente sigue a cargo." },
    human: { label: "Una persona", hint: "Pasa al equipo con el motivo." },
  },
  routeQueueLabel: "Cola",
  routeQueueHint: "Opcional. Por ejemplo cobranza.",
  tagsLabel: "Etiquetas",
  tagsHint: "Se crean si no existen. Enter o coma para agregar.",
  tagsPlaceholder: "urgente…",
  reasonLabel: "Motivo del traspaso",
  reasonHint: "Lo ve quien recibe la conversación.",
  removeChipLabel: (value) => `Quitar ${value}`,

  queueLabel: "Cola",
  queueModes: { any: "Cualquier cola", none: "Sin cola", named: "Una cola" },
  queueNamePlaceholder: "cobranza",
  strategyLegend: "Asignar",
  strategyHints: {
    least_open: "Entre quienes devuelve resolveAssignees, a quien tenga menos abiertas.",
    round_robin: "Uno tras otro, en orden.",
  },
  afterMinutesLabel: "Minutos esperando respuesta",
  afterMinutesHint: "Solo cuentan los minutos dentro del horario.",
  escalateActionLegend: "Entonces",
  escalateActionHints: {
    reassign: "A la siguiente persona de la cola.",
    notify: "Emite el evento escalation para que tu app avise.",
    return_to_agent: "La IA retoma la conversación.",
  },
  afterDaysLabel: "Días sin actividad",
  afterDaysHint: "Entre 1 y 365.",

  errorRequired: "Obligatorio.",
  errorNumber: "Escribe un número.",
  errorInteger: "Usa un número entero.",
  errorMin: (min, format) => `Mínimo ${format.number(min)}.`,
  errorMax: (max, format) => `Máximo ${format.number(max)}.`,
  errorMaxItems: (max, format) => `Máximo ${counted(max, format, "elemento", "elementos")}.`,
  errorMaxLength: (max, format) => `Máximo ${counted(max, format, "carácter", "caracteres")}.`,
  errorChoose: "Elige una opción.",
  errorInvalid: "Valor inválido.",
  errorTime: "Usa HH:MM (00:00–24:00).",
  errorDate: "Usa AAAA-MM-DD.",
  errorTimezone: "Zona horaria IANA desconocida (por ejemplo America/Guatemala).",
  errorRangeOrder: "El inicio debe ser antes del fin.",
  errorSource: "Usa de 1 a 32 caracteres a-z, 0-9 y -, o ad:<id>.",

  deleteTitle: (key) => `¿Eliminar «${key}»?`,
  deleteBody: "Deja de aplicarse en seguida. Las conversaciones ya afectadas no cambian.",
  deleteCodeBody:
    "Deja de aplicarse en seguida. Como viene del código, la próxima sincronización (sendo rules sync) la vuelve a crear: quítala también del código.",
  deleteConfirm: "Eliminar",

  saved: (key) => `Regla «${key}» guardada.`,
  deleted: (key) => `Regla «${key}» eliminada.`,
  moved: (key, position, total, format) =>
    `«${key}» ahora es la ${format.number(position)} de ${format.number(total)}.`,
  errorTitle: "No se pudo guardar",
  retry: "Recargar reglas",
  dismiss: "Cerrar",
  errorMessages: {
    FORBIDDEN: "No tienes permiso para cambiar reglas.",
    INVALID: "La regla no es válida. Revisa sus campos.",
    NOT_FOUND: "La regla ya no existe. Recarga las reglas.",
    DUPLICATE: "Ya existe una regla con ese nombre.",
    UNKNOWN: "Algo salió mal. Inténtalo de nuevo.",
  },
};

const en: WorkflowsStrings = {
  pageTitle: "Rules",
  backToInbox: "Back to inbox",
  pageDescription:
    "Business hours, routing, assignment, escalation and auto-close. Changes apply in under a minute, without a deploy.",
  forbiddenTitle: "You don't have access to Rules",
  forbiddenBody: "Only admins see and change the rules.",

  newRule: "New rule",
  emptyTitle: "No rules yet",
  emptyBody:
    "Without rules, the AI agent handles every new conversation and nothing is assigned or closed automatically.",
  emptyCodeHint:
    "Have rules in your code? Run npx @quami/sendo rules sync and they'll show up here.",
  createFirst: "Create the first rule",
  orderHint: "Evaluated from top to bottom: for routing, the first match wins.",
  listLabel: "Rules in evaluation order",

  typeLabels: {
    business_hours: "Business hours",
    route: "Routing",
    auto_assign: "Auto-assign",
    escalate: "Escalation",
    auto_close: "Auto-close",
  },
  typeDescriptions: {
    business_hours: "When the team is available and what to reply outside business hours.",
    route: "Sends the new conversation to a queue, with tags, to the AI or to a person.",
    auto_assign: "Shares out the conversations handed to a person.",
    escalate: "What to do if nobody replies in time.",
    auto_close: "Closes conversations without activity.",
  },

  allNumbers: "All numbers",
  unknownNumber: (ref) => `Number ${ref}`,
  disconnectedNumber: (name) => `${name} (disconnected)`,
  originCode: "From code",
  originCodeHint:
    "Created with sendo rules sync. Your changes here are kept unless someone syncs with --force.",
  inactive: "Off",
  activeLabel: (key) => `Rule “${key}” on`,
  moveUp: (key) => `Move “${key}” up`,
  moveDown: (key) => `Move “${key}” down`,
  edit: "Edit",
  editLabel: (key) => `Edit “${key}”`,
  remove: "Delete",
  removeLabel: (key) => `Delete “${key}”`,
  invalidTitle: "Invalid rule",
  invalidBody: "The engine ignores it until you fix it.",
  updatedBy: (name, date) => `Edited by ${name} · ${date}`,
  updatedByYou: (date) => `Edited by you · ${date}`,
  updatedOn: (date) => `Edited · ${date}`,
  syncedOn: (date) => `Synced · ${date}`,

  summaryClosedAllWeek: "Closed all week",
  summaryHolidays: (count, format) => counted(count, format, "holiday", "holidays"),
  summaryAppliesTo: { human: "The AI keeps replying", all: "Also pauses the AI" },
  summaryAnyConversation: "Every new conversation",
  summaryKeywords: (shown, more, format) =>
    `If the first message says ${shown.map((word) => `“${word}”`).join(", ")}${
      more > 0 ? ` and ${format.number(more)} more` : ""
    }`,
  summarySource: (source) => `source ${source}`,
  summaryChannel: "WhatsApp",
  summaryNumber: (name) => `number ${name}`,
  summaryToQueue: (queue) => `queue ${queue}`,
  summaryTags: (shown, more, format) =>
    `tags ${more > 0 ? `${shown.join(", ")} and ${format.number(more)} more` : format.list(shown)}`,
  invalidMore: (count, format) => `and ${counted(count, format, "more problem", "more problems")}`,
  summaryTo: { agent: "to the AI", human: "to a person" },
  summaryAnyQueue: "Any queue",
  summaryNoQueue: "No queue",
  summaryQueue: (queue) => `Queue ${queue}`,
  strategyLabels: {
    least_open: "To whoever has the fewest open conversations",
    round_robin: "Taking turns",
  },
  escalateActionLabels: {
    reassign: "reassign",
    notify: "notify",
    return_to_agent: "hand back to the AI",
  },
  summaryEscalate: (minutes, action) => `After ${minutes} without a reply → ${action}`,
  summaryAutoClose: (days) => `After ${days} without activity`,
  minutes: (count, format) => counted(count, format, "minute", "minutes"),
  days: (count, format) => counted(count, format, "day", "days"),

  editorCreateTitle: "New rule",
  editorEditTitle: "Edit rule",
  editorTypeLegend: "Type",
  keyLabel: "Name",
  keyHint: "Shown in the conversation: “Assigned by the rule Billing shift”.",
  keyLockedHint:
    "The name can't change: to rename the rule, create another one and delete this one.",
  keyDuplicate: "A rule with that name already exists.",
  numberLabel: "Number",
  numberHint: "Limit the rule to one number, or apply it to all of them.",
  codeOriginNote:
    "This rule comes from code (sendo rules sync). What you change here is kept unless someone syncs with --force.",
  invalidStoredNote:
    "The saved rule isn't valid and the engine ignores it. Fix the marked fields and save.",
  cancel: "Cancel",
  close: "Close",
  save: "Save",
  saving: "Saving…",
  fixErrors: "Check the marked fields.",

  timezoneLabel: "Time zone",
  timezoneHint: "IANA zone, for example America/Guatemala.",
  scheduleLegend: "Weekly schedule",
  scheduleHint: "Local times; the end isn't included. Use 24:00 for midnight.",
  weekdayLabels: {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  },
  weekdayShort: {
    mon: "Mon",
    tue: "Tue",
    wed: "Wed",
    thu: "Thu",
    fri: "Fri",
    sat: "Sat",
    sun: "Sun",
  },
  closedDay: "Closed",
  openDay: (day) => `${day} open`,
  rangeStart: (day, index) => `${day}, start of range ${String(index + 1)}`,
  rangeEnd: (day, index) => `${day}, end of range ${String(index + 1)}`,
  addRange: "Add range",
  addRangeLabel: (day) => `Add a range on ${day}`,
  removeRangeLabel: (day, index) => `Remove range ${String(index + 1)} on ${day}`,
  copyMondayToWeekdays: "Copy Monday to Tuesday–Friday",
  holidaysLegend: "Holidays",
  holidaysHint: "Whole days closed.",
  addHoliday: "Add",
  holidayInputLabel: "Holiday date",
  removeHolidayLabel: (date) => `Remove the holiday ${date}`,
  noHolidays: "No holidays.",
  outsideMessageLabel: "After-hours message",
  outsideMessageHint: "Sent once per closed period, only if the 24 h window is open.",
  appliesToLegend: "Outside business hours",
  appliesToOptions: {
    human: {
      label: "Only the team rests",
      hint: "The AI keeps replying; the message goes out in conversations with a person.",
    },
    all: {
      label: "The AI too",
      hint: "The AI doesn't reply outside business hours; the message goes out in every conversation.",
    },
  },

  matchLegend: "When",
  matchHint: "Checked on the new conversation. Without conditions, it matches all of them.",
  keywordsLabel: "Keywords",
  keywordsHint:
    "In the first message, as a whole word; case and accents don't matter. Enter or comma to add.",
  keywordsPlaceholder: "invoice, payment…",
  sourceLabel: "Source",
  sourcePlaceholder: "front-desk",
  sourceHint: "A link code (front-desk) or ad:<id> from an ad.",
  channelLabel: "Channel",
  channelAny: "Any",
  channelWhatsApp: "WhatsApp",
  matchNumberLabel: "Arrives at number",
  matchNumberAny: "Any",
  actionLegend: "Then",
  toLegend: "Handled by",
  toOptions: {
    agent: { label: "The AI", hint: "The agent stays in charge." },
    human: { label: "A person", hint: "Goes to the team with the reason." },
  },
  routeQueueLabel: "Queue",
  routeQueueHint: "Optional. For example billing.",
  tagsLabel: "Tags",
  tagsHint: "Created if they don't exist. Enter or comma to add.",
  tagsPlaceholder: "urgent…",
  reasonLabel: "Handoff reason",
  reasonHint: "Seen by whoever receives the conversation.",
  removeChipLabel: (value) => `Remove ${value}`,

  queueLabel: "Queue",
  queueModes: { any: "Any queue", none: "No queue", named: "One queue" },
  queueNamePlaceholder: "billing",
  strategyLegend: "Assign",
  strategyHints: {
    least_open: "Among the people resolveAssignees returns, to whoever has the fewest open.",
    round_robin: "One after another, in order.",
  },
  afterMinutesLabel: "Minutes waiting for a reply",
  afterMinutesHint: "Only minutes within business hours count.",
  escalateActionLegend: "Then",
  escalateActionHints: {
    reassign: "To the next person in the queue.",
    notify: "Emits the escalation event so your app can alert someone.",
    return_to_agent: "The AI takes the conversation back.",
  },
  afterDaysLabel: "Days without activity",
  afterDaysHint: "From 1 to 365.",

  errorRequired: "Required.",
  errorNumber: "Enter a number.",
  errorInteger: "Use a whole number.",
  errorMin: (min, format) => `At least ${format.number(min)}.`,
  errorMax: (max, format) => `At most ${format.number(max)}.`,
  errorMaxItems: (max, format) => `At most ${counted(max, format, "item", "items")}.`,
  errorMaxLength: (max, format) => `At most ${counted(max, format, "character", "characters")}.`,
  errorChoose: "Pick an option.",
  errorInvalid: "Invalid value.",
  errorTime: "Use HH:MM (00:00–24:00).",
  errorDate: "Use YYYY-MM-DD.",
  errorTimezone: "Unknown IANA time zone (for example America/Guatemala).",
  errorRangeOrder: "The start must be before the end.",
  errorSource: "Use 1 to 32 of a-z, 0-9 and -, or ad:<id>.",

  deleteTitle: (key) => `Delete “${key}”?`,
  deleteBody: "It stops applying right away. Conversations it already affected don't change.",
  deleteCodeBody:
    "It stops applying right away. Since it comes from code, the next sync (sendo rules sync) creates it again: remove it from the code too.",
  deleteConfirm: "Delete",

  saved: (key) => `Rule “${key}” saved.`,
  deleted: (key) => `Rule “${key}” deleted.`,
  moved: (key, position, total, format) =>
    `“${key}” is now ${format.number(position)} of ${format.number(total)}.`,
  errorTitle: "Couldn't save",
  retry: "Reload rules",
  dismiss: "Close",
  errorMessages: {
    FORBIDDEN: "You don't have permission to change rules.",
    INVALID: "The rule isn't valid. Check its fields.",
    NOT_FOUND: "The rule no longer exists. Reload the rules.",
    DUPLICATE: "A rule with that name already exists.",
    UNKNOWN: "Something went wrong. Try again.",
  },
};

/** The workflows strings of every `SendoLocale`. Add an object here when you add a language. */
export const workflowsStrings = { es, en } satisfies Record<SendoLocale, WorkflowsStrings>;

/** The strings of `locale`, with `overrides` on top (`<RulesScreen strings>`). */
export function resolveWorkflowsStrings(
  locale: SendoLocale,
  overrides?: Partial<WorkflowsStrings>,
): WorkflowsStrings {
  const strings: WorkflowsStrings = workflowsStrings[locale];
  return overrides === undefined ? strings : { ...strings, ...overrides };
}

/**
 * Numbers, plurals, lists and dates in the screen's `formatLocale` (a BCP-47 tag such as `en`,
 * `es` or `es-GT`). The `format` argument of the string functions; inside the screen,
 * `useWorkflowsFormat()`.
 */
export interface WorkflowsFormat {
  /** A count: `10,080` (en), `10.080` (es). */
  number: (value: number) => string;
  /** `forms.one` or `forms.other` for `count`, by the locale's plural rules. */
  plural: (count: number, forms: { one: string; other: string }) => string;
  /** "a, b and c" (es "a, b y c"). */
  list: (items: string[]) => string;
  /** A rule's last edit: "Oct 1, 2026" (en), "1 oct 2026" (es). */
  date: (iso: string) => string;
}

const formats = new Map<string, WorkflowsFormat>();

/** The `WorkflowsFormat` of `formatLocale`, built once per locale. */
export function workflowsFormat(formatLocale: string): WorkflowsFormat {
  const known = formats.get(formatLocale);
  if (known !== undefined) return known;
  const integer = new Intl.NumberFormat(formatLocale);
  const plurals = new Intl.PluralRules(formatLocale);
  const list = new Intl.ListFormat(formatLocale, { style: "long", type: "conjunction" });
  const date = new Intl.DateTimeFormat(formatLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const format: WorkflowsFormat = {
    number: (value) => integer.format(value),
    plural: (count, forms) => (plurals.select(count) === "one" ? forms.one : forms.other),
    list: (items) => list.format(items),
    date: (iso) => date.format(new Date(iso)),
  };
  formats.set(formatLocale, format);
  return format;
}
