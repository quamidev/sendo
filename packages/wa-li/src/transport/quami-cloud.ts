import { NotImplementedError } from "../errors/errors";
import type { Transport } from "./types";

export interface QuamiCloudOptions {
  apiKey: string;
}

/** Reserved for V3: Quami-hosted transport. Every method throws `NotImplementedError`. */
export function quamiCloud(_options: QuamiCloudOptions): Transport {
  const notImplemented = (): never => {
    throw new NotImplementedError("quamiCloud");
  };
  return {
    kind: "quami-cloud",
    send: () => Promise.reject(new NotImplementedError("quamiCloud")),
    fetchMedia: () => Promise.reject(new NotImplementedError("quamiCloud")),
    uploadMedia: () => Promise.reject(new NotImplementedError("quamiCloud")),
    markRead: () => Promise.reject(new NotImplementedError("quamiCloud")),
    handleWebhook: () => Promise.reject(new NotImplementedError("quamiCloud")),
    subscribe: notImplemented,
  };
}
