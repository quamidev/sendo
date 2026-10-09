import type { ReactNode } from "react";

/** Pages rendered inside an iframe of the site: no header, the page fills the frame. */
export default function FrameLayout({ children }: { children: ReactNode }) {
  return children;
}
