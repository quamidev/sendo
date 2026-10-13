const EASE_OUT = "ease-[var(--sendo-ease-out,cubic-bezier(0.16,1,0.3,1))]";

/** Press feedback from pointer-down; a transition, so a quick release retargets mid-flight. */
export const pressClass = `transition-[transform,color,background-color,border-color] duration-[var(--sendo-dur-press,120ms)] ${EASE_OUT} active:[transform:scale(0.97)] motion-reduce:active:[transform:none]`;

/** In-place state swap (copy → copied, fresh → regenerating): opacity only, nothing moves. */
export const fadeSwapClass = `transition-[opacity] duration-[var(--sendo-dur-fast,160ms)] ${EASE_OUT}`;
