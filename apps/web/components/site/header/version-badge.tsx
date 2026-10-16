import sendoPackage from "@quami/sendo/package.json" with { type: "json" };
import { interpolate } from "@/lib/i18n/rich";

/** The workspace's `@quami/sendo` version, inlined at build time (AC-ST-13). */
export const SENDO_VERSION = `v${sendoPackage.version}`;
export const SENDO_NPM_URL = "https://www.npmjs.com/package/@quami/sendo";

/** Version pill next to the logo, linking to the package on npm. */
export function VersionBadge({ label }: { label: string }) {
  const name = interpolate(label, { version: SENDO_VERSION });
  return (
    <a
      href={SENDO_NPM_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={name}
      title={name}
      className="relative inline-flex h-5 items-center rounded-full border px-2 font-mono text-[11px] leading-none text-muted-foreground outline-none after:absolute after:inset-x-0 after:-inset-y-2.5 hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent"
    >
      {SENDO_VERSION}
    </a>
  );
}
