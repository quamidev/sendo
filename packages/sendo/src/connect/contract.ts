/**
 * Values shared by the package and the Sendo Connect service, so neither side can drift. The
 * service imports them from `@quami/sendo`.
 */

/**
 * `error.code` values in Connect's error envelope
 * (`{ error: { code, message, step?, metaCode?, subcode?, fbtraceId? } }`).
 */
export const CONNECT_ERROR_CODES = {
  /** 401: the API key is missing, unknown or revoked. */
  unauthorized: "UNAUTHORIZED",
  /** 403 on every `/v1/*` route of a project suspended for non-payment. */
  projectSuspended: "PROJECT_SUSPENDED",
  /** 404 from `POST /v1/numbers/{phoneNumberId}/disconnect`: the project has no such number. */
  numberNotFound: "NUMBER_NOT_FOUND",
  /** 409 from signup: the number is already active in another Connect project. */
  numberInUse: "NUMBER_IN_USE",
  /** Signup refused while Quami's Meta app awaits Tech Provider approval. */
  earlyAccess: "EARLY_ACCESS",
  /** 400: the request body is missing fields or has the wrong types. */
  invalidRequest: "INVALID_REQUEST",
  /** A signup step failed on Meta (`step`, `metaCode`, `subcode`, `fbtraceId` are set). */
  metaError: "META_ERROR",
  /** 5xx: Connect itself failed. */
  internal: "INTERNAL_ERROR",
} as const;
export type ConnectErrorCode = (typeof CONNECT_ERROR_CODES)[keyof typeof CONNECT_ERROR_CODES];

/**
 * `object` of the synthetic body the Connect panel's "Send test event" signs and relays
 * (`{"object":"sendo_test"}`). With `connect` set, `handleWebhook` answers it 200 and stores
 * and emits nothing.
 */
export const CONNECT_TEST_EVENT_OBJECT = "sendo_test";
