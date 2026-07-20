import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  readNativeProductionEnvironmentFiles,
  validateNativeGuestBuildInputs,
} from "./native-guest-boundary.mjs";

assert.deepEqual(
  validateNativeGuestBuildInputs(process.env, readNativeProductionEnvironmentFiles()),
  [],
  "hosted native configuration requires reviewed store disclosures before Google Play packaging",
);

execFileSync(resolve("node_modules/.bin/tauri"), [
  "android",
  "build",
  "--ci",
  "--target", "aarch64",
  "--apk",
  "--aab",
], {
  env: { ...process.env, LANG: "C", LC_ALL: "C" },
  stdio: "inherit",
});
