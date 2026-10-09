import type { SendoContext } from "../core/context";
import {
  ConstraintViolationError,
  PayloadValidationError,
  RecordNotFoundError,
} from "../errors/errors";
import type { Tag } from "../types/entities";
import { TAG_COLORS, type TagColor } from "../types/enums";
import { assertCan, type Actor } from "./permissions";
import { TAG_NAME_MAX_LENGTH } from "./snippet-text";

/** Creates a tag (no `id`) or renames / recolors one of the actor's tenant. */
export interface TagInput {
  id?: string;
  /** 1–64 characters, trimmed; unique per tenant ignoring case. */
  name: string;
  /** One of `TAG_COLORS`. */
  color: TagColor;
}

/**
 * `sendo.tags`: the tenant's tag catalog. Everyone can `list` (the tag picker); changing the
 * catalog and `usage` need `tags.manage`. Adding tags to conversations is `sendo.inbox.tags`.
 */
export interface TagsApi {
  /** Sorted by name, ignoring case. */
  list(o: { actor: Actor }): Promise<Tag[]>;
  /**
   * Taken name → `ConstraintViolationError` (`sendo_tags_name_key`); invalid name or color →
   * `PayloadValidationError`; unknown id → `RecordNotFoundError`.
   */
  upsert(input: TagInput, o: { actor: Actor }): Promise<Tag>;
  /** Also removes the tag from every conversation (confirm with `usage` first). */
  delete(id: string, o: { actor: Actor }): Promise<void>;
  /** How many conversations carry the tag (the delete confirmation). */
  usage(id: string, o: { actor: Actor }): Promise<number>;
}

function validName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") {
    throw new PayloadValidationError({ field: "name", message: "write a tag name." });
  }
  if (name.length > TAG_NAME_MAX_LENGTH) {
    throw new PayloadValidationError({
      field: "name",
      message: `shorten the name to ${String(TAG_NAME_MAX_LENGTH)} characters or fewer.`,
      limit: TAG_NAME_MAX_LENGTH,
    });
  }
  return name;
}

function validColor(value: unknown): TagColor {
  if (!(TAG_COLORS as readonly unknown[]).includes(value)) {
    throw new PayloadValidationError({
      field: "color",
      message: `use one of the palette colors: ${TAG_COLORS.join(", ")}.`,
    });
  }
  return value as TagColor;
}

export function createTags(ctx: SendoContext): TagsApi {
  const { adapter } = ctx;

  async function requireTag(id: string, actor: Actor): Promise<Tag> {
    const tag = await adapter.tags.get(id);
    if (!tag || tag.tenantId !== actor.tenantId)
      throw new RecordNotFoundError({ entity: "tag", id });
    return tag;
  }

  return {
    async list({ actor }) {
      await ctx.ready();
      return adapter.tags.list({ tenantId: actor.tenantId });
    },

    async upsert(input, { actor }) {
      await ctx.ready();
      assertCan(actor, "tags.manage");
      const existing = input.id === undefined ? null : await requireTag(input.id, actor);
      const name = validName(input.name);
      const color = validColor(input.color);
      try {
        return await adapter.tags.upsert({
          ...(existing ? { id: existing.id } : {}),
          tenantId: actor.tenantId,
          name,
          color,
        });
      } catch (error) {
        if (
          error instanceof ConstraintViolationError &&
          error.constraint === "sendo_tags_name_key"
        ) {
          throw new ConstraintViolationError(
            {
              constraint: error.constraint,
              message: `A tag named "${name}" already exists (names ignore case). Use the existing tag or choose a different name.`,
            },
            { cause: error },
          );
        }
        throw error;
      }
    },

    async delete(id, { actor }) {
      await ctx.ready();
      assertCan(actor, "tags.manage");
      const tag = await requireTag(id, actor);
      await adapter.tags.delete(tag.id);
    },

    async usage(id, { actor }) {
      await ctx.ready();
      assertCan(actor, "tags.manage");
      const tag = await requireTag(id, actor);
      return adapter.tags.usage(tag.id);
    },
  };
}

/** `SENDO_MODULES` entry. */
export function installTags(ctx: SendoContext): void {
  ctx.slots.tags = createTags(ctx);
}
