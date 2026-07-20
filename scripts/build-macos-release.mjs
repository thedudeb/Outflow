import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

assert.equal(process.platform, "darwin", "macOS release artifacts must be built on macOS");

const tauri = resolve("node_modules/.bin/tauri");
const appPath = resolve("src-tauri/target/release/bundle/macos/Outflow.app");
const architecture = process.arch === "arm64" ? "aarch64" : process.arch;
const outputDirectory = resolve("src-tauri/target/release/bundle/macos-release");
const archivePath = resolve(outputDirectory, `Outflow_0.1.0_${architecture}.zip`);
const buildEnvironment = {
  ...process.env,
  LANG: "C",
  LC_ALL: "C",
};

execFileSync(tauri, ["build", "--ci", "--bundles", "app"], {
  env: buildEnvironment,
  stdio: "inherit",
});
assert.equal(existsSync(appPath), true, `Outflow app is missing at ${appPath}`);

mkdirSync(outputDirectory, { recursive: true });
rmSync(archivePath, { force: true });
execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archivePath], {
  env: buildEnvironment,
  stdio: "inherit",
});

console.log(`Built the Outflow macOS release-readiness app and archive at ${outputDirectory}`);
