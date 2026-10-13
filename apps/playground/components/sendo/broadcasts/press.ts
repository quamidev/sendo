const EASE_OUT = "ease-[var(--sendo-ease-out,cubic-bezier(0.16,1,0.3,1))]";

/** Press feedback from pointer-down; a transition, so a quick release retargets mid-flight. */
export const pressClass = `transition-[transform,color,background-color,border-color,opacity] duration-[var(--sendo-dur-press,120ms)] ${EASE_OUT} active:[transform:scale(0.97)] motion-reduce:active:[transform:none]`;

/**
 * A step of the screen entering (list → composer → review → progress): fades in and rises 4 px
 * once, on insertion (`@starting-style`). Reduced motion: the fade only.
 */
export const viewEnterClass = `transition-[opacity,transform] duration-[var(--sendo-dur-menu,200ms)] ${EASE_OUT} starting:opacity-0 starting:[transform:translateY(4px)] motion-reduce:starting:[transform:none]`;

/** A list waiting for the server (filter change, refresh): dims in place, nothing moves. */
export const pendingFadeClass = `transition-[opacity] duration-[var(--sendo-dur-fast,160ms)] ${EASE_OUT}`;

/** shadcn Dialog without the zoom under reduced motion (the fade stays). */
export const dialogReducedClass =
  "motion-reduce:[--tw-enter-scale:1] motion-reduce:[--tw-exit-scale:1]";
