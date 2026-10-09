// my-adapter.contract.test.ts (run with Vitest)
import { runAdapterContract } from "@quami/sendo/adapters/contract";
import type { SendoAdapter } from "@quami/sendo";

declare function createMyAdapter(): Promise<SendoAdapter>;
declare function truncateTables(): Promise<void>;
declare const databaseReachable: boolean;

runAdapterContract("my-adapter", () => createMyAdapter(), {
  skip: databaseReachable ? false : "database unreachable",
  afterEach: truncateTables,
});
