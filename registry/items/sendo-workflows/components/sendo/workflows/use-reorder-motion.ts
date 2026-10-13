"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { REORDER_DURATION_MS, REORDER_EASING } from "./press";

function currentTranslateY(node: HTMLElement): number {
  const transform = getComputedStyle(node).transform;
  if (transform === "" || transform === "none") return 0;
  return new DOMMatrixReadOnly(transform).m42;
}

/**
 * FLIP for list rows whose order changed (move up/down, delete): each row slides from where it
 * was to its new slot with `transform` only. A move during a running slide starts from the row's
 * current position (interruptible). Under `prefers-reduced-motion: reduce` rows jump.
 * Returns a ref callback factory: `ref={rowRef(id)}`.
 */
export function useReorderMotion(
  order: readonly string[],
): (id: string) => (node: HTMLElement | null) => void {
  const nodes = useRef(new Map<string, HTMLElement>());
  const offsets = useRef(new Map<string, number>());
  const lastOrder = useRef(order.join("\n"));
  const orderKey = order.join("\n");

  useLayoutEffect(() => {
    const changed = orderKey !== lastOrder.current;
    lastOrder.current = orderKey;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    for (const [id, node] of nodes.current) {
      const top = node.offsetTop;
      const before = offsets.current.get(id);
      offsets.current.set(id, top);
      if (!changed || reduce || before === undefined || before === top) continue;
      const from = before - top + currentTranslateY(node);
      node.style.transition = "none";
      node.style.transform = `translateY(${String(from)}px)`;
      node.getBoundingClientRect();
      node.style.transition = `transform ${String(REORDER_DURATION_MS)}ms ${REORDER_EASING}`;
      node.style.transform = "";
    }
    for (const id of offsets.current.keys()) {
      if (!nodes.current.has(id)) offsets.current.delete(id);
    }
  });

  return useCallback(
    (id: string) => (node: HTMLElement | null) => {
      if (node === null) nodes.current.delete(id);
      else nodes.current.set(id, node);
    },
    [],
  );
}
