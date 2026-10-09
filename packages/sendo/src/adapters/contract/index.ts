import { afterEach, describe } from "vitest";
import type { SendoAdapter } from "../types";
import { accountsContract } from "./accounts";
import { contactsContract } from "./contacts";
import { conversationsContract } from "./conversations";
import { mediaContract } from "./media";
import { messagesContract } from "./messages";
import { systemContract } from "./system";
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
    messagesContract(fresh);
    mediaContract(fresh);
    templatesContract(fresh);
    systemContract(fresh);
  });
}
