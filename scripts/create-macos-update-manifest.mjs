import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const tauriConfig = JSON.parse(readFileSync(resolve("src-tauri/tauri.conf.json"), "utf8"));
const target = String(process.env.OUTFLOW_MACOS_TARGET || "").trim();
assert.equal(target, "universal-apple-darwin", "updater manifests require the universal macOS target");
assert.equal(String(process.env.OUTFLOW_MACOS_EXPECTED_VERSION || "").trim(), tauriConfig.version, "the confirmed release version must match tauri.conf.json");

const repository = String(process.env.OUTFLOW_MACOS_RELEASE_REPOSITORY || "thedudeb/Outflow").trim();
assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "release repository is invalid");
const targetRoot = resolve(`src-tauri/target/${target}/release/bundle`);
const updaterArchive = resolve(targetRoot, `macos/${tauriConfig.productName}.app.tar.gz`);
const updaterSignature = `${updaterArchive}.sig`;
assert.equal(existsSync(updaterArchive), true, "the signed updater archive is missing");
assert.equal(existsSync(updaterSignature), true, "the updater signature is missing");

const signature = readFileSync(updaterSignature, "utf8").trim();
assert.ok(signature.length >= 40 && signature.length <= 10_000, "the updater signature is invalid");
const tag = `v${tauriConfig.version}`;
const assetName = basename(updaterArchive);
const outputDirectory = resolve(targetRoot, "macos-release");
mkdirSync(outputDirectory, { recursive: true });
copyFileSync(updaterArchive, resolve(outputDirectory, assetName));
copyFileSync(updaterSignature, resolve(outputDirectory, `${assetName}.sig`));

const manifest = {
  version: tauriConfig.version,
  notes: String(process.env.OUTFLOW_MACOS_RELEASE_NOTES || `Outflow ${tauriConfig.version}`).trim().slice(0, 4_000),
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-universal": {
      signature,
      url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`,
    },
  },
};
writeFileSync(resolve(outputDirectory, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
console.log(`Created the Outflow ${tauriConfig.version} universal macOS update manifest`);
