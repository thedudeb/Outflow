import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.equal(process.platform, "darwin", "macOS release artifacts must be inspected on macOS");

const tauriConfig = JSON.parse(readFileSync(resolve("src-tauri/tauri.conf.json"), "utf8"));
const regexEscape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const target = String(process.env.OUTFLOW_MACOS_TARGET || "").trim();
assert.match(target, /^(?:|universal-apple-darwin)$/, `unsupported macOS release target: ${target}`);
const targetRoot = target ? `src-tauri/target/${target}` : "src-tauri/target";
const archivePattern = new RegExp(
  `^${regexEscape(tauriConfig.productName)}_${regexEscape(tauriConfig.version)}_(?:aarch64|universal|x64)\\.zip$`,
);
const appPath = resolve(
  process.env.OUTFLOW_MACOS_APP_PATH
    || `${targetRoot}/release/bundle/macos/${tauriConfig.productName}.app`,
);
const archiveDirectory = resolve(`${targetRoot}/release/bundle/macos-release`);
const releaseFiles = existsSync(archiveDirectory) ? readdirSync(archiveDirectory) : [];
const zipFiles = releaseFiles.filter((name) => name.endsWith(".zip"));
const archives = zipFiles.filter((name) => archivePattern.test(name));
const archivePath = resolve(
  process.env.OUTFLOW_MACOS_ARCHIVE_PATH
    || join(archiveDirectory, archives[0] || `${tauriConfig.productName}_${tauriConfig.version}_missing.zip`),
);
const expectDistributable = process.env.OUTFLOW_MACOS_EXPECT_DISTRIBUTABLE === "true";
const expectUpdater = process.env.OUTFLOW_MACOS_REQUIRE_UPDATER === "true";
const expectedTeamId = String(process.env.OUTFLOW_MACOS_EXPECTED_TEAM_ID || "").trim();
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
  ...options,
}).trim();
const inspect = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    ...result,
    output: `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
  };
};
const plistValue = (path, key) => run("plutil", ["-extract", key, "raw", "-o", "-", join(path, "Contents/Info.plist")]);

function verifyApp(path) {
  const executable = join(path, "Contents/MacOS/outflow");
  const icon = join(path, "Contents/Resources/icon.icns");
  const codeResources = join(path, "Contents/_CodeSignature/CodeResources");
  assert.equal(existsSync(path), true, `Outflow app is missing at ${path}`);
  assert.ok(statSync(executable).size > 5_000_000, "Outflow macOS executable is unexpectedly small");
  assert.ok(statSync(icon).size > 100_000, "Outflow macOS icon is unexpectedly small");
  assert.ok(statSync(codeResources).size > 500, "Outflow sealed-resource inventory is missing");

  assert.equal(plistValue(path, "CFBundleIdentifier"), tauriConfig.identifier);
  assert.equal(plistValue(path, "CFBundleDisplayName"), tauriConfig.productName);
  assert.equal(plistValue(path, "CFBundleExecutable"), "outflow");
  assert.equal(plistValue(path, "CFBundleShortVersionString"), tauriConfig.version);
  assert.equal(plistValue(path, "CFBundleVersion"), tauriConfig.version);
  assert.equal(plistValue(path, "LSApplicationCategoryType"), "public.app-category.finance");
  assert.equal(plistValue(path, "LSMinimumSystemVersion"), "10.13");
  const executableDescription = run("file", [executable]);
  if (target === "universal-apple-darwin") {
    assert.match(executableDescription, /Mach-O universal binary/);
    assert.deepEqual(new Set(run("lipo", ["-archs", executable]).split(/\s+/)), new Set(["arm64", "x86_64"]));
  } else {
    assert.match(executableDescription, /Mach-O 64-bit executable (?:arm64|x86_64)/);
  }

  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=4", path], { stdio: "pipe" });
  const signature = inspect("codesign", ["--display", "--verbose=4", path]);
  assert.equal(signature.status, 0, signature.output);
  assert.match(signature.output, new RegExp(`Identifier=${regexEscape(tauriConfig.identifier)}`));
  assert.match(signature.output, /flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/i);
  assert.match(signature.output, /Sealed Resources version=2/);
  assert.match(signature.output, /Info\.plist entries=/);

  const entitlements = inspect("codesign", ["--display", "--entitlements", "-", path]);
  assert.equal(entitlements.status, 0, entitlements.output);
  assert.doesNotMatch(entitlements.output, /<key>|application-identifier|com\.apple\./i);

  const gatekeeper = inspect("spctl", ["--assess", "--type", "execute", "--verbose=4", path]);
  const stapler = inspect("xcrun", ["stapler", "validate", resolve(path)]);
  if (expectDistributable) {
    assert.match(expectedTeamId, /^[A-Z0-9]{10}$/, "a 10-character expected Apple Team ID is required");
    assert.doesNotMatch(signature.output, /Signature=adhoc|\(adhoc,/);
    assert.match(signature.output, new RegExp(`TeamIdentifier=${expectedTeamId}`));
    assert.match(signature.output, /Authority=Developer ID Application:/);
    assert.equal(stapler.status, 0, stapler.output);
    assert.equal(gatekeeper.status, 0, gatekeeper.output);
    assert.match(gatekeeper.output, /source=Notarized Developer ID/);
  } else {
    assert.match(signature.output, /Signature=adhoc/);
    assert.match(signature.output, /flags=0x[0-9a-f]+\([^)]*adhoc[^)]*runtime[^)]*\)/i);
    assert.match(signature.output, /TeamIdentifier=not set/);
    assert.notEqual(stapler.status, 0, "release-readiness app must not contain a notarization ticket");
    assert.notEqual(gatekeeper.status, 0, "ad-hoc release-readiness app must not pass Gatekeeper distribution assessment");
  }
}

assert.equal(zipFiles.length, 1, "exactly one macOS ZIP release candidate is required");
assert.equal(archives.length, 1, "the macOS ZIP release candidate must match the configured product and version");
assert.equal(existsSync(archivePath), true, `Outflow macOS archive is missing at ${archivePath}`);
assert.ok(statSync(archivePath).size > 4_000_000, "Outflow macOS archive is unexpectedly small");
assert.match(run("file", [archivePath]), /Zip archive data/);
run("unzip", ["-t", archivePath]);

verifyApp(appPath);

if (expectUpdater) {
  const updaterArchive = resolve(archiveDirectory, `${tauriConfig.productName}.app.tar.gz`);
  const updaterSignature = `${updaterArchive}.sig`;
  const manifestPath = resolve(archiveDirectory, "latest.json");
  assert.equal(target, "universal-apple-darwin", "signed updates must use the universal target");
  assert.ok(statSync(updaterArchive).size > 4_000_000, "the updater archive is unexpectedly small");
  assert.ok(statSync(updaterSignature).size > 40, "the updater signature is unexpectedly small");
  const signature = readFileSync(updaterSignature, "utf8").trim();
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.version, tauriConfig.version);
  assert.match(manifest.pub_date, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(manifest.platforms), ["darwin-universal"]);
  assert.equal(manifest.platforms["darwin-universal"].signature, signature);
  assert.equal(
    manifest.platforms["darwin-universal"].url,
    `https://github.com/thedudeb/Outflow/releases/download/v${tauriConfig.version}/${tauriConfig.productName}.app.tar.gz`,
  );
}

const extractionDirectory = mkdtempSync(join(tmpdir(), "outflow-macos-release-"));
try {
  run("ditto", ["-x", "-k", archivePath, extractionDirectory]);
  verifyApp(join(extractionDirectory, `${tauriConfig.productName}.app`));
} finally {
  rmSync(extractionDirectory, { recursive: true, force: true });
}

console.log(`Verified the ${expectDistributable ? "Developer ID signed and notarized" : "ad-hoc signed, explicitly non-distributable"} Outflow macOS app and archive`);
