import { afterEach, describe } from "vitest";
import type { SendoAdapter } from "../types";
import { accountsContract } from "./accounts";
import { broadcastsContract } from "./broadcasts";
import { contactsContract } from "./contacts";
import { conversationQueriesContract } from "./conversation-queries";
import { conversationsContract } from "./conversations";
import { mediaContract } from "./media";
import { mediaStoreContract, type MakeMediaStore } from "./media-store";
import { messagesContract } from "./messages";
import { rulesContract } from "./rules";
import { snippetsContract } from "./snippets";
import { systemContract } from "./system";
import { tagsContract } from "./tags";
import { templatesContract } from "./templates";

export type MakeAdapter = () => Promise<SendoAdapter> | SendoAdapter;

export interface AdapterContractOptions {
  /** `true` or a reason string skips the whole suite (e.g. the backing service is unreachable). */
  skip?: boolean | string;
  /** Runs after every test, e.g. to truncate tables. */
  afterEach?: () => Promise<void>;
}

/**
 * Executable spec for `SendoAdapter`. Every adapter must pass it.
 *
 * `makeAdapter` is called once per test and must return an isolated adapter. The suite
 * scopes reads by unique tenant/account ids, so a shared database works as long as
 * each test's rows do not collide; use `afterEach` to clean up.
 *
 * One module per domain (`./accounts`, `./contacts`, ...); add new domains as new modules.
 */
export function runAdapterContract(
  name: string,
  makeAdapter: MakeAdapter,
  options: AdapterContractOptions = {},
): void {
  const skip = options.skip ?? false;
  const title =
    typeof skip === "string"
      ? `adapter contract: ${name} (skipped: ${skip})`
      : `adapter contract: ${name}`;

  describe.skipIf(skip !== false)(title, () => {
    const cleanup = options.afterEach;
    if (cleanup) afterEach(cleanup);

    const fresh = async (): Promise<SendoAdapter> => makeAdapter();

    accountsContract(fresh);
    contactsContract(fresh);
    conversationsContract(fresh);
    conversationQueriesContract(fresh);
    messagesContract(fresh);
    mediaContract(fresh);
    templatesContract(fresh);
    snippetsContract(fresh);
    tagsContract(fresh);
    rulesContract(fresh);
    broadcastsContract(fresh);
    systemContract(fresh);
  });
}

export type { MakeMediaStore } from "./media-store";

/**
 * Executable spec for a `MediaStore` (put/get, signed URL, delete, `exists`). `runAdapterContract`
 * runs it on the adapter's default `storage`; run it on your own store too.
 */
export function runMediaStoreContract(
  name: string,
  makeStore: MakeMediaStore,
  options: AdapterContractOptions = {},
): void {
  const skip = options.skip ?? false;
  const title =
    typeof skip === "string"
      ? `media store contract: ${name} (skipped: ${skip})`
      : `media store contract: ${name}`;
  describe.skipIf(skip !== false)(title, () => {
    const cleanup = options.afterEach;
    if (cleanup) afterEach(cleanup);
    mediaStoreContract(makeStore);
  });
}
