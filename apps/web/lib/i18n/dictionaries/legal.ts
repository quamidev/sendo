import type { Lang } from "../langs";
import { dataDeletion } from "./legal-data-deletion";
import { privacy } from "./legal-privacy";
import { terms } from "./legal-terms";

/**
 * A paragraph, or a bulleted list when it is an array. Strings may use the inline markup of
 * `rich()` and the placeholders of `LEGAL_PLACEHOLDERS` (`{shortName}`, `{brand}`, `{email}`, …),
 * filled from `lib/legal/entity.ts`. Running text uses `{shortName}`; the full `{legalName}` is
 * mentioned once, in `labels.tradeName`.
 */
export type LegalBlock = string | string[];

export interface LegalSection {
  /** The section's anchor, in the page's language. */
  id: string;
  heading: string;
  blocks: LegalBlock[];
}

/** One legal page. Every factual claim mirrors `content/docs/sendo-connect.mdx` and `lib/demo/`. */
export interface LegalPageDict {
  meta: { title: string; description: string };
  title: string;
  intro: string;
  sections: LegalSection[];
}

export interface LegalDict {
  labels: {
    lastUpdated: string;
    contents: string;
    anchorLabel: string;
    /** The first mention of the full legal name, near the top of every page. */
    tradeName: string;
    entity: {
      title: string;
      legalName: string;
      taxId: string;
      country: string;
      address: string;
      phone: string;
      email: string;
    };
  };
  privacy: LegalPageDict;
  terms: LegalPageDict;
  dataDeletion: LegalPageDict;
}

export const legal = {
  es: {
    labels: {
      lastUpdated: "Última actualización:",
      contents: "Contenido",
      anchorLabel: "Enlace a esta sección",
      tradeName: "{brand} es una marca de {legalName}.",
      entity: {
        title: "Responsable",
        legalName: "Razón social",
        taxId: "NIT",
        country: "País",
        address: "Dirección",
        phone: "Teléfono",
        email: "Correo",
      },
    },
    privacy: privacy.es,
    terms: terms.es,
    dataDeletion: dataDeletion.es,
  },
  en: {
    labels: {
      lastUpdated: "Last updated:",
      contents: "Contents",
      anchorLabel: "Link to this section",
      tradeName: "{brand} is a trade name of {legalName}.",
      entity: {
        title: "Provider",
        legalName: "Legal name",
        taxId: "NIT",
        country: "Country",
        address: "Address",
        phone: "Phone",
        email: "Email",
      },
    },
    privacy: privacy.en,
    terms: terms.en,
    dataDeletion: dataDeletion.en,
  },
} satisfies Record<Lang, LegalDict>;
