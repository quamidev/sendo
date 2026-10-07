import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/site/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "wa-li playground", template: "%s · wa-li playground" },
  description: "App de prueba que instala wa-li desde el registro local.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-GT" suppressHydrationWarning>
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
