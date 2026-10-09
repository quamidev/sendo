import type { SendoContext } from "../core/context";
import { stubNamespace } from "../core/slots";
import type { Actor } from "./permissions";

/** `sendo.tags` (SND-3.3). Placeholder signatures until the `Tag` entity lands. */
export interface TagsApi {
  list(o: { actor: Actor }): Promise<unknown[]>;
  upsert(input: Record<string, unknown>, o: { actor: Actor }): Promise<unknown>;
  delete(id: string, o: { actor: Actor }): Promise<void>;
  /** Conversations using the tag (delete confirmation). */
  usage(id: string, o: { actor: Actor }): Promise<number>;
}

/** `SENDO_MODULES` entry. Placeholder: keeps the stub until SND-3.3. */
export function installTags(ctx: SendoContext): void {
  ctx.slots.tags = stubNamespace("tags");
}
