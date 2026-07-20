import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateMacosReleaseEnvironment } from "../scripts/check-macos-release-environment.mjs";

const teamId = "A1B2C3D4E5";
const identity = `Developer ID Application: Outflow Release (${teamId})`;
const apiEnvironment = {
  APPLE_SIGNING_IDENTITY: identity,
  OUTFLOW_MACOS_EXPECTED_TEAM_ID: teamId,
  APPLE_API_KEY: "F6G7H8J9K0",
  APPLE_API_ISSUER: "11111111-2222-3333-4444-555555555555",
  APPLE_API_KEY_PATH: "/private/release/AuthKey_F6G7H8J9K0.p8",
};
const privateKey = {
  exists: true,
  file: true,
  mode: 0o100600,
  size: 256,
  path: "/private/release/AuthKey_F6G7H8J9K0.p8",
};

test("macOS release preflight accepts one pinned Developer ID and private API key", () => {
  const result = validateMacosReleaseEnvironment(apiEnvironment, {
    root: "/workspace/outflow",
    inspectPath: () => privateKey,
  });

  assert.deepEqual(result, { valid: true, mode: "app-store-connect-api", errors: [] });
});

test("macOS release preflight accepts the complete Apple ID notarization mode", () => {
  const result = validateMacosReleaseEnvironment({
    APPLE_SIGNING_IDENTITY: identity,
    OUTFLOW_MACOS_EXPECTED_TEAM_ID: teamId,
    APPLE_ID: "release@example.com",
    APPLE_PASSWORD: "@env:OUTFLOW_APP_PASSWORD",
    APPLE_TEAM_ID: teamId,
  }, { root: "/workspace/outflow" });

  assert.deepEqual(result, { valid: true, mode: "apple-id", errors: [] });
});

test("macOS release preflight binds protected CI signing to the exact main commit", () => {
  const commit = "a".repeat(40);
  const result = validateMacosReleaseEnvironment({
    ...apiEnvironment,
    APPLE_CERTIFICATE: "base64-certificate",
    APPLE_CERTIFICATE_PASSWORD: "indirect-password",
    OUTFLOW_MACOS_REQUIRE_CERTIFICATE: "true",
    OUTFLOW_MACOS_EXPECTED_COMMIT: commit,
    GITHUB_SHA: commit,
    GITHUB_REF: "refs/heads/main",
  }, {
    root: "/workspace/outflow",
    inspectPath: () => privateKey,
  });

  assert.deepEqual(result, { valid: true, mode: "app-store-connect-api", errors: [] });
});

test("macOS release preflight rejects partial, mixed, repository-owned, and permissive credentials without echoing values", () => {
  const secret = "do-not-print-this-secret";
  const result = validateMacosReleaseEnvironment({
    ...apiEnvironment,
    APPLE_SIGNING_IDENTITY: "-",
    APPLE_CERTIFICATE: secret,
    APPLE_ID: "release@example.com",
    APPLE_PASSWORD: secret,
    APPLE_TEAM_ID: "WRONGTEAM00",
    OUTFLOW_MACOS_REQUIRE_CERTIFICATE: "sometimes",
    OUTFLOW_MACOS_EXPECTED_COMMIT: "not-a-commit",
    GITHUB_SHA: "b".repeat(40),
    GITHUB_REF: "refs/heads/release-candidate",
  }, {
    root: "/workspace/outflow",
    inspectPath: () => ({
      exists: true,
      file: true,
      mode: 0o100644,
      size: 0,
      path: "/workspace/outflow/private/AuthKey.p8",
    }),
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith("APPLE_SIGNING_IDENTITY:")));
  assert.ok(result.errors.some((error) => error.startsWith("APPLE_CERTIFICATE:")));
  assert.ok(result.errors.some((error) => error.startsWith("OUTFLOW_MACOS_REQUIRE_CERTIFICATE:")));
  assert.ok(result.errors.some((error) => error.startsWith("OUTFLOW_MACOS_EXPECTED_COMMIT:")));
  assert.ok(result.errors.some((error) => error.startsWith("GITHUB_SHA:")));
  assert.ok(result.errors.some((error) => error.startsWith("GITHUB_REF:")));
  assert.ok(result.errors.some((error) => error.startsWith("Apple notarization:")));
  assert.ok(result.errors.some((error) => error.includes("outside the repository")));
  assert.ok(result.errors.some((error) => error.includes("exclude group and other")));
  assert.ok(result.errors.some((error) => error.includes("file size is outside")));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test("the protected macOS workflow retains only an exact-commit verified release candidate", () => {
  const workflow = readFileSync(new URL("../.github/workflows/macos-release.yml", import.meta.url), "utf8");
  const installIndex = workflow.indexOf("name: Install locked dependencies");
  const contractsIndex = workflow.indexOf("name: Verify release contracts");
  const keyIndex = workflow.indexOf("name: Materialize private notarization key");
  const cleanupIndex = workflow.indexOf("name: Remove notarization key");
  const inspectIndex = workflow.indexOf("name: Inspect distributable archive");
  const uploadIndex = workflow.indexOf("name: Upload verified release candidate");

  assert.match(workflow, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):/m);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: macos-production/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /OUTFLOW_MACOS_EXPECTED_COMMIT: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /OUTFLOW_MACOS_REQUIRE_CERTIFICATE: "true"/);
  assert.match(workflow, /install -m 600 \/dev\/null "\$APPLE_API_KEY_PATH"/);
  assert.match(workflow, /npm run check:desktop:release-environment/);
  assert.match(workflow, /OUTFLOW_MACOS_EXPECT_DISTRIBUTABLE: "true"/);
  assert.match(workflow, /shasum -a 256 \*\.zip > SHA256SUMS\.txt/);
  assert.match(workflow, /macos-release\/\*\.zip/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /retention-days: 7/);
  assert.doesNotMatch(workflow, /macos-release\/Outflow\.app/);
  assert.equal(workflow.match(/secrets\.OUTFLOW_APPLE_API_PRIVATE_KEY/g)?.length, 1);
  assert.equal(workflow.match(/secrets\.OUTFLOW_APPLE_CERTIFICATE \}\}/g)?.length, 2);
  assert.equal(workflow.match(/secrets\.OUTFLOW_APPLE_CERTIFICATE_PASSWORD \}\}/g)?.length, 2);
  assert.ok(installIndex < contractsIndex && contractsIndex < keyIndex);
  assert.ok(keyIndex < cleanupIndex && cleanupIndex < inspectIndex && inspectIndex < uploadIndex);
});
