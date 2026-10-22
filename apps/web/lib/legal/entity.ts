/**
 * Who provides Sendo and Sendo Connect: the single source for the privacy policy, the terms and the
 * data deletion page. These values must match the business verification documents in Meta
 * Business Manager (the Meta Business portfolio) exactly: Meta checks the legal pages of the
 * "Quami Connect" app against them.
 */
export const LEGAL_ENTITY = {
  /** Full registered name; the pages mark it `lang="es"` (it is a Spanish proper name). */
  legalName: "Multi Inversiones de Desarrollo e Innovación, Sociedad Anónima",
  /** Used in running text after the first mention of `legalName`. */
  shortName: "MIDI, S.A.",
  brand: "Quami",
  products: ["Sendo", "Sendo Connect"],
  country: "Guatemala",
  /** Registered address. Empty: the pages leave the line out. Marked `lang="es"`. */
  address: "8 Avenida 10-69 Residenciales del Norte, Zona 17, Guatemala, Guatemala 01017" as string,
  phone: "+502 5944 7562",
  /** NIT (Guatemalan tax ID). */
  taxId: "120177366",
  contactEmail: "legal@quami.dev",
  /** ISO date (`YYYY-MM-DD`) of the last change to any of the three pages. */
  lastUpdated: "2026-10-21",
} as const;

/** `tel:` link for `LEGAL_ENTITY.phone`. */
export const LEGAL_PHONE_URI = `tel:${LEGAL_ENTITY.phone.replace(/\s/g, "")}`;

/**
 * Values for the placeholders legal copy may use: `{legalName}`, `{shortName}`, `{brand}`,
 * `{country}`, `{email}`, `{phone}`, `{phoneUri}`.
 */
export const LEGAL_PLACEHOLDERS: Record<string, string> = {
  legalName: LEGAL_ENTITY.legalName,
  shortName: LEGAL_ENTITY.shortName,
  brand: LEGAL_ENTITY.brand,
  country: LEGAL_ENTITY.country,
  email: LEGAL_ENTITY.contactEmail,
  phone: LEGAL_ENTITY.phone,
  phoneUri: LEGAL_PHONE_URI,
};
