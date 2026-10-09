import type { SendoContext } from "../core/context";
import { stubNamespace } from "../core/slots";
import type { Actor } from "./permissions";

/** `sendo.snippets` (SND-3.3). Placeholder signatures until the `Snippet` entity lands. */
export interface SnippetsApi {
  list(o: { actor: Actor }): Promise<unknown[]>;
  get(id: string, o: { actor: Actor }): Promise<unknown>;
  upsert(input: Record<string, unknown>, o: { actor: Actor }): Promise<unknown>;
  delete(id: string, o: { actor: Actor }): Promise<void>;
  render(
    snippetId: string,
    o: { actor: Actor; conversationId: string },
  ): Promise<{ text: string; unresolved: string[] }>;
}

/** `SENDO_MODULES` entry. Placeholder: keeps the stub until SND-3.3. */
export function installSnippets(ctx: SendoContext): void {
  ctx.slots.snippets = stubNamespace("snippets");
}
