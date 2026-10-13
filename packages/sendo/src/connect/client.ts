import { redactText } from "../utils/redact";
import type { ResolvedConnectConfig } from "./config";
import { CONNECT_ERROR_CODES } from "./contract";

/** Signup steps Connect runs on Meta and may name in an error (`error.step`). */
export const CONNECT_SIGNUP_STEPS = [
  "exchange_code",
  "subscribe_app",
  "register_phone",
  "read_phone",
] as const;
export type ConnectSignupStep = (typeof CONNECT_SIGNUP_STEPS)[number];

/** Body of `POST /v1/signup/complete`. */
export interface ConnectSignupRequest {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  coexistence: boolean;
  /** Two-step PIN for `register`; `null` for coexistence (no register). */
  pin: string | null;
}

/** 200 body of `POST /v1/signup/complete`. Connect never stores `token`. */
export interface ConnectSignupResult {
  token: string;
  displayPhone: string | null;
}

/** 200 body of `GET /v1/projects/current/webhook`. */
export interface ConnectWebhookStatus {
  projectId: string | null;
  /** The URL the relay forwards to; `null` until it is set in the Connect panel. */
  url: string | null;
  /** The relay's most recent delivery attempt to `url`, if any. */
  lastDelivery: { at: Date; statusCode: number | null } | null;
}

/**
 * A failed Connect call, parsed from Connect's error envelope
 * (`{ error: { code, message, step?, metaCode?, subcode?, fbtraceId? } }`). `status` is 0 when
 * Connect could not be reached; `errorCode` is `error.code` (see `CONNECT_ERROR_CODES`).
 * Messages are redacted. Package APIs map it to `ConfigError` / `EmbeddedSignupError`.
 */
export class ConnectRequestError extends Error {
  readonly status: number;
  readonly errorCode: string | null;
  readonly step: ConnectSignupStep | null;
  readonly metaCode: number | null;
  readonly subcode: number | null;
  readonly fbtraceId: string | null;

  constructor(params: {
    status: number;
    message: string;
    errorCode?: string | null;
    step?: ConnectSignupStep | null;
    metaCode?: number | null;
    subcode?: number | null;
    fbtraceId?: string | null;
  }) {
    super(params.message);
    this.name = "ConnectRequestError";
    this.status = params.status;
    this.errorCode = params.errorCode ?? null;
    this.step = params.step ?? null;
    this.metaCode = params.metaCode ?? null;
    this.subcode = params.subcode ?? null;
    this.fbtraceId = params.fbtraceId ?? null;
  }

  /**
   * Connect rejected the API key. A 403 naming a Meta step is Meta's permission error, and a
   * 403 `PROJECT_SUSPENDED` is `isProjectSuspended`, not a bad key.
   */
  get isUnauthorized(): boolean {
    return (
      this.status === 401 || (this.status === 403 && this.step === null && !this.isProjectSuspended)
    );
  }

  /** 403 `PROJECT_SUSPENDED`: the key is valid but the Connect project is suspended (billing). */
  get isProjectSuspended(): boolean {
    return this.status === 403 && this.errorCode === CONNECT_ERROR_CODES.projectSuspended;
  }
}

export interface ConnectClient {
  completeSignup(input: ConnectSignupRequest): Promise<ConnectSignupResult>;
  getWebhook(): Promise<ConnectWebhookStatus>;
  /**
   * `POST /v1/numbers/{phoneNumberId}/disconnect`: tells Connect the number was disconnected, so
   * it stops relaying and billing it. 200 `{ "ok": true }`; 404 `NUMBER_NOT_FOUND`; 403
   * `PROJECT_SUSPENDED`. Errors are `ConnectRequestError`.
   */
  disconnectNumber(phoneNumberId: string): Promise<void>;
}

export interface ConnectClientOptions {
  config: Pick<ResolvedConnectConfig, "apiKey" | "baseUrl">;
  fetch?: typeof fetch;
  /** Extra values to redact from error messages (code, PIN). */
  secrets?: readonly string[];
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stepOf(value: unknown): ConnectSignupStep | null {
  return CONNECT_SIGNUP_STEPS.find((step) => step === value) ?? null;
}

/** Talks to the Sendo Connect API with `Authorization: Bearer <apiKey>`. */
export function createConnectClient(options: ConnectClientOptions): ConnectClient {
  const { apiKey, baseUrl } = options.config;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request(
    method: "GET" | "POST",
    path: string,
    json: unknown,
    secrets: readonly string[],
  ): Promise<Record<string, unknown>> {
    const redact = (text: string) => redactText(text, [apiKey, ...secrets]);
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
          ...(json !== undefined && { "content-type": "application/json" }),
        },
        ...(json !== undefined && { body: JSON.stringify(json) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ConnectRequestError({
        status: 0,
        message: redact(`Could not reach Sendo Connect at ${baseUrl}: ${reason}`),
      });
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const error = isRecord(body) && isRecord(body.error) ? body.error : {};
      throw new ConnectRequestError({
        status: response.status,
        message: redact(
          `Sendo Connect ${method} ${path} answered ${String(response.status)}: ${str(error.message) ?? "no error message"}`,
        ),
        errorCode: str(error.code),
        step: stepOf(error.step),
        metaCode: num(error.metaCode),
        subcode: num(error.subcode),
        fbtraceId: str(error.fbtraceId),
      });
    }
    if (!isRecord(body)) {
      throw new ConnectRequestError({
        status: response.status,
        message: `Sendo Connect ${method} ${path} answered ${String(response.status)} without a JSON object.`,
      });
    }
    return body;
  }

  return {
    async completeSignup(input) {
      const body = await request("POST", "/v1/signup/complete", input, [
        input.code,
        ...(input.pin === null ? [] : [input.pin]),
        ...(options.secrets ?? []),
      ]);
      const token = str(body.token);
      if (token === null) {
        throw new ConnectRequestError({
          status: 200,
          message: "Sendo Connect completed the signup but returned no token.",
        });
      }
      return { token, displayPhone: str(body.displayPhone) };
    },

    async getWebhook() {
      const body = await request("GET", "/v1/projects/current/webhook", undefined, []);
      const delivery = isRecord(body.lastDelivery) ? body.lastDelivery : null;
      const at = delivery === null ? null : str(delivery.at);
      const date = at === null ? null : new Date(at);
      return {
        projectId: str(body.projectId),
        url: str(body.url),
        lastDelivery:
          delivery === null || date === null || Number.isNaN(date.getTime())
            ? null
            : { at: date, statusCode: num(delivery.statusCode) },
      };
    },

    async disconnectNumber(phoneNumberId) {
      await request(
        "POST",
        `/v1/numbers/${encodeURIComponent(phoneNumberId)}/disconnect`,
        undefined,
        [],
      );
    },
  };
}
