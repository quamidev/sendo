import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/site/theme-provider";
import "@/app/globals.css";

/**
 * `<html>` and `<body>` for every root layout. The app has one root layout per language
 * context (`app/[lang]`, `app/docs`, `app/(frame)`) so each page gets the right `<html lang>`.
 */
export function RootDocument({ lang, children }: { lang: string; children: ReactNode }) {
  return (
    <html lang={lang} suppressHydrationWarning>
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
