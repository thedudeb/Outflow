import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { validateNativeGuestBuildInputs } from "./native-guest-boundary.mjs";

assert.equal(process.platform, "darwin", "iOS release artifacts must be built on macOS");

const buildNumber = String(process.env.OUTFLOW_IOS_BUILD_NUMBER || "").trim();
assert.match(buildNumber, /^[1-9][0-9]{0,17}$/, "OUTFLOW_IOS_BUILD_NUMBER must be a positive, bounded numeric build number");

const viteEnvironmentFiles = [".env", ".env.local", ".env.production", ".env.production.local"]
  .filter((path) => existsSync(resolve(path)))
  .map((path) => readFileSync(resolve(path), "utf8"));
assert.deepEqual(
  validateNativeGuestBuildInputs(process.env, viteEnvironmentFiles),
  [],
  "hosted native configuration requires reviewed privacy artifacts before App Store packaging",
);

const tauri = resolve("node_modules/.bin/tauri");
const ipaPath = resolve(process.env.OUTFLOW_IOS_RELEASE_IPA_PATH || "src-tauri/gen/apple/build/arm64/Outflow.ipa");
rmSync(ipaPath, { force: true });

execFileSync(tauri, [
  "ios",
  "build",
  "--ci",
  "--target", "aarch64",
  "--export-method", "app-store-connect",
  "--build-number", buildNumber,
], {
  env: { ...process.env, LANG: "C", LC_ALL: "C" },
  stdio: "inherit",
});

assert.equal(existsSync(ipaPath), true, `Outflow App Store Connect IPA is missing at ${ipaPath}`);
console.log(`Built the Outflow App Store Connect release candidate at ${ipaPath}`);
