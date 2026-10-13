/** A header destination, shared by the desktop pill nav and the mobile sheet. */
export interface HeaderLink {
  href: string;
  label: string;
  /** The "EN" mark next to Docs on `/es` (AC-ST-13). */
  hint?: { text: string; label: string };
  external?: true;
}
