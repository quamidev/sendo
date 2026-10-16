import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RootDocument } from "@/components/site/root-document";
import { SITE_URL } from "@/lib/docs-source.mjs";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Sendo", template: "%s · Sendo" },
};

/**
 * Root layout of the pages rendered inside an iframe of the site (no header, the page fills the
 * frame). A layout can't read the query string, so the page language arrives in the frame itself.
 */
export default function FrameLayout({ children }: { children: ReactNode }) {
  return <RootDocument lang="en">{children}</RootDocument>;
}
