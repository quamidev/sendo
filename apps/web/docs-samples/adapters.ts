// #region memory
import { createSendo } from "@quami/sendo";
import { memoryAdapter } from "@quami/sendo/adapters/memory";

// In-memory storage for unit tests and quick experiments. Nothing is persisted.
const adapter = memoryAdapter({ now: () => new Date("2026-10-06T12:00:00Z") });

const sendo = createSendo({
  adapter,
  appSecret: "test-secret",
  verifyToken: "test-verify",
  resolveToken: () => "test-token",
});

await adapter.accounts.insert({
  phoneNumberId: "100000000000001",
  wabaId: "200000000000001",
  displayPhone: "+1 555 000 1111",
  tokenRef: "SENDO_TOKEN_MAIN",
});
adapter.reset(); // clears every table between tests
// #endregion memory

export { sendo };
