import type { HeaderLink } from "./links";

/** The small "EN" mark after Docs on `/es`; screen readers hear the label instead. */
export function LinkHint({ hint }: { hint: NonNullable<HeaderLink["hint"]> }) {
  return (
    <>
      <span
        aria-hidden
        lang="en"
        title={hint.label}
        className="ml-1 align-super font-mono text-[10px] text-muted-foreground"
      >
        {hint.text}
      </span>
      <span className="sr-only"> ({hint.label})</span>
    </>
  );
}
