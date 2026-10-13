/**
 * AC-CN-5 (US-37), AC-ST-4 inputs: the pricing page states the Connect privacy and billing facts
 * plainly in both languages, and the site header links to it. Rendered to static HTML (no
 * browser): the claims are the contract.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteHeader } from "@/components/site/site-header";
import type { Lang } from "@/lib/i18n";
import PricingPage from "./page";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&rsquo;/g, "’")
    .replace(/&[a-z]+;|&#\d+;/g, " ")
    .replace(/\s+/g, " ");

const render = async (lang: Lang) =>
  text(
    renderToStaticMarkup(
      await PricingPage({ params: Promise.resolve({ lang }), searchParams: Promise.resolve({}) }),
    ),
  );

const claims: Record<Lang, string[]> = {
  en: [
    "pass through Quami in transit",
    "never stored",
    "use your own Meta app",
    "MIDI Med",
    "directly to the owner of the WhatsApp Business account",
    "Meta bills messages directly to your customer; they need a card on their account.",
    "Price coming soon",
  ],
  es: [
    "pasan por Quami en tránsito",
    "nunca guarda",
    "usa tu propia app de Meta",
    "MIDI Med",
    "directo al dueño de la cuenta de WhatsApp Business",
    "Meta cobra los mensajes directo a tu cliente; necesita tarjeta en su cuenta.",
    "Precio próximamente",
  ],
};

describe("/[lang]/pricing", () => {
  it("[AC-CN-5] says messages pass through Quami in transit and are never stored, who pays Meta, and the price is pending, in English and Spanish", async () => {
    for (const lang of ["en", "es"] as const) {
      const page = await render(lang);
      for (const claim of claims[lang]) expect(page, lang).toContain(claim);
    }
    const en = await render("en");
    expect(en).not.toContain("Precio");
    expect(en).not.toContain("Meta cobra");
  });

  it("[AC-CN-5] is linked from the site header in both languages", () => {
    expect(renderToStaticMarkup(<SiteHeader lang="en" />)).toContain('href="/en/pricing"');
    expect(renderToStaticMarkup(<SiteHeader lang="es" />)).toContain('href="/es/pricing"');
  });
});
