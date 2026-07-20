import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  IOS_BUNDLE_ID,
  assertMachOArm64,
  normalizeFingerprint,
  readPlist,
  readProvisioningProfile,
  validateProvisioningProfile,
} from "./ios-release-lib.mjs";
import { inspectIosPrivacyManifest, validateIosRequiredReasonSymbols } from "./check-ios-privacy.mjs";

assert.equal(process.platform, "darwin", "signed iOS artifacts must be inspected on macOS");

const expectedTeamId = String(process.env.OUTFLOW_IOS_EXPECTED_TEAM_ID || "").trim();
const expectedFingerprint = normalizeFingerprint(process.env.OUTFLOW_IOS_EXPECTED_CERT_SHA256);
const expectedBuildNumber = String(process.env.OUTFLOW_IOS_BUILD_NUMBER || "").trim();
assert.match(expectedTeamId, /^[A-Z0-9]{10}$/, "a pinned 10-character Apple Team ID is required");
assert.match(expectedFingerprint, /^[A-F0-9]{64}$/, "a pinned 32-byte iOS certificate SHA-256 fingerprint is required");
assert.match(expectedBuildNumber, /^[1-9][0-9]{0,17}$/, "a positive, bounded iOS build number is required");

const ipaPath = resolve(process.env.OUTFLOW_IOS_RELEASE_IPA_PATH || "src-tauri/gen/apple/build/arm64/Outflow.ipa");
assert.equal(existsSync(ipaPath), true, `Outflow IPA is missing at ${ipaPath}`);
assert.ok(statSync(ipaPath).size > 5_000_000, "Outflow IPA is unexpectedly small");

const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
  ...options,
});
const directory = mkdtempSync(join(tmpdir(), "outflow-ios-release-"));
const sourcePrivacy = inspectIosPrivacyManifest("src-tauri/PrivacyInfo.xcprivacy");
assert.deepEqual(sourcePrivacy.errors, [], "source iOS privacy manifest violates the guest-build boundary");

try {
  const entries = run("/usr/bin/unzip", ["-Z1", ipaPath]).trim().split("\n").filter(Boolean);
  assert.ok(entries.length > 0, "Outflow IPA is empty");
  assert.ok(entries.every((entry) => !entry.startsWith("/") && !entry.split("/").includes("..")), "Outflow IPA contains an unsafe path");
  assert.ok(entries.includes("Payload/Outflow.app/Info.plist"), "Outflow IPA is missing the expected application payload");
  assert.equal(entries.filter((entry) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(entry)).length, 1, "Outflow IPA must contain exactly one application");
  run("/usr/bin/unzip", ["-qq", ipaPath, "-d", directory]);

  const appPath = join(directory, "Payload", "Outflow.app");
  const info = readPlist(join(appPath, "Info.plist"));
  assert.equal(info.CFBundleIdentifier, IOS_BUNDLE_ID);
  assert.equal(info.CFBundleName, "Outflow");
  assert.equal(info.CFBundleShortVersionString, "0.1.0");
  assert.equal(String(info.CFBundleVersion), `0.1.0.${expectedBuildNumber}`);
  assert.equal(info.MinimumOSVersion, "14.0");
  assert.deepEqual(info.CFBundleSupportedPlatforms, ["iPhoneOS"]);
  const bundledPrivacy = inspectIosPrivacyManifest(join(appPath, "PrivacyInfo.xcprivacy"));
  assert.deepEqual(bundledPrivacy.errors, [], "signed IPA privacy manifest violates the guest-build boundary");

  const executablePath = join(appPath, info.CFBundleExecutable);
  assert.equal(existsSync(executablePath), true, "Outflow executable is missing");
  assert.ok(statSync(executablePath).size > 1_000_000, "Outflow executable is unexpectedly small");
  assert.ok(statSync(join(appPath, "Assets.car")).size > 1_000, "Outflow compiled assets are unexpectedly small");
  assertMachOArm64(executablePath);
  const symbols = run("/usr/bin/nm", ["-u", executablePath]);
  assert.deepEqual(validateIosRequiredReasonSymbols(symbols), [], "signed IPA required-reason APIs do not match the privacy manifest");

  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  const details = spawnSync("/usr/bin/codesign", ["-dvvv", appPath], { encoding: "utf8" });
  assert.equal(details.status, 0, "codesign could not inspect the Outflow application");
  const signature = `${details.stdout}\n${details.stderr}`;
  assert.match(signature, new RegExp(`Identifier=${IOS_BUNDLE_ID.replaceAll(".", "\\.")}(?:\\n|$)`));
  assert.match(signature, new RegExp(`TeamIdentifier=${expectedTeamId}(?:\\n|$)`));
  assert.match(signature, /Authority=(?:Apple|iPhone) Distribution:/);

  const certificatePrefix = join(directory, "outflow-signing-certificate");
  run("/usr/bin/codesign", ["-d", "--extract-certificates", certificatePrefix, appPath]);
  const signingCertificate = new X509Certificate(readFileSync(`${certificatePrefix}0`));
  assert.equal(normalizeFingerprint(signingCertificate.fingerprint256), expectedFingerprint, "application signature certificate does not match the independent pin");

  const entitlementsOutput = run("/usr/bin/codesign", ["-d", "--entitlements", "-", "--xml", appPath]);
  const entitlementsPath = join(directory, "signed-entitlements.plist");
  writeFileSync(entitlementsPath, entitlementsOutput, { mode: 0o600 });
  const entitlements = readPlist(entitlementsPath);
  const allowedEntitlements = new Set([
    "application-identifier",
    "beta-reports-active",
    "com.apple.developer.team-identifier",
    "get-task-allow",
    "keychain-access-groups",
  ]);
  assert.equal(entitlements["application-identifier"], `${expectedTeamId}.${IOS_BUNDLE_ID}`);
  assert.equal(entitlements["com.apple.developer.team-identifier"], expectedTeamId);
  assert.equal(entitlements["get-task-allow"], false);
  assert.deepEqual(entitlements["keychain-access-groups"], [`${expectedTeamId}.*`]);
  assert.ok(Object.keys(entitlements).every((key) => allowedEntitlements.has(key)), "signed application contains an unapproved entitlement");

  const profilePath = join(appPath, "embedded.mobileprovision");
  assert.equal(existsSync(profilePath), true, "signed application is missing its embedded provisioning profile");
  const profile = readProvisioningProfile(profilePath);
  assert.deepEqual(validateProvisioningProfile(profile, expectedTeamId, expectedFingerprint), []);

  console.log(`Verified the fingerprint-pinned App Store Connect Outflow IPA at ${ipaPath}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
