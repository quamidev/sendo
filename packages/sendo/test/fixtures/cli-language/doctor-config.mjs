// `--config` module for `sendo doctor` in the CLI language guard: a memory adapter from the BUILT
// package, shaped by the scenario in `SENDO_LANG_SCENARIO` (see scenarios.mjs).
import { memoryAdapter } from "../../../dist/adapters/memory/index.js";
import { PHONE_NUMBER_ID, WABA_ID, currentScenario } from "./scenarios.mjs";

const scenario = currentScenario();
const base = memoryAdapter(scenario.memory ?? {});
if (scenario.noAccount !== true) {
  await base.accounts.insert({
    tenantId: null,
    label: "Ana López",
    phoneNumberId: PHONE_NUMBER_ID,
    wabaId: WABA_ID,
    displayPhone: "+1 555-000-1111",
    tokenRef: "SENDO_TOKEN_MAIN",
    ...scenario.account,
  });
}

function fail() {
  return Promise.reject(new Error("connection refused by the test database"));
}

function shaped() {
  if (scenario.broken === true) {
    return {
      ...base,
      accounts: { ...base.accounts, list: fail },
      healthCheck: fail,
      schemaVersion: fail,
      storage: { ...base.storage, exists: fail },
    };
  }
  if (scenario.media === "none") return { ...base, storage: undefined };
  return base;
}

const store = {
  put: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  signedUrl: () => Promise.resolve("https://media.example.com/x"),
  delete: () => Promise.resolve(),
};

function mediaStore() {
  if (scenario.media === "missing-bucket")
    return { ...store, exists: () => Promise.resolve(false) };
  if (scenario.media === "no-exists") return store;
  if (scenario.media === "invalid") return { put: "nope" };
  return undefined;
}

export const adapter = shaped();
export const media = mediaStore();
