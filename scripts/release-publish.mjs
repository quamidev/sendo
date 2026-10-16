// Publishes @quami/sendo with npm directly, with npm's output in the workflow log, and skips a
// version that is already on npm (the Release workflow runs on every push to main).
//
// npm's CDN can serve a stale packument for several minutes after a publish (`npm view` 404s on a
// version that was just published), so the registry is read with a cache-busting query, and a
// version that doesn't show up yet after a successful `npm publish` is a warning, not a failure.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const dir = "packages/sendo";
const { name, version } = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
const spec = `${name}@${version}`;

async function onNpm() {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2f")}?t=${String(Date.now())}`;
  const response = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`release-publish: ${url} answered ${String(response.status)}`);
  const packument = /** @type {{ versions?: Record<string, unknown> }} */ (await response.json());
  return Object.hasOwn(packument.versions ?? {}, version);
}

if (await onNpm()) {
  console.log(`release-publish: ${spec} is already on npm, nothing to publish.`);
  process.exit(0);
}

const npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
console.log(`release-publish: publishing ${spec} with npm ${npmVersion}`);
const publish = spawnSync("npm", ["publish", `./${dir}`, "--access", "public"], {
  stdio: "inherit",
});
if (publish.error) throw publish.error;
if (publish.status !== 0) process.exit(publish.status ?? 1);

let visible = false;
for (let attempt = 0; attempt < 12 && !visible; attempt++) {
  if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 5_000));
  visible = await onNpm();
}
console.log(
  visible
    ? `release-publish: ${spec} is on npm.`
    : `release-publish: npm accepted ${spec} but the registry doesn't list it yet (it can take a few minutes). Check https://www.npmjs.com/package/${name} later.`,
);
