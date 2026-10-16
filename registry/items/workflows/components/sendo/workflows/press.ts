// Motion recipes kept in MOTION.md. Only `transform` and `opacity` move (plus colour on press).
// The `--sendo-*` tokens come from the app (inbox's motion.css defines them); the fallbacks
// keep this item working on its own. Reduced motion keeps the fades and drops every movement.

const EASE_OUT = "ease-[var(--sendo-ease-out,cubic-bezier(0.16,1,0.3,1))]";

/** Press feedback from pointer-down; a transition, so a quick release retargets mid-flight. */
export const pressClass = `transition-[transform,color,background-color,border-color] duration-[var(--sendo-dur-press,120ms)] ${EASE_OUT} active:[transform:scale(0.97)] motion-reduce:active:[transform:none]`;

/** A row waiting for the server (toggle, move, delete): dims in place, nothing moves. */
export const pendingFadeClass = `transition-[opacity] duration-[var(--sendo-dur-fast,160ms)] ${EASE_OUT}`;

/**
 * The editor sheet: tw-animate-css keyframes retimed to the sheet token with the ease-out curve
 * (the shadcn default is 500 ms ease-in-out). Exit is faster than enter. Under reduced motion the
 * slide is removed and the sheet fades.
 */
export const sheetMotionClass = `${EASE_OUT} data-[state=open]:duration-[var(--sendo-dur-sheet,320ms)] data-[state=closed]:duration-[var(--sendo-dur-menu,200ms)] motion-reduce:data-[state=open]:[--tw-enter-translate-x:0] motion-reduce:data-[state=closed]:[--tw-exit-translate-x:0] motion-reduce:data-[state=open]:[--tw-enter-opacity:0] motion-reduce:data-[state=closed]:[--tw-exit-opacity:0]`;

/** Duration and curve of the reorder slide (FLIP, `use-reorder-motion.ts`). On-screen movement. */
export const REORDER_DURATION_MS = 220;
export const REORDER_EASING = "var(--sendo-ease-in-out, cubic-bezier(0.65, 0, 0.35, 1))";
