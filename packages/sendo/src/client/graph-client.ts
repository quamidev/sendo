import { MetaApiError } from "../errors/meta-api-error";
import type { MediaType } from "../types/enums";
import { createRedactingLogger, type Logger, type RedactingLogger } from "../utils/logger";
import { assertMediaAcceptable } from "../utils/media";
import { redactText } from "../utils/redact";
import type { MessagePayload } from "./payloads";
import type {
  MetaMediaInfo,
  MetaPhoneNumber,
  MetaSubscribedApp,
  MetaTemplate,
  MetaTemplateComponent,
} from "./types";

/** Graph API version used when none is configured (latest stable, Meta changelog July 2026). */
export const GRAPH_API_VERSION = "v26.0";
export const GRAPH_API_BASE_URL = "https://graph.facebook.com";

/** Hard stop for `paging.next` loops. */
const MAX_PAGES = 50;
const TEMPLATE_FIELDS = "id,name,language,status,category,components,parameter_format";
const PHONE_FIELDS =
  "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type,throughput";

export interface GraphClientOptions {
  /** Graph API version, e.g. `"v26.0"` (a missing `v` is added). Default `GRAPH_API_VERSION`. */
  version?: string;
  /** Custom fetch. Resolved per call; defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Console-like logger; wrapped so tokens never reach it. */
  logger?: Logger;
  /** Default `https://graph.facebook.com`. */
  baseUrl?: string;
}

export interface UploadMediaOptions {
  filename?: string;
  /** Media type for Meta's limit check. Inferred from the MIME type when omitted. */
  mediaType?: MediaType;
}

export interface GraphClient {
  readonly version: string;
  readonly baseUrl: string;
  sendMessage(
    token: string,
    phoneNumberId: string,
    payload: MessagePayload,
  ): Promise<{ metaMessageId: string }>;
  getMediaUrl(token: string, mediaId: string): Promise<MetaMediaInfo>;
  downloadMedia(token: string, url: string): Promise<Uint8Array>;
  uploadMedia(
    token: string,
    phoneNumberId: string,
    file: Blob | Uint8Array,
    mime: string,
    options?: string | UploadMediaOptions,
  ): Promise<{ mediaId: string }>;
  listTemplates(token: string, wabaId: string): Promise<MetaTemplate[]>;
  getPhoneNumber(token: string, phoneNumberId: string): Promise<MetaPhoneNumber>;
  getSubscribedApps(token: string, wabaId: string): Promise<MetaSubscribedApp[]>;
  /** `DELETE /{waba_id}/subscribed_apps`: stops this app's webhooks for the WABA. */
  unsubscribeApp(token: string, wabaId: string): Promise<void>;
  /**
   * Embedded Signup: `GET /oauth/access_token?client_id&client_secret&code`. Returns the
   * business token. `appSecret` and `code` are redacted from logs and errors.
   */
  exchangeCode(input: { appId: string; appSecret: string; code: string }): Promise<string>;
  /** `POST /{waba_id}/subscribed_apps`: subscribes this app to the WABA's webhooks. */
  subscribeApp(token: string, wabaId: string): Promise<void>;
  /** `POST /{phone_number_id}/register` with the two-step PIN (redacted from logs and errors). */
  registerPhone(token: string, phoneNumberId: string, pin: string): Promise<void>;
  /** `GET /{waba_id}?fields=...`: the raw WABA fields Meta returned. */
  getWaba(
    token: string,
    wabaId: string,
    fields: readonly string[],
  ): Promise<Record<string, unknown>>;
  markRead(token: string, phoneNumberId: string, metaMessageId: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** Media type Meta would classify a MIME type as (webp → sticker, unknown → document). */
export function mediaTypeForMime(mime: string): MediaType {
  const base = (mime.split(";")[0] ?? "").trim().toLowerCase();
  if (base === "image/webp") return "sticker";
  if (base.startsWith("image/")) return "image";
  if (base.startsWith("audio/")) return "audio";
  if (base.startsWith("video/")) return "video";
  return "document";
}

function invalidResponse(
  status: number,
  message: string,
  secrets: string | readonly string[],
): MetaApiError {
  return new MetaApiError({
    status,
    metaCode: null,
    message,
    secrets: typeof secrets === "string" ? [secrets] : secrets,
  });
}

interface RequestInput {
  method: "GET" | "POST" | "DELETE";
  /** Path below the version (e.g. `123/messages`) or an absolute URL. */
  target: string;
  query?: Record<string, string>;
  json?: unknown;
  form?: FormData;
}

export function createGraphClient(options: GraphClientOptions = {}): GraphClient {
  const rawVersion = options.version ?? GRAPH_API_VERSION;
  const version = rawVersion.startsWith("v") ? rawVersion : `v${rawVersion}`;
  const baseUrl = (options.baseUrl ?? GRAPH_API_BASE_URL).replace(/\/+$/, "");

  const loggerFor = (secrets: readonly string[]): RedactingLogger =>
    createRedactingLogger(options.logger, () => secrets);

  const urlFor = (target: string, query?: Record<string, string>): string => {
    const url = /^https?:\/\//i.test(target)
      ? new URL(target)
      : new URL(`${baseUrl}/${version}/${target}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    return url.toString();
  };

  const segment = (field: string, value: string): string => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`${field} must be a non-empty string`);
    }
    return encodeURIComponent(value);
  };

  /**
   * Performs the call; throws `MetaApiError` on network failure or non-2xx. `token` (when
   * set) is sent as the bearer token; it and `extraSecrets` are redacted everywhere.
   */
  async function send(
    token: string | null,
    input: RequestInput,
    extraSecrets: readonly string[] = [],
  ): Promise<Response> {
    const secretList = [...(token === null ? [] : [token]), ...extraSecrets].filter(
      (value) => value !== "",
    );
    const log = loggerFor(secretList);
    const url = urlFor(input.target, input.query);
    const headers = new Headers();
    if (token !== null) headers.set("Authorization", `Bearer ${token}`);
    let body: RequestInit["body"];
    if (input.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(input.json);
    } else if (input.form !== undefined) {
      body = input.form;
    }
    const doFetch = options.fetch ?? globalThis.fetch;
    log.debug("[sendo] graph request", { method: input.method, url });
    let response: Response;
    try {
      response = await doFetch(url, { method: input.method, headers, body });
    } catch (err) {
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const safe = redactText(reason, secretList);
      log.warn("[sendo] graph network error", { method: input.method, url, error: safe });
      throw new MetaApiError(
        {
          status: 0,
          metaCode: null,
          type: "NetworkError",
          message: `Network error calling Graph API: ${safe}`,
          secrets: secretList,
        },
        { cause: new Error(safe) },
      );
    }
    log.debug("[sendo] graph response", { method: input.method, url, status: response.status });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: { message: text.slice(0, 500) || `HTTP ${response.status}` } };
      }
      const error = MetaApiError.fromResponse(response.status, parsed, { secrets: secretList });
      log.warn("[sendo] graph error", { method: input.method, url, error: error.toJSON() });
      throw error;
    }
    return response;
  }

  async function requestJson(
    token: string | null,
    input: RequestInput,
    extraSecrets: readonly string[] = [],
  ): Promise<Record<string, unknown>> {
    const response = await send(token, input, extraSecrets);
    const secretList = [...(token === null ? [] : [token]), ...extraSecrets];
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw invalidResponse(response.status, "Graph API returned invalid JSON", secretList);
    }
    if (!isRecord(data)) {
      throw invalidResponse(response.status, "Graph API returned an unexpected body", secretList);
    }
    return data;
  }

  return {
    version,
    baseUrl,

    async sendMessage(token, phoneNumberId, payload) {
      const data = await requestJson(token, {
        method: "POST",
        target: `${segment("phoneNumberId", phoneNumberId)}/messages`,
        json: payload,
      });
      const first = Array.isArray(data.messages) ? (data.messages[0] as unknown) : undefined;
      const id = isRecord(first) ? str(first.id) : null;
      if (id === null) throw invalidResponse(200, "Graph API response has no message id", token);
      return { metaMessageId: id };
    },

    async getMediaUrl(token, mediaId) {
      const data = await requestJson(token, {
        method: "GET",
        target: segment("mediaId", mediaId),
      });
      const url = str(data.url);
      if (url === null) throw invalidResponse(200, "Graph API media response has no url", token);
      return {
        url,
        mimeType: str(data.mime_type) ?? "application/octet-stream",
        sha256: str(data.sha256),
        fileSize: num(data.file_size),
      };
    },

    async downloadMedia(token, url) {
      if (!/^https?:\/\//i.test(url)) throw new TypeError("downloadMedia needs an absolute URL");
      const response = await send(token, { method: "GET", target: url });
      return new Uint8Array(await response.arrayBuffer());
    },

    async uploadMedia(token, phoneNumberId, file, mime, opts) {
      const { filename, mediaType } =
        typeof opts === "string" ? { filename: opts, mediaType: undefined } : (opts ?? {});
      const size = file instanceof Blob ? file.size : file.byteLength;
      assertMediaAcceptable(mediaType ?? mediaTypeForMime(mime), size, mime);
      const blob = file instanceof Blob ? file : new Blob([new Uint8Array(file)], { type: mime });
      const form = new FormData();
      form.set("messaging_product", "whatsapp");
      form.set("type", mime);
      form.set("file", blob, filename ?? "file");
      const data = await requestJson(token, {
        method: "POST",
        target: `${segment("phoneNumberId", phoneNumberId)}/media`,
        form,
      });
      const id = str(data.id);
      if (id === null) throw invalidResponse(200, "Graph API upload response has no id", token);
      return { mediaId: id };
    },

    async listTemplates(token, wabaId) {
      const templates: MetaTemplate[] = [];
      const visited = new Set<string>();
      let input: RequestInput | null = {
        method: "GET",
        target: `${segment("wabaId", wabaId)}/message_templates`,
        query: { fields: TEMPLATE_FIELDS, limit: "100" },
      };
      for (let page = 0; input !== null && page < MAX_PAGES; page++) {
        const data = await requestJson(token, input);
        for (const item of Array.isArray(data.data) ? (data.data as unknown[]) : []) {
          const template = toTemplate(item);
          if (template !== null) templates.push(template);
        }
        const next = isRecord(data.paging) ? str(data.paging.next) : null;
        if (next === null || visited.has(next)) {
          input = null;
        } else {
          visited.add(next);
          input = { method: "GET", target: next };
        }
      }
      return templates;
    },

    async getPhoneNumber(token, phoneNumberId) {
      const data = await requestJson(token, {
        method: "GET",
        target: segment("phoneNumberId", phoneNumberId),
        query: { fields: PHONE_FIELDS },
      });
      return {
        id: str(data.id) ?? phoneNumberId,
        displayPhoneNumber: str(data.display_phone_number),
        verifiedName: str(data.verified_name),
        qualityRating: str(data.quality_rating),
        codeVerificationStatus: str(data.code_verification_status),
        nameStatus: str(data.name_status),
        platformType: str(data.platform_type),
        throughputLevel: isRecord(data.throughput) ? str(data.throughput.level) : null,
      };
    },

    async getSubscribedApps(token, wabaId) {
      const data = await requestJson(token, {
        method: "GET",
        target: `${segment("wabaId", wabaId)}/subscribed_apps`,
      });
      const items = Array.isArray(data.data) ? (data.data as unknown[]) : [];
      return items.filter(isRecord).map((item) => {
        const app = isRecord(item.whatsapp_business_api_data)
          ? item.whatsapp_business_api_data
          : item;
        return { id: str(app.id), name: str(app.name), link: str(app.link) };
      });
    },

    async unsubscribeApp(token, wabaId) {
      await requestJson(token, {
        method: "DELETE",
        target: `${segment("wabaId", wabaId)}/subscribed_apps`,
      });
    },

    async exchangeCode({ appId, appSecret, code }) {
      const data = await requestJson(
        null,
        {
          method: "GET",
          target: "oauth/access_token",
          query: {
            client_id: segment("appId", appId),
            client_secret: appSecret,
            code: segment("code", code),
          },
        },
        [appSecret, code],
      );
      const token = str(data.access_token);
      if (token === null || token.trim() === "") {
        throw invalidResponse(200, "Graph API code exchange returned no access token", [
          appSecret,
          code,
        ]);
      }
      return token;
    },

    async subscribeApp(token, wabaId) {
      await requestJson(token, {
        method: "POST",
        target: `${segment("wabaId", wabaId)}/subscribed_apps`,
      });
    },

    async registerPhone(token, phoneNumberId, pin) {
      await requestJson(
        token,
        {
          method: "POST",
          target: `${segment("phoneNumberId", phoneNumberId)}/register`,
          json: { messaging_product: "whatsapp", pin },
        },
        [pin],
      );
    },

    async getWaba(token, wabaId, fields) {
      return requestJson(token, {
        method: "GET",
        target: segment("wabaId", wabaId),
        query: { fields: fields.join(",") },
      });
    },

    async markRead(token, phoneNumberId, metaMessageId) {
      if (metaMessageId.trim() === "") throw new TypeError("metaMessageId must be non-empty");
      await requestJson(token, {
        method: "POST",
        target: `${segment("phoneNumberId", phoneNumberId)}/messages`,
        json: { messaging_product: "whatsapp", status: "read", message_id: metaMessageId },
      });
    },
  };
}

function toTemplate(item: unknown): MetaTemplate | null {
  if (!isRecord(item)) return null;
  const name = str(item.name);
  const language = str(item.language);
  if (name === null || language === null) return null;
  const components = Array.isArray(item.components)
    ? (item.components as unknown[]).filter(
        (c): c is MetaTemplateComponent => isRecord(c) && typeof c.type === "string",
      )
    : [];
  const template: MetaTemplate = {
    id: str(item.id) ?? `${name}:${language}`,
    name,
    language,
    status: str(item.status) ?? "PENDING",
    category: str(item.category) ?? "UTILITY",
    components,
  };
  const parameterFormat = str(item.parameter_format);
  if (parameterFormat !== null) template.parameter_format = parameterFormat;
  return template;
}
