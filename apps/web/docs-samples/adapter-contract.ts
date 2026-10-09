// my-adapter.contract.test.ts (run with Vitest)
import { runAdapterContract } from "@quami/wa-li/adapters/contract";
import type { WhatsAppAdapter } from "@quami/wa-li";

declare function createMyAdapter(): Promise<WhatsAppAdapter>;
declare function truncateTables(): Promise<void>;
declare const databaseReachable: boolean;

runAdapterContract("my-adapter", () => createMyAdapter(), {
  skip: databaseReachable ? false : "database unreachable",
  afterEach: truncateTables,
});
