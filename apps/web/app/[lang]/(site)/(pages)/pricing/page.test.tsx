/**
 * AC-CN-5 (US-37), AC-CN-7, AC-ST-4 inputs: the pricing page states the Connect privacy and billing
 * facts plainly in both languages, and the site header links to it. Rendered to static HTML (no
 * browser): the claims are the contract. Ways it can fail:
 *
 * 1. A Connect privacy fact (held encrypted while pending, deleted after 24 h, never logged,
 *    metadata 7 days, Quami's Meta app) or the billing caveat goes missing in either language.
 * 2. The "What Quami sees" block disappears from either plan card (AC-CN-7: same weight).
 * 3. The link to Meta's rate card or to `/docs/coexistence` goes missing (AC-ST-11, AC-ST-12).
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
    "held encrypted only while its delivery is pending",
    "after 24 h",
    "never logged",
    "kept for 7 days",
    "Quami’s Meta app is the one connected",
    "Guatemala falls under “Rest of Latin America”",
    "use your own Meta app",
    "MIDI Med",
    "directly to the owner of the WhatsApp Business account",
    "Meta bills messages directly to your customer; they need a card on their account.",
    "Price coming soon",
  ],
  es: [
    "pasan por Quami en tránsito",
    "guarda cifrado solo mientras su entrega está pendiente",
    "a las 24 h",
    "Nunca se registra",
    "se guardan 7 días",
    "La app de Meta de Quami es la que queda conectada",
    "Guatemala entra en «Resto de América Latina»",
    "usa tu propia app de Meta",
    "MIDI Med",
    "directo al dueño de la cuenta de WhatsApp Business",
    "Meta cobra los mensajes directo a tu cliente; necesita tarjeta en su cuenta.",
    "Precio próximamente",
  ],
};

describe("/[lang]/pricing", () => {
  it("[AC-CN-5] says messages pass through Quami in transit and are held encrypted only while delivery is pending, who pays Meta, and the price is pending, in English and Spanish", async () => {
    for (const lang of ["en", "es"] as const) {
      const page = await render(lang);
      for (const claim of claims[lang]) expect(page, lang).toContain(claim);
    }
    const en = await render("en");
    expect(en).not.toContain("Precio");
    expect(en).not.toContain("Meta cobra");
  });

  it("[AC-CN-7] states what Quami sees in both plan cards, and links Meta's rate card and the coexistence limits", async () => {
    for (const lang of ["en", "es"] as const) {
      const html = renderToStaticMarkup(
        await PricingPage({ params: Promise.resolve({ lang }), searchParams: Promise.resolve({}) }),
      );
      expect(html, lang).toContain('id="own-app-privacy"');
      expect(html, lang).toContain('id="connect-privacy"');
      expect(html, lang).toContain('href="https://developers.facebook.com/docs/whatsapp/pricing"');
      expect(html, lang).toContain('href="/docs/coexistence"');
    }
  });

  it("[AC-CN-5] is linked from the site header in both languages", () => {
    expect(renderToStaticMarkup(<SiteHeader lang="en" />)).toContain('href="/en/pricing"');
    expect(renderToStaticMarkup(<SiteHeader lang="es" />)).toContain('href="/es/pricing"');
  });
});
