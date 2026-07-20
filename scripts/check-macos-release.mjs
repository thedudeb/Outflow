import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.equal(process.platform, "darwin", "macOS release artifacts must be inspected on macOS");

const appPath = resolve(process.env.OUTFLOW_MACOS_APP_PATH || "src-tauri/target/release/bundle/macos/Outflow.app");
const archiveDirectory = resolve("src-tauri/target/release/bundle/macos-release");
const archives = existsSync(archiveDirectory)
  ? readdirSync(archiveDirectory).filter((name) => /^Outflow_0\.1\.0_(?:aarch64|x64)\.zip$/.test(name))
  : [];
const archivePath = resolve(
  process.env.OUTFLOW_MACOS_ARCHIVE_PATH
    || join(archiveDirectory, archives[0] || "Outflow_0.1.0_missing.zip"),
);
const expectDistributable = process.env.OUTFLOW_MACOS_EXPECT_DISTRIBUTABLE === "true";
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

  assert.equal(plistValue(path, "CFBundleIdentifier"), "com.thedudeb.outflow");
  assert.equal(plistValue(path, "CFBundleDisplayName"), "Outflow");
  assert.equal(plistValue(path, "CFBundleExecutable"), "outflow");
  assert.equal(plistValue(path, "CFBundleShortVersionString"), "0.1.0");
  assert.equal(plistValue(path, "CFBundleVersion"), "0.1.0");
  assert.equal(plistValue(path, "LSApplicationCategoryType"), "public.app-category.finance");
  assert.equal(plistValue(path, "LSMinimumSystemVersion"), "10.13");
  assert.match(run("file", [executable]), /Mach-O 64-bit executable (?:arm64|x86_64)/);

  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=4", path], { stdio: "pipe" });
  const signature = inspect("codesign", ["--display", "--verbose=4", path]);
  assert.equal(signature.status, 0, signature.output);
  assert.match(signature.output, /Identifier=com\.thedudeb\.outflow/);
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

assert.equal(archives.length, 1, "exactly one Outflow macOS release archive is required");
assert.equal(existsSync(archivePath), true, `Outflow macOS archive is missing at ${archivePath}`);
assert.ok(statSync(archivePath).size > 4_000_000, "Outflow macOS archive is unexpectedly small");
assert.match(run("file", [archivePath]), /Zip archive data/);
run("unzip", ["-t", archivePath]);

verifyApp(appPath);

const extractionDirectory = mkdtempSync(join(tmpdir(), "outflow-macos-release-"));
try {
  run("ditto", ["-x", "-k", archivePath, extractionDirectory]);
  verifyApp(join(extractionDirectory, "Outflow.app"));
} finally {
  rmSync(extractionDirectory, { recursive: true, force: true });
}

console.log(`Verified the ${expectDistributable ? "Developer ID signed and notarized" : "ad-hoc signed, explicitly non-distributable"} Outflow macOS app and archive`);
