export interface WidgetsStrings {
  pageTitle: string;
  backToInbox: string;
  pageDescription: string;
  forbiddenTitle: string;
  forbiddenBody: string;
  noNumbersTitle: string;
  noNumbersBody: string;

  builderTitle: string;
  numberLabel: string;
  numberPlaceholder: string;
  textLabel: string;
  textPlaceholder: string;
  textHint: string;
  sourceLabel: string;
  sourcePlaceholder: string;
  sourceHint: string;
  sourceInvalid: string;
  defaultText: string;

  previewTitle: string;
  previewEmpty: string;
  previewError: string;
  messagePreviewLabel: string;
  linkLabel: string;
  copy: string;
  copied: string;
  copyFailed: string;

  qrLabel: (source: string) => string;
  qrTooLong: string;
  qrDense: string;
  downloadPng: string;
  downloadSvg: string;

  bubbleTitle: string;
  bubbleHint: string;
  copyCode: string;

  sourcesTitle: string;
  sourcesDescription: string;
  sourcesAllNumbers: string;
  sourcesEmpty: string;
  sourcesError: string;
  sourceColumn: string;
  conversationsColumn: string;
  shareColumn: string;
  directSource: string;
  useSource: string;
  useSourceLabel: (source: string) => string;

  bubbleLabel: string;
}

export const defaultWidgetsStrings: WidgetsStrings = {
  pageTitle: "Enlaces y QR",
  backToInbox: "Volver a la bandeja",
  pageDescription:
    "Crea un enlace de WhatsApp con un mensaje listo y un código de origen. Cada conversación que empiece con ese mensaje queda atribuida al origen.",
  forbiddenTitle: "No tienes acceso a Enlaces",
  forbiddenBody: "Solo los administradores crean enlaces y ven los orígenes.",
  noNumbersTitle: "Aún no hay números conectados",
  noNumbersBody: "Conecta un número de WhatsApp para crear enlaces.",

  builderTitle: "Enlace",
  numberLabel: "Número",
  numberPlaceholder: "Elige un número",
  textLabel: "Mensaje prellenado",
  textPlaceholder: "Hola, quiero información",
  textHint: "El contacto puede editarlo antes de enviarlo.",
  sourceLabel: "Origen",
  sourcePlaceholder: "garita",
  sourceHint: "Minúsculas, números y guiones. Se agrega al final del mensaje como [#origen].",
  sourceInvalid: "Usa de 1 a 32 letras minúsculas, números o guiones.",
  defaultText: "Hola",

  previewTitle: "Vista previa",
  previewEmpty: "Escribe un origen para generar el enlace.",
  previewError: "No se pudo generar el enlace.",
  messagePreviewLabel: "El contacto enviará",
  linkLabel: "Enlace",
  copy: "Copiar",
  copied: "Copiado",
  copyFailed: "No se pudo copiar",

  qrLabel: (source) => `Código QR del enlace de WhatsApp con origen ${source}`,
  qrTooLong: "El mensaje es demasiado largo para un código QR. Acórtalo.",
  qrDense: "Código denso: si lo vas a imprimir pequeño, acorta el mensaje.",
  downloadPng: "Descargar PNG",
  downloadSvg: "Descargar SVG",

  bubbleTitle: "Burbuja para tu sitio",
  bubbleHint: "Pega este componente en el layout de tu sitio (registry sendo-widgets).",
  copyCode: "Copiar código",

  sourcesTitle: "Orígenes",
  sourcesDescription: "Conversaciones según el enlace o anuncio por el que llegaron.",
  sourcesAllNumbers: "Todos los números",
  sourcesEmpty: "Todavía no llegan conversaciones con origen.",
  sourcesError: "No se pudieron cargar los orígenes.",
  sourceColumn: "Origen",
  conversationsColumn: "Conversaciones",
  shareColumn: "Porcentaje",
  directSource: "Directo",
  useSource: "Usar",
  useSourceLabel: (source) => `Usar el origen ${source} en el enlace`,

  bubbleLabel: "Escríbenos por WhatsApp",
};

export function resolveWidgetsStrings(overrides?: Partial<WidgetsStrings>): WidgetsStrings {
  return overrides ? { ...defaultWidgetsStrings, ...overrides } : defaultWidgetsStrings;
}
