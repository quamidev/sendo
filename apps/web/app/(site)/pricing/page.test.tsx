/**
 * AC-CN-5 (US-37): the pricing page states the Connect privacy and billing facts plainly, and the
 * site header links to it. Rendered to static HTML (no browser): the claims are the contract.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteHeader } from "@/components/site/site-header";
import PricingPage from "./page";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&rsquo;/g, "’")
    .replace(/&[a-z]+;|&#\d+;/g, " ")
    .replace(/\s+/g, " ");

describe("/pricing", () => {
  it("[AC-CN-5] says messages pass through Quami in transit and are never stored, who pays Meta, and the price is pending", () => {
    const page = text(renderToStaticMarkup(<PricingPage />));
    for (const claim of [
      "pass through Quami in transit",
      "never stored",
      "use your own Meta app",
      "MIDI Med",
      "directly to the owner of the WhatsApp Business account",
      "Meta cobra los mensajes directo a tu cliente; necesita tarjeta en su cuenta.",
      "Precio por confirmar",
    ]) {
      expect(page).toContain(claim);
    }
  });

  it("[AC-CN-5] is linked from the site header", () => {
    expect(renderToStaticMarkup(<SiteHeader />)).toContain('href="/pricing"');
  });
});
