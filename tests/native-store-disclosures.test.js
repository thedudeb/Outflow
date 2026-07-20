import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  inspectNativeStoreDisclosureSources,
  validateNativeStoreDisclosures,
} from "../scripts/check-native-store-disclosures.mjs";
import { validateNativeGuestBuildInputs } from "../scripts/native-guest-boundary.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const canonical = JSON.parse(read("store-disclosures/native-local-guest.json"));
const appIdentity = { name: "Outflow", version: "0.1.0", identifier: "com.thedudeb.outflow" };
const clone = () => structuredClone(canonical);

test("the native local guest answer set matches the release identity and privacy boundary", () => {
  assert.deepEqual(validateNativeStoreDisclosures(canonical, appIdentity), []);
  assert.deepEqual(inspectNativeStoreDisclosureSources(new URL("../", import.meta.url).pathname, {}), []);
});

test("store disclosure validation fails closed on broader capabilities or unsupported claims", () => {
  const cases = [
    (value) => { value.operatorStatus = "submitted"; },
    (value) => { value.submissionRequiresCandidateReview = false; },
    (value) => { value.releaseCapabilities.accounts = true; },
    (value) => { value.apple.appPrivacy.collectsData = true; },
    (value) => { value.apple.appPrivacy.dataTypes.push("Email Address"); },
    (value) => { value.googlePlay.dataSafety.dataShared = true; },
    (value) => { value.googlePlay.dataSafety.independentSecurityReview = true; },
    (value) => { value.googlePlay.financialFeatures.selections = []; },
    (value) => { value.sourceEvidence.dependencyLockSha256 = "unreviewed"; },
    (value) => { value.reviewTriggers.pop(); },
    (value) => { value.unreviewed = true; },
  ];
  cases.forEach((mutate) => {
    const candidate = clone();
    mutate(candidate);
    assert.ok(validateNativeStoreDisclosures(candidate, appIdentity).length > 0);
  });

  assert.match(
    validateNativeStoreDisclosures(canonical, { ...appIdentity, version: "0.2.0" }).join("\n"),
    /version does not match/,
  );
});

test("native guest packaging rejects hosted browser configuration without exposing values", () => {
  assert.deepEqual(validateNativeGuestBuildInputs({}, []), []);
  const errors = validateNativeGuestBuildInputs(
    { VITE_SUPABASE_URL: "https://private-project.supabase.co" },
    ["VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_private-value"],
  );
  assert.deepEqual(errors, [
    "VITE_SUPABASE_PUBLISHABLE_KEY: hosted native configuration is not covered by the local guest store disclosures.",
    "VITE_SUPABASE_URL: hosted native configuration is not covered by the local guest store disclosures.",
  ]);
  assert.doesNotMatch(errors.join("\n"), /private-project|private-value/);
});

test("both native release paths and CI enforce the disclosure contract before packaging", () => {
  const packageJson = JSON.parse(read("package.json"));
  const boundary = read("scripts/native-guest-boundary.mjs");
  const androidBuilder = read("scripts/build-android-release.mjs");
  const iosBuilder = read("scripts/build-ios-release.mjs");
  const iosInspector = read("scripts/check-ios-release.mjs");
  const androidInspector = read("scripts/check-android-release.mjs");
  const quality = read(".github/workflows/quality.yml");
  const iosWorkflow = read(".github/workflows/ios-release.yml");
  const androidWorkflow = read(".github/workflows/android-release.yml");

  assert.equal(packageJson.scripts["mobile:android:release"], "node scripts/build-android-release.mjs");
  assert.equal(packageJson.scripts["check:mobile:store-disclosures"], "node scripts/check-native-store-disclosures.mjs");
  assert.equal(packageJson.scripts["test:mobile:store-disclosures"], "node --test tests/native-store-disclosures.test.js");
  assert.match(boundary, /\.env\.production\.local/);
  assert.match(androidBuilder, /validateNativeGuestBuildInputs/);
  assert.match(androidBuilder, /readNativeProductionEnvironmentFiles/);
  assert.match(iosBuilder, /validateNativeGuestBuildInputs/);
  assert.match(iosInspector, /inspectNativeStoreDisclosureSources/);
  assert.match(androidInspector, /inspectNativeStoreDisclosureSources/);
  assert.match(quality, /npm run test:mobile:store-disclosures/g);
  assert.match(quality, /npm run check:mobile:store-disclosures/g);
  assert.match(iosWorkflow, /npm run test:mobile:store-disclosures/);
  assert.match(iosWorkflow, /npm run check:mobile:store-disclosures/);
  assert.match(androidWorkflow, /npm run test:mobile:store-disclosures/);
  assert.match(androidWorkflow, /npm run check:mobile:store-disclosures/);
});

test("release documentation preserves the draft and exact-candidate boundary", () => {
  const guide = read("docs/native-store-disclosures.md");
  const ios = read("docs/ios-release.md");
  const android = read("docs/android-release.md");
  const native = read("docs/native-mobile.md");

  assert.match(guide, /Draft, not submitted/);
  assert.match(guide, /No, we do not collect data from this app/);
  assert.match(guide, /Data safety.*No/);
  assert.match(guide, /Financial features.*Other/);
  assert.match(guide, /exact signed candidate/);
  assert.match(ios, /native-store-disclosures\.md/);
  assert.match(android, /native-store-disclosures\.md/);
  assert.match(native, /check:mobile:store-disclosures/);
});
