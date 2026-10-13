import type { RuleType, Weekday } from "@quami/sendo/rules";

/** Every text of the `workflows` item. Override any of them through the `strings` prop. */
export interface WorkflowsStrings {
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
  summaryHolidays: (count: number) => string;
  summaryAppliesTo: Record<"human" | "all", string>;
  summaryAnyConversation: string;
  summaryKeywords: (shown: string[], more: number) => string;
  summarySource: (source: string) => string;
  summaryChannel: string;
  summaryNumber: (name: string) => string;
  summaryToQueue: (queue: string) => string;
  summaryTags: (shown: string[], more: number) => string;
  invalidMore: (count: number) => string;
  summaryTo: Record<"agent" | "human", string>;
  summaryAnyQueue: string;
  summaryNoQueue: string;
  summaryQueue: (queue: string) => string;
  strategyLabels: Record<"least_open" | "round_robin", string>;
  escalateActionLabels: Record<"reassign" | "notify" | "return_to_agent", string>;
  summaryEscalate: (minutes: string, action: string) => string;
  summaryAutoClose: (days: string) => string;
  minutes: (count: number) => string;
  days: (count: number) => string;

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
  errorMin: (min: number) => string;
  errorMax: (max: number) => string;
  errorMaxItems: (max: number) => string;
  errorMaxLength: (max: number) => string;
  errorChoose: string;
  errorInvalid: string;

  deleteTitle: (key: string) => string;
  deleteBody: string;
  deleteCodeBody: string;
  deleteConfirm: string;

  saved: (key: string) => string;
  deleted: (key: string) => string;
  moved: (key: string, position: number, total: number) => string;
  errorTitle: string;
  retry: string;
  dismiss: string;
  errorMessages: Record<"FORBIDDEN" | "NOT_FOUND" | "DUPLICATE" | "UNKNOWN", string>;
}

const plural = (count: number, one: string, many: string) =>
  `${new Intl.NumberFormat("es").format(count)} ${count === 1 ? one : many}`;

const listFormat = new Intl.ListFormat("es", { style: "long", type: "conjunction" });

export const defaultWorkflowsStrings: WorkflowsStrings = {
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
  summaryHolidays: (count) => plural(count, "feriado", "feriados"),
  summaryAppliesTo: { human: "La IA sigue respondiendo", all: "También pausa la IA" },
  summaryAnyConversation: "Toda conversación nueva",
  summaryKeywords: (shown, more) =>
    `Si el primer mensaje dice ${shown.map((word) => `«${word}»`).join(", ")}${
      more > 0 ? ` y ${String(more)} más` : ""
    }`,
  summarySource: (source) => `origen ${source}`,
  summaryChannel: "WhatsApp",
  summaryNumber: (name) => `número ${name}`,
  summaryToQueue: (queue) => `cola ${queue}`,
  summaryTags: (shown, more) =>
    `etiquetas ${more > 0 ? `${shown.join(", ")} y ${String(more)} más` : listFormat.format(shown)}`,
  invalidMore: (count) => `y ${String(count)} ${count === 1 ? "problema más" : "problemas más"}`,
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
  minutes: (count) => plural(count, "minuto", "minutos"),
  days: (count) => plural(count, "día", "días"),

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
  errorMin: (min) => `Mínimo ${String(min)}.`,
  errorMax: (max) => `Máximo ${new Intl.NumberFormat("es").format(max)}.`,
  errorMaxItems: (max) => `Máximo ${String(max)} elementos.`,
  errorMaxLength: (max) => `Máximo ${String(max)} caracteres.`,
  errorChoose: "Elige una opción.",
  errorInvalid: "Valor inválido.",

  deleteTitle: (key) => `¿Eliminar «${key}»?`,
  deleteBody: "Deja de aplicarse en seguida. Las conversaciones ya afectadas no cambian.",
  deleteCodeBody:
    "Deja de aplicarse en seguida. Como viene del código, la próxima sincronización (sendo rules sync) la vuelve a crear: quítala también del código.",
  deleteConfirm: "Eliminar",

  saved: (key) => `Regla «${key}» guardada.`,
  deleted: (key) => `Regla «${key}» eliminada.`,
  moved: (key, position, total) => `«${key}» ahora es la ${String(position)} de ${String(total)}.`,
  errorTitle: "No se pudo guardar",
  retry: "Recargar reglas",
  dismiss: "Cerrar",
  errorMessages: {
    FORBIDDEN: "No tienes permiso para cambiar reglas.",
    NOT_FOUND: "La regla ya no existe. Recarga las reglas.",
    DUPLICATE: "Ya existe una regla con ese nombre.",
    UNKNOWN: "Algo salió mal. Inténtalo de nuevo.",
  },
};

export function resolveWorkflowsStrings(overrides?: Partial<WorkflowsStrings>): WorkflowsStrings {
  return overrides ? { ...defaultWorkflowsStrings, ...overrides } : defaultWorkflowsStrings;
}
