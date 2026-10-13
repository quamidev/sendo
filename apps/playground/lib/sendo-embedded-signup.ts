export const FACEBOOK_SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
/** `extras.featureType` for numbers kept in the WhatsApp Business app (coexistence). */
export const COEXISTENCE_FEATURE_TYPE = "whatsapp_business_app_onboarding";
const SESSION_INFO_VERSION = "3";
const SESSION_INFO_TIMEOUT_MS = 10_000;

export interface FacebookLoginResponse {
  authResponse?: { code?: string | null } | null;
  status?: string;
}

export interface FacebookLoginOptions {
  config_id: string;
  response_type: "code";
  override_default_response_type: true;
  extras: { setup: Record<string, never>; sessionInfoVersion: string; featureType?: string };
}

/** The part of the Facebook JS SDK Embedded Signup uses. */
export interface FacebookSdk {
  init(params: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: FacebookLoginResponse) => void, options: FacebookLoginOptions): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

export interface LoadFacebookSdkOptions {
  appId: string;
  /** Graph API version, e.g. `v26.0`. */
  version: string;
  sdkUrl?: string;
}

let sdkPromise: Promise<FacebookSdk> | null = null;
let initializedAppId: string | null = null;

function initSdk(sdk: FacebookSdk, options: LoadFacebookSdkOptions): FacebookSdk {
  if (initializedAppId !== options.appId) {
    sdk.init({
      appId: options.appId,
      autoLogAppEvents: true,
      xfbml: false,
      version: options.version,
    });
    initializedAppId = options.appId;
  }
  return sdk;
}

/** Loads (once) and initializes the Facebook JS SDK. Rejects when the script can't load. */
export function loadFacebookSdk(options: LoadFacebookSdkOptions): Promise<FacebookSdk> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("The Facebook SDK only loads in the browser."));
  }
  if (window.FB !== undefined) return Promise.resolve(initSdk(window.FB, options));
  sdkPromise ??= new Promise<FacebookSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      if (window.FB === undefined) reject(new Error("The Facebook SDK did not define FB."));
      else resolve(window.FB);
    };
    const script = document.createElement("script");
    script.src = options.sdkUrl ?? FACEBOOK_SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdkPromise = null;
      script.remove();
      reject(new Error("Could not load the Facebook SDK."));
    };
    document.body.appendChild(script);
  });
  return sdkPromise.then((sdk) => initSdk(sdk, options));
}

export type EmbeddedSignupOutcome =
  | {
      status: "finish";
      code: string;
      wabaId: string;
      phoneNumberId: string;
      /** Meta finished the WhatsApp Business app (coexistence) flavour. */
      coexistence: boolean;
    }
  | { status: "cancel"; step: string | null }
  | { status: "error"; reason: "meta" | "no_number" | "no_session"; message: string | null };

export interface LaunchEmbeddedSignupOptions {
  configId: string;
  coexistence?: boolean;
  /** Extra trusted origins (`"self"` = this page's origin). Meta's are always trusted. */
  trustedOrigins?: string[];
  /** How long to wait for the session info after the code arrives. Default 10 s. */
  sessionInfoTimeoutMs?: number;
}

/** Only Meta (https://*.facebook.com) may post session info, plus explicitly trusted origins. */
export function isTrustedOrigin(origin: string, extra: readonly string[] = []): boolean {
  if (
    extra.some((entry) => (entry === "self" ? origin === window.location.origin : entry === origin))
  ) {
    return true;
  }
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"))
    );
  } catch {
    return false;
  }
}

interface SessionMessage {
  event: string;
  data: Record<string, unknown>;
}

function parseSessionMessage(raw: unknown): SessionMessage | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== "WA_EMBEDDED_SIGNUP" || typeof record.event !== "string") return null;
  const data =
    typeof record.data === "object" && record.data !== null
      ? (record.data as Record<string, unknown>)
      : {};
  return { event: record.event, data };
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

/**
 * Opens Embedded Signup. Call it synchronously from a click (or submit) handler: `FB.login`
 * runs inside, and browsers block popups opened later. Resolves once Meta returned both the
 * code and the session info, or when the admin cancels or Meta reports an error.
 */
export function launchEmbeddedSignup(
  sdk: FacebookSdk,
  options: LaunchEmbeddedSignupOptions,
): Promise<EmbeddedSignupOutcome> {
  return new Promise<EmbeddedSignupOutcome>((resolve) => {
    let settled = false;
    let code: string | null = null;
    let session: { wabaId: string; phoneNumberId: string; coexistence: boolean } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (outcome: EmbeddedSignupOutcome) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      if (timer !== undefined) clearTimeout(timer);
      resolve(outcome);
    };
    const tryFinish = () => {
      if (code !== null && session !== null) settle({ status: "finish", code, ...session });
    };

    function onMessage(event: MessageEvent) {
      if (!isTrustedOrigin(event.origin, options.trustedOrigins)) return;
      const message = parseSessionMessage(event.data);
      if (message === null) return;
      if (message.event === "CANCEL") {
        const errorMessage = text(message.data.error_message);
        settle(
          errorMessage === null
            ? { status: "cancel", step: text(message.data.current_step) }
            : { status: "error", reason: "meta", message: errorMessage },
        );
        return;
      }
      if (message.event === "ERROR") {
        settle({ status: "error", reason: "meta", message: text(message.data.error_message) });
        return;
      }
      if (message.event.startsWith("FINISH")) {
        const wabaId = text(message.data.waba_id);
        const phoneNumberId = text(message.data.phone_number_id);
        if (wabaId === null || phoneNumberId === null) {
          settle({ status: "error", reason: "no_number", message: null });
          return;
        }
        session = {
          wabaId,
          phoneNumberId,
          coexistence:
            options.coexistence === true ||
            message.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
        };
        tryFinish();
      }
    }

    window.addEventListener("message", onMessage);
    // The SDK rejects async callbacks: keep this a plain function.
    sdk.login(
      (response) => {
        const received = text(response.authResponse?.code);
        if (received === null) {
          settle({ status: "cancel", step: null });
          return;
        }
        code = received;
        tryFinish();
        if (!settled) {
          timer = setTimeout(() => {
            settle({ status: "error", reason: "no_session", message: null });
          }, options.sessionInfoTimeoutMs ?? SESSION_INFO_TIMEOUT_MS);
        }
      },
      {
        config_id: options.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          sessionInfoVersion: SESSION_INFO_VERSION,
          ...(options.coexistence === true && { featureType: COEXISTENCE_FEATURE_TYPE }),
        },
      },
    );
  });
}
