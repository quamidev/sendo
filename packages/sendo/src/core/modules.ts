import { installAgents } from "../agents/runtime";
import { installInbox } from "../inbox/inbox";
import { installPipeline } from "./pipeline";
import type { SendoContext } from "./context";

/**
 * Installs a feature into a client: assigns `ctx.slots.<name>` and/or
 * `ctx.agentDispatcher`. Runs once per `createSendo`, after the context is built.
 */
export type SendoModule = (ctx: SendoContext) => void;

/**
 * Feature modules composed by `createSendo`. WAL-2.7 (pipeline: handleWebhook,
 * events, maintenance), WAL-3.1 (agent) and WAL-3.2 (inbox) each add one entry.
 */
export const SENDO_MODULES: readonly SendoModule[] = [installPipeline, installInbox, installAgents];
