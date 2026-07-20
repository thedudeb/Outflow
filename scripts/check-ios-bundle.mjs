import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { inspectIosPrivacyManifest, validateIosRequiredReasonSymbols } from "./check-ios-privacy.mjs";

const appPath = resolve(process.env.OUTFLOW_IOS_APP_PATH || "src-tauri/gen/apple/build/arm64-sim/Outflow.app");
const infoPath = resolve(appPath, "Info.plist");
const executablePath = resolve(appPath, "Outflow");
const assetsPath = resolve(appPath, "Assets.car");
const privacyPath = resolve(appPath, "PrivacyInfo.xcprivacy");

function plistValue(key) {
  return execFileSync("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", infoPath], { encoding: "utf8" }).trim();
}

assert.equal(existsSync(appPath), true, `iOS app bundle is missing at ${appPath}`);
assert.equal(existsSync(infoPath), true, "iOS Info.plist is missing");
assert.equal(existsSync(executablePath), true, "iOS executable is missing");
assert.equal(existsSync(assetsPath), true, "compiled iOS assets are missing");
assert.equal(existsSync(privacyPath), true, "iOS privacy manifest is missing from the application root");
assert.equal(existsSync(resolve(appPath, "embedded.mobileprovision")), false, "unsigned simulator bundle must not contain a provisioning profile");

assert.equal(plistValue("CFBundleIdentifier"), "com.thedudeb.outflow");
assert.equal(plistValue("CFBundleName"), "Outflow");
assert.equal(plistValue("CFBundleShortVersionString"), "0.1.0");
assert.equal(plistValue("MinimumOSVersion"), "14.0");
assert.equal(plistValue("CFBundleSupportedPlatforms"), "1");
assert.equal(plistValue("CFBundleSupportedPlatforms.0"), "iPhoneSimulator");

assert.ok(statSync(executablePath).size > 1_000_000, "iOS executable is unexpectedly small");
assert.ok(statSync(assetsPath).size > 1_000, "compiled iOS assets are unexpectedly small");
assert.equal(readFileSync(executablePath).subarray(0, 4).toString("hex"), "cffaedfe", "iOS executable is not a 64-bit Mach-O binary");
const sourcePrivacy = inspectIosPrivacyManifest("src-tauri/PrivacyInfo.xcprivacy");
const bundledPrivacy = inspectIosPrivacyManifest(privacyPath);
assert.deepEqual(sourcePrivacy.errors, [], "source iOS privacy manifest violates the guest-build boundary");
assert.deepEqual(bundledPrivacy.errors, [], "bundled iOS privacy manifest violates the guest-build boundary");
const symbols = execFileSync("/usr/bin/nm", ["-u", executablePath], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
assert.deepEqual(validateIosRequiredReasonSymbols(symbols), [], "iOS executable required-reason APIs do not match the privacy manifest");

console.log(`Verified unsigned Outflow iOS simulator bundle at ${appPath}`);
