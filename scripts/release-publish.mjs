// Publishes @quami/sendo with npm directly (not `changeset publish`): changesets publishes through
// `pnpm publish`, which hides npm's output and reported 0.1.0 as published when npm never got it.
// Skips when the version is already on npm, because the Release workflow runs on every push to main.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const dir = "packages/sendo";
const { name, version } = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
const spec = `${name}@${version}`;

function onNpm() {
  const result = spawnSync("npm", ["view", spec, "version", "--prefer-online"], {
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim() === version;
}

if (onNpm()) {
  console.log(`release-publish: ${spec} is already on npm, nothing to publish.`);
  process.exit(0);
}

console.log(
  `release-publish: publishing ${spec} with npm ${execFileSync("npm", ["--version"], { encoding: "utf8" }).trim()}`,
);
const publish = spawnSync("npm", ["publish", `./${dir}`, "--access", "public"], {
  stdio: "inherit",
});
if (publish.error) throw publish.error;
if (publish.status !== 0) process.exit(publish.status ?? 1);

// The registry can take a few seconds to serve a new version.
let visible = false;
for (let attempt = 0; attempt < 12 && !visible; attempt++) {
  if (attempt > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
  visible = onNpm();
}
if (!visible) {
  console.error(
    `release-publish: npm exited 0 but ${spec} is not on the registry yet. Check the npm package page.`,
  );
  process.exit(1);
}
console.log(`release-publish: ${spec} is on npm.`);
