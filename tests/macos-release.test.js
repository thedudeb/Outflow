import assert from "node:assert/strict";
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

test("macOS release preflight rejects partial, mixed, repository-owned, and permissive credentials without echoing values", () => {
  const secret = "do-not-print-this-secret";
  const result = validateMacosReleaseEnvironment({
    ...apiEnvironment,
    APPLE_SIGNING_IDENTITY: "-",
    APPLE_CERTIFICATE: secret,
    APPLE_ID: "release@example.com",
    APPLE_PASSWORD: secret,
    APPLE_TEAM_ID: "WRONGTEAM00",
  }, {
    root: "/workspace/outflow",
    inspectPath: () => ({
      exists: true,
      file: true,
      mode: 0o100644,
      path: "/workspace/outflow/private/AuthKey.p8",
    }),
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith("APPLE_SIGNING_IDENTITY:")));
  assert.ok(result.errors.some((error) => error.startsWith("APPLE_CERTIFICATE:")));
  assert.ok(result.errors.some((error) => error.startsWith("Apple notarization:")));
  assert.ok(result.errors.some((error) => error.includes("outside the repository")));
  assert.ok(result.errors.some((error) => error.includes("exclude group and other")));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});
