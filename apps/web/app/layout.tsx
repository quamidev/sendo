import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site/site-header";
import { ThemeProvider } from "@/components/site/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Sendo — WhatsApp for Quami apps",
    template: "%s · Sendo",
  },
  description:
    "WhatsApp Cloud API library and shadcn registry for Quami apps: webhook, messaging, agents and inbox.",
};

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
          <SiteHeader />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
