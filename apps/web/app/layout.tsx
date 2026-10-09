import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/site/theme-provider";
import { SITE_URL } from "@/lib/docs-source.mjs";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Sendo — the conversation inbox that lives inside your app",
    template: "%s · Sendo",
  },
  description:
    "WhatsApp with AI agents and people taking turns, installed as your own code: an MIT npm package and shadcn registry items for Next.js.",
};

// The site pages live in `(site)` (with the header); `(frame)` holds the demo inbox that the
// landing and /demo embed in an iframe.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
