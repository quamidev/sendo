import type { Metadata } from "next";
import Link from "next/link";
import { RootDocument } from "@/components/site/root-document";

export const metadata: Metadata = {
  title: "Page not found · Sendo",
  robots: { index: false },
};

const linkClass =
  "rounded-sm font-medium underline decoration-muted-foreground/50 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:opacity-70";

/**
 * The 404 for every URL no route matches (`/fr`, `/en/nope`, `/docs/nope`). The app has several
 * root layouts (`[lang]`, `docs`, `(frame)`), so there is no single layout to render it in.
 * Both languages, since the URL may not say which one the visitor reads.
 */
export default function GlobalNotFound() {
  return (
    <RootDocument lang="en">
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-3 px-4 py-12">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground" lang="es">
          Página no encontrada.
        </p>
        <p className="flex flex-wrap gap-4 text-sm">
          <Link href="/en" className={linkClass}>
            Home
          </Link>
          <Link href="/es" className={linkClass} lang="es" hrefLang="es">
            Inicio
          </Link>
          <Link href="/docs" className={linkClass}>
            Docs
          </Link>
        </p>
      </main>
    </RootDocument>
  );
}
