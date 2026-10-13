import { InvalidPhoneError } from "../errors/errors";

interface CountryDialing {
  callingCode: string;
  /** National significant number lengths (without trunk prefix). */
  nationalLengths: readonly number[];
}

/** ISO 3166-1 alpha-2 → calling code, for the countries Quami apps serve most. */
export const COUNTRY_CALLING_CODES: Readonly<Record<string, CountryDialing>> = {
  GT: { callingCode: "502", nationalLengths: [8] },
  SV: { callingCode: "503", nationalLengths: [8] },
  HN: { callingCode: "504", nationalLengths: [8] },
  NI: { callingCode: "505", nationalLengths: [8] },
  CR: { callingCode: "506", nationalLengths: [8] },
  PA: { callingCode: "507", nationalLengths: [7, 8] },
  BZ: { callingCode: "501", nationalLengths: [7] },
  MX: { callingCode: "52", nationalLengths: [10] },
  US: { callingCode: "1", nationalLengths: [10] },
  CA: { callingCode: "1", nationalLengths: [10] },
  DO: { callingCode: "1", nationalLengths: [10] },
  PR: { callingCode: "1", nationalLengths: [10] },
  CO: { callingCode: "57", nationalLengths: [10] },
  VE: { callingCode: "58", nationalLengths: [10] },
  EC: { callingCode: "593", nationalLengths: [9] },
  PE: { callingCode: "51", nationalLengths: [9] },
  BO: { callingCode: "591", nationalLengths: [8] },
  CL: { callingCode: "56", nationalLengths: [9] },
  AR: { callingCode: "54", nationalLengths: [10, 11] },
  UY: { callingCode: "598", nationalLengths: [8] },
  PY: { callingCode: "595", nationalLengths: [9] },
  BR: { callingCode: "55", nationalLengths: [10, 11] },
  ES: { callingCode: "34", nationalLengths: [9] },
};

export interface NormalizePhoneOptions {
  /**
   * Applied when the input has no `+`/`00` prefix and looks like a national number.
   * ISO 3166-1 alpha-2 (`"GT"`) from `COUNTRY_CALLING_CODES`, or a calling code (`"502"`, `"+502"`).
   */
  defaultCountry?: string;
}

const ALLOWED_CHARS_RE = /^\+?[\d\s\-().]+$/;
const E164_RE = /^[1-9]\d{7,14}$/;

function resolveCountry(defaultCountry: string): CountryDialing | null {
  const trimmed = defaultCountry.trim();
  const byIso = COUNTRY_CALLING_CODES[trimmed.toUpperCase()];
  if (byIso) return byIso;
  const digits = trimmed.replace(/^\+/, "");
  if (/^[1-9]\d{0,2}$/.test(digits)) return { callingCode: digits, nationalLengths: [] };
  return null;
}

function applyDefaultCountry(digits: string, country: CountryDialing): string {
  const national = digits.replace(/^0+/, "");
  if (country.nationalLengths.includes(national.length)) return country.callingCode + national;
  if (digits.startsWith(country.callingCode)) return digits;
  return country.nationalLengths.length === 0 ? country.callingCode + national : digits;
}

/**
 * Normalizes a phone number to E.164 (`+50255551234`). Accepts spaces, dashes,
 * dots, parentheses and a `+` or `00` international prefix. Digits without a
 * prefix are read as international (like WhatsApp `wa_id`s) unless
 * `defaultCountry` says they are national. Throws `InvalidPhoneError`.
 */
export function normalizePhone(input: string, opts: NormalizePhoneOptions = {}): string {
  const trimmed = input.trim();
  if (!ALLOWED_CHARS_RE.test(trimmed)) {
    throw new InvalidPhoneError({ input, reason: "unexpected characters" });
  }
  let digits = trimmed.replace(/\D/g, "");
  const international = trimmed.startsWith("+") || digits.startsWith("00");
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (!international && opts.defaultCountry !== undefined) {
    const country = resolveCountry(opts.defaultCountry);
    if (!country) {
      throw new InvalidPhoneError({ input, reason: `unknown country "${opts.defaultCountry}"` });
    }
    digits = applyDefaultCountry(digits, country);
  }

  if (!E164_RE.test(digits)) {
    throw new InvalidPhoneError({ input, reason: "not a valid E.164 number" });
  }
  return `+${digits}`;
}

/** `true` when `normalizePhone(input, opts)` would succeed. */
export function isValidPhone(input: string, opts: NormalizePhoneOptions = {}): boolean {
  try {
    normalizePhone(input, opts);
    return true;
  } catch {
    return false;
  }
}
