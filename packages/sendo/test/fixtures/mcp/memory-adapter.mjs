// `--config` fixture for the `sendo mcp` E2E: an empty memory adapter from the built package, so
// run_doctor runs every storage check without Supabase and fails only `accounts` (no numbers).
import { memoryAdapter } from "../../../dist/adapters/memory/index.js";

export const adapter = memoryAdapter();
