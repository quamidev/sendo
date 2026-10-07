import { installInbox } from "../inbox/inbox";
import { installPipeline } from "./pipeline";
import type { WhatsAppContext } from "./context";

/**
 * Installs a feature into a client: assigns `ctx.slots.<name>` and/or
 * `ctx.agentDispatcher`. Runs once per `createWhatsApp`, after the context is built.
 */
export type WhatsAppModule = (ctx: WhatsAppContext) => void;

/**
 * Feature modules composed by `createWhatsApp`. WAL-2.7 (pipeline: handleWebhook,
 * events, maintenance), WAL-3.1 (agent) and WAL-3.2 (inbox) each add one entry.
 */
export const WHATSAPP_MODULES: readonly WhatsAppModule[] = [installPipeline, installInbox];
