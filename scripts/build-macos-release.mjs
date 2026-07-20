import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

assert.equal(process.platform, "darwin", "macOS release artifacts must be built on macOS");

const tauriConfig = JSON.parse(readFileSync(resolve("src-tauri/tauri.conf.json"), "utf8"));
assert.match(tauriConfig.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, "Tauri release version must be semver");
assert.match(tauriConfig.productName, /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/, "Tauri product name is invalid");

const tauri = resolve("node_modules/.bin/tauri");
const appPath = resolve(`src-tauri/target/release/bundle/macos/${tauriConfig.productName}.app`);
const architecture = process.arch === "arm64" ? "aarch64" : process.arch;
assert.match(architecture, /^(?:aarch64|x64)$/, `unsupported macOS release architecture: ${architecture}`);
const outputDirectory = resolve("src-tauri/target/release/bundle/macos-release");
const archivePath = resolve(outputDirectory, `${tauriConfig.productName}_${tauriConfig.version}_${architecture}.zip`);
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
