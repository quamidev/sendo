import type { SendoLocale } from "@/lib/sendo-ui";
import type { WidgetsErrorCode } from "./types";

/**
 * Every text of the `widgets` item, one object per `SendoLocale`. Override single keys through the
 * `strings` prop of `<LinksScreen>`, `<LinkBuilder>`, `<SourcesTable>` and `<SendoQrCode>`.
 */
export interface WidgetsStrings {
  /** The page `<title>` (`generateMetadata` in page.tsx) and the screen heading. */
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
  /** The prefilled message of a new link (the page's initial draft). */
  defaultText: string;

  previewTitle: string;
  previewEmpty: string;
  previewError: string;
  /** A failed `createLink` / `listSources` by code (`UNKNOWN` shows `previewError` / `sourcesError`). */
  errorMessages: Record<Exclude<WidgetsErrorCode, "UNKNOWN">, string>;
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

  /** `<SendoChatBubble>`'s accessible name and tooltip (its `label` prop overrides it). */
  bubbleLabel: string;
}

const es: WidgetsStrings = {
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
  errorMessages: {
    FORBIDDEN: "Solo los administradores crean enlaces.",
    INVALID: "Revisa el número, el mensaje y el origen.",
    NOT_FOUND: "Ese número ya no existe. Recarga la página.",
  },
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
  bubbleHint: "Pega este componente en el layout de tu sitio (@sendo/widgets).",
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

const en: WidgetsStrings = {
  pageTitle: "Links and QR",
  backToInbox: "Back to inbox",
  pageDescription:
    "Create a WhatsApp link with a ready-made message and a source code. Every conversation that starts with that message is attributed to the source.",
  forbiddenTitle: "You don't have access to Links",
  forbiddenBody: "Only admins create links and see the sources.",
  noNumbersTitle: "No connected numbers yet",
  noNumbersBody: "Connect a WhatsApp number to create links.",

  builderTitle: "Link",
  numberLabel: "Number",
  numberPlaceholder: "Pick a number",
  textLabel: "Prefilled message",
  textPlaceholder: "Hi, I'd like some information",
  textHint: "The contact can edit it before sending it.",
  sourceLabel: "Source",
  sourcePlaceholder: "front-desk",
  sourceHint:
    "Lowercase letters, numbers and hyphens. Added at the end of the message as [#source].",
  sourceInvalid: "Use 1 to 32 lowercase letters, numbers or hyphens.",
  defaultText: "Hi",

  previewTitle: "Preview",
  previewEmpty: "Type a source to generate the link.",
  previewError: "Couldn't generate the link.",
  errorMessages: {
    FORBIDDEN: "Only admins create links.",
    INVALID: "Check the number, the message and the source.",
    NOT_FOUND: "That number no longer exists. Reload the page.",
  },
  messagePreviewLabel: "The contact will send",
  linkLabel: "Link",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Couldn't copy",

  qrLabel: (source) => `QR code of the WhatsApp link with source ${source}`,
  qrTooLong: "The message is too long for a QR code. Shorten it.",
  qrDense: "Dense code: if you'll print it small, shorten the message.",
  downloadPng: "Download PNG",
  downloadSvg: "Download SVG",

  bubbleTitle: "Bubble for your site",
  bubbleHint: "Paste this component into your site's layout (@sendo/widgets).",
  copyCode: "Copy code",

  sourcesTitle: "Sources",
  sourcesDescription: "Conversations by the link or ad they came from.",
  sourcesAllNumbers: "All numbers",
  sourcesEmpty: "No conversations with a source yet.",
  sourcesError: "Couldn't load the sources.",
  sourceColumn: "Source",
  conversationsColumn: "Conversations",
  shareColumn: "Share",
  directSource: "Direct",
  useSource: "Use",
  useSourceLabel: (source) => `Use the source ${source} in the link`,

  bubbleLabel: "Message us on WhatsApp",
};

/**
 * The language props of every widgets root (`LinksScreen`, `LinksNotice`, `LinkBuilder`,
 * `SourcesTable`, `SendoQrCode`): the app passes `locale` (`sendoLocale` from `lib/sendo-ui.ts`).
 */
export interface WidgetsLocaleProps {
  locale: SendoLocale;
  /** BCP-47 tag for numbers (`es-GT`); defaults to `locale`. */
  formatLocale?: string;
  /** Single strings on top of `locale`'s. */
  strings?: Partial<WidgetsStrings>;
}

/** The widgets strings of every `SendoLocale`. Add an object here when you add a language. */
export const widgetsStrings = { es, en } satisfies Record<SendoLocale, WidgetsStrings>;

/** The strings of `locale`, with `overrides` on top (the components' `strings` prop). */
export function resolveWidgetsStrings(
  locale: SendoLocale,
  overrides?: Partial<WidgetsStrings>,
): WidgetsStrings {
  const strings: WidgetsStrings = widgetsStrings[locale];
  return overrides === undefined ? strings : { ...strings, ...overrides };
}

/**
 * Numbers in the screen's `formatLocale` (a BCP-47 tag such as `en`, `es` or `es-GT`). Inside the
 * screen, `useWidgetsFormat()`.
 */
export interface WidgetsFormat {
  /** A count: `12,345` (en), `12.345` (es). */
  number: (value: number) => string;
  /** A share from 0 to 1: `33.3%` (en), `33,3 %` (es). */
  percent: (ratio: number) => string;
}

const formats = new Map<string, WidgetsFormat>();

/** The `WidgetsFormat` of `formatLocale`, built once per locale. */
export function widgetsFormat(formatLocale: string): WidgetsFormat {
  const known = formats.get(formatLocale);
  if (known !== undefined) return known;
  const integer = new Intl.NumberFormat(formatLocale);
  const percent = new Intl.NumberFormat(formatLocale, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const format: WidgetsFormat = {
    number: (value) => integer.format(value),
    percent: (ratio) => percent.format(ratio),
  };
  formats.set(formatLocale, format);
  return format;
}
