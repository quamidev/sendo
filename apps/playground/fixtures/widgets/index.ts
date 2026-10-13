import type { LinkDraft } from "@/components/sendo/widgets/link-builder";
import {
  LINK_TEXT_MAX,
  type WidgetNumberView,
  type WidgetSourceView,
} from "@/components/sendo/widgets/types";

/**
 * `break-ui` datasets for the links screen (`/dev/links?data=<key>`, dev only). Each one enters
 * through the same props the real page passes (numbers, sources, initial draft).
 */
export interface WidgetsFixture {
  label: string;
  numbers: WidgetNumberView[];
  sources: WidgetSourceView[];
  draft: Omit<LinkDraft, "account">;
}

const recepcion: WidgetNumberView = {
  id: "num-recepcion",
  label: "Recepción",
  displayPhone: "+502 2222 3333",
  isDefault: true,
};

const demoNumbers: WidgetNumberView[] = [
  recepcion,
  { id: "num-cobranza", label: "Cobranza", displayPhone: "+502 2222 4444", isDefault: false },
];

const longLabels = [
  "Residencial Torre Vista Norte · Cobranza y mantenimiento",
  "Clínica Dra. Aleksandra Wiśniewska-Kowalczyk (urgencias 24 h)",
  "Recepción",
  "Garita",
  "Administración del condominio Jardines de San Cristóbal III",
  "",
];

const worstNumbers: WidgetNumberView[] = longLabels.map((label, index) => ({
  id: `num-${String(index + 1)}`,
  label: label === "" ? null : label,
  displayPhone: `+502 5${String(index)}55 12${String(index)}4`,
  isDefault: index === 4,
}));

const longText = (() => {
  const base =
    "Hola 👋, vi el anuncio del apartamento de 2 habitaciones en la Torre B (nivel 14, con vista al volcán de Agua) y quisiera agendar una visita este sábado por la mañana. ¿También aceptan mascotas pequeñas? Mi correo es bartholomew.fitzgerald@northwind-industries-holdings.example.com, gracias. ";
  return base.repeat(3).slice(0, LINK_TEXT_MAX);
})();

const worstSources: WidgetSourceView[] = [
  { source: "navidad-2026-garita-norte-torreb", conversations: 12_345 },
  { source: "garita", conversations: 4_210 },
  { source: "ad:120210000000000001", conversations: 1_002 },
  ...Array.from({ length: 20 }, (_, index) => ({
    source: `volante-zona-${String(index + 1)}`,
    conversations: 400 - index * 19,
  })),
  { source: "x", conversations: 1 },
  { source: null, conversations: 987 },
];

export const WIDGETS_FIXTURES = {
  demo: {
    label: "Demo",
    numbers: demoNumbers,
    sources: [
      { source: "garita", conversations: 42 },
      { source: null, conversations: 25 },
      { source: "factura", conversations: 17 },
      { source: "web", conversations: 9 },
      { source: "ad:120210000000000001", conversations: 3 },
    ],
    draft: { text: "Hola, quiero información", source: "garita" },
  },
  worst: {
    label: "Worst case",
    numbers: worstNumbers,
    sources: worstSources,
    draft: { text: longText, source: "navidad-2026-garita-norte-torreb" },
  },
  empty: {
    label: "Empty",
    numbers: [recepcion],
    sources: [],
    draft: { text: "", source: "" },
  },
  one: {
    label: "One",
    numbers: [recepcion],
    sources: [{ source: "garita", conversations: 1 }],
    draft: { text: "Hola", source: "garita" },
  },
} satisfies Record<string, WidgetsFixture>;

export type WidgetsFixtureKey = keyof typeof WIDGETS_FIXTURES;

export function widgetsFixture(key: string | undefined): {
  key: WidgetsFixtureKey;
  fixture: WidgetsFixture;
} {
  const found = key !== undefined && key in WIDGETS_FIXTURES ? (key as WidgetsFixtureKey) : "demo";
  return { key: found, fixture: WIDGETS_FIXTURES[found] };
}
