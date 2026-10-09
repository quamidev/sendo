import type { SendoAdapter } from "@quami/sendo";

type Method = (...args: unknown[]) => unknown;

function gate<T extends object>(namespace: T, ready: Promise<unknown>): T {
  return new Proxy(namespace, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      const method = value as Method;
      return async (...args: unknown[]) => {
        await ready;
        return method.apply(target, args);
      };
    },
  });
}

/** Every adapter call waits for `ready` (the fixtures seed) before running. */
export function gatedAdapter(adapter: SendoAdapter, ready: Promise<unknown>): SendoAdapter {
  return {
    accounts: gate(adapter.accounts, ready),
    contacts: gate(adapter.contacts, ready),
    conversations: gate(adapter.conversations, ready),
    messages: gate(adapter.messages, ready),
    media: gate(adapter.media, ready),
    templates: gate(adapter.templates, ready),
    events: gate(adapter.events, ready),
    locks: gate(adapter.locks, ready),
    storage: gate(adapter.storage, ready),
    schemaVersion: async () => {
      await ready;
      return adapter.schemaVersion();
    },
    healthCheck: async () => {
      await ready;
      return adapter.healthCheck();
    },
  };
}
