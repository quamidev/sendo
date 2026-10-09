import type { TemplateUpsertInput } from "../../adapters/types";
import { buildTemplatePayload, type TemplatePayload } from "../../client/payloads";
import type { MetaTemplate } from "../../client/types";
import {
  NotImplementedError,
  TemplateNotFoundError,
  TemplateVariablesError,
} from "../../errors/errors";
import type { MetaDirectTransport } from "../../transport/meta-direct";
import type { Transport } from "../../transport/types";
import type { Account, JsonObject, Template } from "../../types/entities";
import type { TemplateStatus } from "../../types/enums";
import { requireWabaId } from "../../utils/channel-ids";
import type { SendoContext } from "../context";
import type { TemplateSendOptions } from "../outbound";

export interface PrepareTemplateInput extends TemplateSendOptions {
  account: Account;
  /** E.164 recipient. */
  to: string;
  name: string;
}

export interface PreparedTemplate {
  template: Template;
  payload: TemplatePayload;
  content: JsonObject;
  /** Body text with the variables filled in (for previews and search). */
  text: string;
}

export interface TemplatesListQuery {
  /** Account object, id or phone number id. Omitted lists every account. */
  account?: string | Account;
  status?: TemplateStatus;
  /** Include templates no longer on Meta. Default `false`. */
  includeInactive?: boolean;
}

export interface TemplatesService {
  /** Pulls templates from Meta, upserts them and marks the missing ones inactive. All active accounts when `account` is omitted. */
  sync(opts?: { account?: string | Account }): Promise<Template[]>;
  list(query?: TemplatesListQuery): Promise<Template[]>;
  /**
   * Checks the stored template (missing, inactive or not APPROVED → `TemplateNotFoundError`;
   * wrong variable count → `TemplateVariablesError`) and builds the payload. No Meta call.
   */
  prepare(input: PrepareTemplateInput): Promise<PreparedTemplate>;
}

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function bodyText(components: readonly JsonObject[]): string | null {
  const body = components.find(
    (c) => typeof c.type === "string" && c.type.toUpperCase() === "BODY",
  );
  return typeof body?.text === "string" ? body.text : null;
}

/** Distinct `{{1}}` / `{{name}}` placeholders in the template body. */
export function countTemplateVariables(components: readonly JsonObject[]): number {
  const text = bodyText(components);
  if (text === null) return 0;
  return new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1])).size;
}

export function renderTemplateBody(
  components: readonly JsonObject[],
  variables: string[] | Record<string, string> | undefined,
): string | null {
  const text = bodyText(components);
  if (text === null) return null;
  return text.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (variables === undefined) return match;
    const value = Array.isArray(variables) ? variables[Number(key) - 1] : variables[key];
    return value ?? match;
  });
}

function toUpsertInput(meta: MetaTemplate, syncedAt: Date): TemplateUpsertInput {
  const components: JsonObject[] = meta.components.map((c) => ({ ...c }));
  return {
    name: meta.name,
    language: meta.language,
    category: meta.category,
    status: meta.status,
    components,
    variableCount: countTemplateVariables(components),
    syncedAt,
  };
}

function isMetaDirect(transport: Transport): transport is MetaDirectTransport {
  return transport.kind === "meta-direct";
}

function variableCount(variables: string[] | Record<string, string> | undefined): number {
  if (variables === undefined) return 0;
  return Array.isArray(variables) ? variables.length : Object.keys(variables).length;
}

export function createTemplatesService(ctx: SendoContext): TemplatesService {
  const { adapter } = ctx;

  return {
    async sync(opts = {}) {
      const transport = ctx.transport;
      if (!isMetaDirect(transport)) {
        throw new NotImplementedError(`templates.sync on the "${transport.kind}" transport`);
      }
      const accounts =
        opts.account === undefined
          ? await adapter.accounts.list({ active: true })
          : [await ctx.resolveAccount({ account: opts.account })];
      const synced: Template[] = [];
      for (const account of accounts) {
        const metas = await ctx.callTransport(account, async () => {
          const token = await transport.resolveToken(account);
          ctx.addSecret(token);
          return transport.graph.listTemplates(token, requireWabaId(account));
        });
        const now = new Date();
        const inputs = metas.map((meta) => toUpsertInput(meta, now));
        const templates = await adapter.templates.upsertMany(account.id, inputs);
        await adapter.templates.markInactiveExcept(
          account.id,
          inputs.map(({ name, language }) => ({ name, language })),
        );
        synced.push(...templates);
      }
      return synced;
    },

    async list(query = {}) {
      const accountId =
        query.account === undefined
          ? undefined
          : (await ctx.resolveAccount({ account: query.account })).id;
      return adapter.templates.list({
        accountId,
        status: query.status,
        active: query.includeInactive === true ? undefined : true,
      });
    },

    async prepare(input) {
      const { account, name, language } = input;
      const template = await adapter.templates.get(account.id, name, language);
      const notFound = (reason: "missing" | "inactive" | "not_approved") =>
        new TemplateNotFoundError({ name, language, accountId: account.id, reason });
      if (!template) throw notFound("missing");
      if (!template.active) throw notFound("inactive");
      if (template.status !== "APPROVED") throw notFound("not_approved");
      const received = variableCount(input.variables);
      if (received !== template.variableCount) {
        throw new TemplateVariablesError({ name, expected: template.variableCount, received });
      }
      const payload = buildTemplatePayload(input.to, {
        name,
        language,
        variables: input.variables,
        headerMedia: input.headerMedia,
        buttons: input.buttons,
        replyTo: input.replyTo,
      });
      const content: JsonObject = { name, language };
      if (input.variables !== undefined) content.variables = input.variables;
      if (input.headerMedia !== undefined) content.headerMedia = { ...input.headerMedia };
      if (input.buttons !== undefined) content.buttons = input.buttons.map((b) => ({ ...b }));
      return {
        template,
        payload,
        content,
        text: renderTemplateBody(template.components, input.variables) ?? name,
      };
    },
  };
}
