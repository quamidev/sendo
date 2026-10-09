import { installAgents } from "../agents/runtime";
import { installBroadcasts } from "../broadcasts";
import { installInbox } from "../inbox/inbox";
import { installMetrics } from "../metrics";
import { installRules } from "../rules";
import { installSnippets } from "../team/snippets";
import { installTags } from "../team/tags";
import { installLinks } from "../widgets/links";
import { installPipeline } from "./pipeline";
import type { SendoContext } from "./context";

/**
 * Installs a feature into a client: assigns `ctx.slots.<name>` and/or
 * `ctx.agentDispatcher`. Runs once per `createSendo`, after the context is built.
 */
export type SendoModule = (ctx: SendoContext) => void;

/**
 * Feature modules composed by `createSendo`. WAL-2.7 (pipeline: handleWebhook,
 * events, maintenance), WAL-3.1 (agent) and WAL-3.2 (inbox) each add one entry. The
 * batch-3/4 entries start as placeholders that keep their stub slot; each owning ticket
 * replaces the body of its installer in its own file.
 */
export const SENDO_MODULES: readonly SendoModule[] = [
  installPipeline,
  installInbox,
  installAgents,
  installSnippets,
  installTags,
  installRules,
  installLinks,
  installBroadcasts,
  installMetrics,
];
