import type { SendoContext } from "../core/context";
import { stubNamespace } from "../core/slots";
import type { TenantId } from "../types/entities";

export interface CreateLinkInput {
  account?: string;
  tenant?: TenantId;
  /** Prefilled message; ` [#source]` is appended. */
  text?: string;
  /** `^[a-z0-9-]{1,32}$`. */
  source: string;
}

export interface WhatsAppLink {
  url: string;
  code: string;
  phone: string;
}

/** `sendo.links` (SND-3.8). */
export interface LinksApi {
  create(input: CreateLinkInput): Promise<WhatsAppLink>;
}

/** `SENDO_MODULES` entry. Placeholder: keeps the stub until SND-3.8. */
export function installLinks(ctx: SendoContext): void {
  ctx.slots.links = stubNamespace("links");
}
