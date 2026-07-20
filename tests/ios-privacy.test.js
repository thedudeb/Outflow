import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  validateIosGuestBuildInputs,
  validateIosPrivacyManifest,
  validateIosRequiredReasonSymbols,
} from "../scripts/check-ios-privacy.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

function manifest(overrides = {}) {
  return {
    NSPrivacyAccessedAPITypes: [{
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
      NSPrivacyAccessedAPITypeReasons: ["C617.1"],
    }],
    NSPrivacyCollectedDataTypes: [],
    NSPrivacyTracking: false,
    NSPrivacyTrackingDomains: [],
    ...overrides,
  };
}

test("the local guest privacy disclosure is exact and no-tracking", () => {
  assert.deepEqual(validateIosPrivacyManifest(manifest()), []);
});

test("privacy validation fails closed on tracking, collection, domains, or broader API reasons", () => {
  const cases = [
    manifest({ NSPrivacyTracking: true }),
    manifest({ NSPrivacyTrackingDomains: ["tracker.example"] }),
    manifest({ NSPrivacyCollectedDataTypes: [{ NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeEmailAddress" }] }),
    manifest({ NSPrivacyAccessedAPITypes: [] }),
    manifest({ NSPrivacyAccessedAPITypes: [{
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
      NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
    }] }),
    manifest({ UnexpectedDisclosure: true }),
  ];
  cases.forEach((candidate) => assert.ok(validateIosPrivacyManifest(candidate).length > 0));
});

test("the binary symbol boundary accepts container metadata and rejects undeclared reason categories", () => {
  assert.deepEqual(validateIosRequiredReasonSymbols("                 U _fstat\n                 U _stat\n"), []);
  assert.match(validateIosRequiredReasonSymbols("U _mach_absolute_time\n").join("\n"), /system-boot-time/);
  assert.match(validateIosRequiredReasonSymbols("U _stat\nU _statfs\n").join("\n"), /disk-space/);
  assert.match(validateIosRequiredReasonSymbols("U _stat\nU _OBJC_CLASS_\$_NSUserDefaults\n").join("\n"), /UserDefaults/);
  assert.match(validateIosRequiredReasonSymbols("U _stat\nU _activeInputModes\n").join("\n"), /active-keyboard/);
  assert.match(validateIosRequiredReasonSymbols("U _open\n").join("\n"), /no longer present/);
});

test("App Store guest packaging rejects hosted configuration without exposing values", () => {
  assert.deepEqual(validateIosGuestBuildInputs({}, []), []);
  const errors = validateIosGuestBuildInputs(
    { VITE_SUPABASE_URL: "https://private-project.supabase.co" },
    ["VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_private-value"],
  );
  assert.deepEqual(errors, [
    "VITE_SUPABASE_PUBLISHABLE_KEY: hosted native configuration is not covered by the local guest store disclosures.",
    "VITE_SUPABASE_URL: hosted native configuration is not covered by the local guest store disclosures.",
  ]);
  assert.doesNotMatch(errors.join("\n"), /private-project|private-value/);
});

test("the canonical manifest is a generated-project resource and survives iOS regeneration", () => {
  const packageJson = JSON.parse(read("package.json"));
  const project = read("src-tauri/gen/apple/project.yml");
  const xcodeProject = read("src-tauri/gen/apple/outflow.xcodeproj/project.pbxproj");
  const initializer = read("scripts/init-ios-project.mjs");

  assert.equal(packageJson.scripts["check:mobile:ios-privacy"], "node scripts/check-ios-privacy.mjs");
  assert.equal(packageJson.scripts["test:mobile:ios-privacy"], "node --test tests/ios-privacy.test.js");
  assert.match(project, /- path: \.\.\/\.\.\/PrivacyInfo\.xcprivacy\n\s+buildPhase: resources/);
  assert.match(xcodeProject, /PrivacyInfo\.xcprivacy in Resources/);
  assert.match(xcodeProject, /path = PrivacyInfo\.xcprivacy/);
  assert.match(xcodeProject, /path = \.\.\/\.\.;/);
  assert.match(initializer, /privacyResource/);
  assert.match(initializer, /execFileSync\("xcodegen"/);
  assert.match(initializer, /privacy manifest resource was not applied/);
});

test("simulator and signed IPA inspection enforce the bundled manifest", () => {
  const bundleInspector = read("scripts/check-ios-bundle.mjs");
  const releaseInspector = read("scripts/check-ios-release.mjs");
  const quality = read(".github/workflows/quality.yml");
  const protectedWorkflow = read(".github/workflows/ios-release.yml");
  const releaseBuilder = read("scripts/build-ios-release.mjs");

  assert.match(bundleInspector, /PrivacyInfo\.xcprivacy/);
  assert.match(bundleInspector, /bundled iOS privacy manifest violates the guest-build boundary/);
  assert.match(bundleInspector, /validateIosRequiredReasonSymbols/);
  assert.match(releaseInspector, /PrivacyInfo\.xcprivacy/);
  assert.match(releaseInspector, /signed IPA privacy manifest violates the guest-build boundary/);
  assert.match(releaseInspector, /validateIosRequiredReasonSymbols/);
  assert.match(quality, /npm run test:mobile:ios-privacy/);
  assert.match(quality, /npm run check:mobile:ios-privacy/);
  assert.match(protectedWorkflow, /npm run test:mobile:ios-privacy/);
  assert.match(protectedWorkflow, /npm run check:mobile:ios-privacy/);
  assert.match(releaseBuilder, /validateNativeGuestBuildInputs/);
  assert.match(releaseBuilder, /\.env\.production\.local/);
});
