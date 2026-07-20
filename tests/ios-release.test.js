import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateIosReleaseEnvironment, verifyIosReleaseEnvironment } from "../scripts/check-ios-release-environment.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const fingerprint = "AB".repeat(32);
const teamId = "A1B2C3D4E5";
const now = new Date("2026-07-20T12:00:00Z");
const future = new Date("2027-07-20T12:00:00Z").toISOString();
const past = new Date("2026-01-20T12:00:00Z").toISOString();
const commit = "a".repeat(40);

function environment(overrides = {}) {
  return {
    IOS_CERTIFICATE: Buffer.alloc(1_200, 1).toString("base64"),
    IOS_CERTIFICATE_PASSWORD: "a sufficiently long password",
    IOS_MOBILE_PROVISION: Buffer.alloc(1_500, 2).toString("base64"),
    OUTFLOW_IOS_EXPECTED_TEAM_ID: teamId,
    OUTFLOW_IOS_EXPECTED_CERT_SHA256: fingerprint,
    OUTFLOW_IOS_BUILD_NUMBER: "42",
    OUTFLOW_IOS_EXPECTED_COMMIT: commit,
    GITHUB_SHA: commit,
    GITHUB_REF: "refs/heads/main",
    ...overrides,
  };
}

function materials(overrides = {}) {
  return {
    certificate: {
      subject: `CN=Apple Distribution: Outflow (${teamId})\nOU=${teamId}`,
      issuer: "CN=Apple Worldwide Developer Relations Certification Authority",
      fingerprint256: fingerprint,
      validFrom: past,
      validTo: future,
    },
    profile: {
      UUID: "11111111-2222-3333-4444-555555555555",
      Name: "Outflow App Store",
      TeamIdentifier: [teamId],
      ApplicationIdentifierPrefix: [teamId],
      CreationDate: past,
      ExpirationDate: future,
      DeveloperCertificates: ["test-certificate"],
      Entitlements: {
        "application-identifier": `${teamId}.com.thedudeb.outflow`,
        "com.apple.developer.team-identifier": teamId,
        "get-task-allow": false,
        "beta-reports-active": true,
        "keychain-access-groups": [`${teamId}.*`],
      },
    },
    ...overrides,
  };
}

const verifyOptions = (overrides = {}) => ({
  now,
  inspectMaterials: () => materials(),
  parseProfileCertificate: () => ({ fingerprint256: fingerprint }),
  ...overrides,
});

test("the iOS signing preflight accepts exact production pins without exposing their values", () => {
  const result = verifyIosReleaseEnvironment(environment(), verifyOptions());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal("certificatePayload" in result, false);
  assert.equal("profilePayload" in result, false);
});

test("the iOS signing preflight rejects malformed, partial, and non-main environments", () => {
  const malformed = validateIosReleaseEnvironment(environment({
    IOS_CERTIFICATE: "not base64",
    IOS_CERTIFICATE_PASSWORD: "short",
    OUTFLOW_IOS_EXPECTED_CERT_SHA256: "bad",
    OUTFLOW_IOS_BUILD_NUMBER: "0",
    GITHUB_REF: "refs/heads/feature",
  }));
  assert.equal(malformed.valid, false);
  assert.ok(malformed.errors.length >= 5);
  assert.doesNotMatch(malformed.errors.join("\n"), /sufficiently long password|not base64/);
});

test("the iOS signing preflight rejects certificate, profile, expiry, and entitlement drift", () => {
  const wrongCertificate = verifyIosReleaseEnvironment(environment(), verifyOptions({
    inspectMaterials: () => materials({ certificate: { ...materials().certificate, fingerprint256: "CD".repeat(32) } }),
  }));
  assert.equal(wrongCertificate.valid, false);
  assert.match(wrongCertificate.errors.join("\n"), /independent pin/);

  const badProfile = materials();
  badProfile.profile.Entitlements["com.apple.developer.associated-domains"] = ["applinks:example.com"];
  badProfile.profile.ExpirationDate = new Date("2026-07-25T12:00:00Z").toISOString();
  const profileResult = verifyIosReleaseEnvironment(environment(), verifyOptions({ inspectMaterials: () => badProfile }));
  assert.equal(profileResult.valid, false);
  assert.match(profileResult.errors.join("\n"), /unapproved entitlement/);
  assert.match(profileResult.errors.join("\n"), /expires within 30 days/);
});

test("the iOS release scripts bind the supported Tauri build to a strict signed IPA inspector", () => {
  const packageJson = JSON.parse(read("package.json"));
  const builder = read("scripts/build-ios-release.mjs");
  const inspector = read("scripts/check-ios-release.mjs");
  assert.equal(packageJson.scripts["mobile:ios:release"], "node scripts/build-ios-release.mjs");
  assert.equal(packageJson.scripts["check:mobile:ios-release"], "node scripts/check-ios-release.mjs");
  assert.match(builder, /"--export-method", "app-store-connect"/);
  assert.match(builder, /"--build-number", buildNumber/);
  assert.doesNotMatch(builder, /xcodebuild|security|codesign/);
  assert.match(inspector, /"--verify", "--deep", "--strict"/);
  assert.match(inspector, /--extract-certificates/);
  assert.match(inspector, /embedded\.mobileprovision/);
  assert.match(inspector, /`0\.1\.0\.\$\{expectedBuildNumber\}`/);
  assert.match(inspector, /signed application contains an unapproved entitlement/);
  assert.match(inspector, /keychain-access-groups/);
  assert.match(inspector, /unsafe path/);
});

test("the protected iOS workflow is manual, exact-commit, secret-scoped, and non-retaining", () => {
  const workflow = read(".github/workflows/ios-release.yml");
  const contractsIndex = workflow.indexOf("Verify release contracts before secrets");
  const baselineIndex = workflow.indexOf("Build and inspect unsigned simulator baseline");
  const secretIndex = workflow.indexOf("secrets.OUTFLOW_IOS_CERTIFICATE_BASE64");
  const buildIndex = workflow.indexOf("Build App Store Connect signed IPA");
  const inspectIndex = workflow.indexOf("Inspect fingerprint-pinned signed IPA");
  const summaryIndex = workflow.indexOf("Record bounded release evidence");

  assert.match(workflow, /^name: iOS Production Signing Acceptance/m);
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(workflow, /^\s+push:|^\s+pull_request:/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: ios-production/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /OUTFLOW_IOS_EXPECTED_COMMIT: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /OUTFLOW_IOS_BUILD_NUMBER: \$\{\{ github\.run_number \}\}/);
  assert.equal(workflow.match(/secrets\.OUTFLOW_IOS_CERTIFICATE_BASE64/g)?.length, 2);
  assert.equal(workflow.match(/secrets\.OUTFLOW_IOS_CERTIFICATE_PASSWORD/g)?.length, 2);
  assert.equal(workflow.match(/secrets\.OUTFLOW_IOS_MOBILE_PROVISION_BASE64/g)?.length, 2);
  assert.ok(contractsIndex < baselineIndex && baselineIndex < secretIndex);
  assert.ok(secretIndex < buildIndex && buildIndex < inspectIndex && inspectIndex < summaryIndex);
  assert.match(workflow, /npm run check:mobile:ios-release-environment/);
  assert.match(workflow, /npm run check:mobile:ios-release/);
  assert.match(workflow, /shasum -a 256 src-tauri\/gen\/apple\/build\/arm64\/Outflow\.ipa/);
  assert.doesNotMatch(workflow, /upload-artifact|TestFlight|app-store upload|VITE_/i);
});
