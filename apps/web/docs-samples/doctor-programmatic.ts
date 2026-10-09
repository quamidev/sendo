// #region programmatic
import { createGraphClient, doctorExitCode, runDoctor } from "@quami/wa-li";
import { memoryAdapter } from "@quami/wa-li/adapters/memory";

// The CLI is a thin wrapper: run the same checks from a test or a health endpoint.
const results = await runDoctor({
  env: process.env,
  adapter: memoryAdapter(), // or supabaseAdapter(...); null when it can't be built
  graph: createGraphClient(),
  url: "https://example.com/api/whatsapp",
});
for (const { id, ok, detail, hint } of results) {
  console.log(ok ? "✓" : "✗", id, detail, hint ?? "");
}
process.exitCode = doctorExitCode(results); // 0 or 1
// #endregion programmatic
