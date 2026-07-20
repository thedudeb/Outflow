import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

assert.equal(process.platform, "darwin", "macOS release artifacts must be built on macOS");

const tauriConfig = JSON.parse(readFileSync(resolve("src-tauri/tauri.conf.json"), "utf8"));
assert.match(tauriConfig.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, "Tauri release version must be semver");
assert.match(tauriConfig.productName, /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/, "Tauri product name is invalid");

const tauri = resolve("node_modules/.bin/tauri");
const target = String(process.env.OUTFLOW_MACOS_TARGET || "").trim();
assert.match(target, /^(?:|universal-apple-darwin)$/, `unsupported macOS release target: ${target}`);
const targetRoot = target ? `src-tauri/target/${target}` : "src-tauri/target";
const bundleDirectory = resolve(`${targetRoot}/release/bundle`);
const appPath = resolve(bundleDirectory, `macos/${tauriConfig.productName}.app`);
const architecture = target === "universal-apple-darwin"
  ? "universal"
  : process.arch === "arm64" ? "aarch64" : process.arch;
assert.match(architecture, /^(?:aarch64|universal|x64)$/, `unsupported macOS release architecture: ${architecture}`);
const outputDirectory = resolve(bundleDirectory, "macos-release");
const archivePath = resolve(outputDirectory, `${tauriConfig.productName}_${tauriConfig.version}_${architecture}.zip`);
const updaterRequired = process.env.OUTFLOW_MACOS_REQUIRE_UPDATER === "true";
const expectedVersion = String(process.env.OUTFLOW_MACOS_EXPECTED_VERSION || "").trim();
const updaterPublicKey = String(process.env.OUTFLOW_UPDATER_PUBLIC_KEY || "").trim();
const updaterPrivateKey = String(process.env.TAURI_SIGNING_PRIVATE_KEY || "").trim();
const updaterPassword = String(process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || "");
let updaterConfigPath = null;
const buildEnvironment = {
  ...process.env,
  LANG: "C",
  LC_ALL: "C",
};

const buildArguments = ["build", "--ci", "--bundles", "app"];
if (target) buildArguments.push("--target", target);
if (updaterRequired) {
  assert.equal(target, "universal-apple-darwin", "production updater releases must use the universal macOS target");
  assert.equal(expectedVersion, tauriConfig.version, "the confirmed release version must match tauri.conf.json");
  assert.ok(updaterPublicKey.length >= 40 && updaterPublicKey.length <= 2_000, "the updater public key is missing or invalid");
  assert.ok(updaterPrivateKey.length >= 40, "the updater private key is required");
  assert.ok(updaterPassword.length >= 16, "the updater private-key password must contain at least 16 characters");
  updaterConfigPath = resolve(tmpdir(), `outflow-tauri-updater-${process.pid}.json`);
  writeFileSync(updaterConfigPath, `${JSON.stringify({
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        pubkey: updaterPublicKey,
        endpoints: ["https://github.com/thedudeb/Outflow/releases/latest/download/latest.json"],
      },
    },
  })}\n`, { mode: 0o600 });
  buildArguments.push("--config", updaterConfigPath);
}

try {
  execFileSync(tauri, buildArguments, {
    env: buildEnvironment,
    stdio: "inherit",
  });
} finally {
  if (updaterConfigPath) rmSync(updaterConfigPath, { force: true });
}
assert.equal(existsSync(appPath), true, `Outflow app is missing at ${appPath}`);
if (updaterRequired) {
  assert.equal(existsSync(resolve(bundleDirectory, `macos/${tauriConfig.productName}.app.tar.gz`)), true, "the macOS updater archive is missing");
  assert.equal(existsSync(resolve(bundleDirectory, `macos/${tauriConfig.productName}.app.tar.gz.sig`)), true, "the macOS updater signature is missing");
}

mkdirSync(outputDirectory, { recursive: true });
rmSync(archivePath, { force: true });
execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archivePath], {
  env: buildEnvironment,
  stdio: "inherit",
});

console.log(`Built the Outflow macOS release-readiness app and archive at ${outputDirectory}`);
