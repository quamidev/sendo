// Motion recipes kept in MOTION.md. Only `transform` and `opacity` move (plus colour on press).
// The `--sendo-*` tokens come from the app (sendo-inbox's motion.css defines them); the fallbacks
// keep this item working on its own. Reduced motion keeps the fades and drops the scale.

const EASE_OUT = "ease-[var(--sendo-ease-out,cubic-bezier(0.16,1,0.3,1))]";

/** #1 Press feedback from pointer-down; a transition, so a quick release retargets mid-flight. */
export const pressClass = `transition-[transform,color,background-color,border-color] duration-[var(--sendo-dur-press,120ms)] ${EASE_OUT} active:[transform:scale(0.97)] motion-reduce:active:[transform:none]`;

/** #2 Refetch keeps the frame: the previous numbers dim while the new ones load. */
export const refetchClass = `transition-[opacity] duration-[var(--sendo-dur-fast,160ms)] ${EASE_OUT}`;

/** #3 Chart tooltip: fades in on the first hover/focus; moving between days is instant. */
export const tooltipFadeClass = `transition-[opacity] duration-[var(--sendo-dur-fast,160ms)] ${EASE_OUT}`;

/** #4 Tag menu: grows from its trigger (top-left), opacity + 0.97 scale, on open only. */
export const menuEnterClass = `origin-top-left transition-[opacity,transform] duration-[var(--sendo-dur-menu,200ms)] ${EASE_OUT} starting:opacity-0 starting:[transform:scale(0.97)] motion-reduce:starting:[transform:none]`;
