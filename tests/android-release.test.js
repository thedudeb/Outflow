import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  validateAndroidReleaseEnvironment,
  verifyAndroidReleaseEnvironment,
} from "../scripts/check-android-release-environment.mjs";

const commit = "a".repeat(40);
const fingerprint = "12:34:56:78:90:AB:CD:EF:".repeat(4).slice(0, -1);
const normalizedFingerprint = fingerprint.replaceAll(":", "");
const validEnvironment = {
  OUTFLOW_ANDROID_KEYSTORE_PATH: "/private/release/outflow-upload.jks",
  OUTFLOW_ANDROID_KEYSTORE_PASSWORD: "strong-store-password",
  OUTFLOW_ANDROID_KEY_ALIAS: "outflow-upload",
  OUTFLOW_ANDROID_KEY_PASSWORD: "strong-entry-password",
  OUTFLOW_ANDROID_EXPECTED_CERT_SHA256: fingerprint,
  OUTFLOW_ANDROID_EXPECTED_COMMIT: commit,
  GITHUB_SHA: commit,
  GITHUB_REF: "refs/heads/main",
};
const privateKeystore = {
  exists: true,
  file: true,
  mode: 0o100600,
  size: 4_096,
  path: "/private/release/outflow-upload.jks",
};

test("Android release preflight accepts one private exact-commit upload key", () => {
  const result = validateAndroidReleaseEnvironment(validEnvironment, {
    root: "/workspace/outflow",
    inspectPath: () => privateKeystore,
  });

  assert.deepEqual(result, { valid: true, expectedFingerprint: normalizedFingerprint, errors: [] });
});

test("Android release preflight verifies the independently pinned private-key certificate", () => {
  const invocations = [];
  const result = verifyAndroidReleaseEnvironment(validEnvironment, {
    root: "/workspace/outflow",
    inspectPath: () => privateKeystore,
    execute: (command, args, options) => {
      invocations.push({ command, args, options });
      return args.includes("-list") ? "Alias name: outflow-upload\nEntry type: PrivateKeyEntry" : "certificate-pem";
    },
    parseCertificate: () => ({
      fingerprint256: fingerprint,
      validFrom: "Jan 1 00:00:00 2025 GMT",
      validTo: "Jan 1 00:00:00 2030 GMT",
    }),
    now: "2026-07-20T12:00:00Z",
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(invocations.length, 2);
  assert.ok(invocations[0].args.includes("-list"));
  assert.ok(invocations[1].args.includes("-exportcert"));
  invocations.forEach((invocation) => {
    assert.deepEqual(invocation.args.slice(-4), [
      "-storepass:env", "OUTFLOW_ANDROID_KEYSTORE_PASSWORD", "-alias", "outflow-upload",
    ]);
    assert.ok(!invocation.args.includes(validEnvironment.OUTFLOW_ANDROID_KEYSTORE_PASSWORD));
    assert.equal(invocation.options.env.OUTFLOW_ANDROID_KEYSTORE_PASSWORD, "strong-store-password");
  });
});

test("Android release preflight rejects weak, repository-owned, mismatched input without echoing values", () => {
  const secret = "do-not-print";
  const result = validateAndroidReleaseEnvironment({
    ...validEnvironment,
    OUTFLOW_ANDROID_KEYSTORE_PASSWORD: secret,
    OUTFLOW_ANDROID_KEY_ALIAS: "bad alias/value",
    OUTFLOW_ANDROID_KEY_PASSWORD: secret,
    OUTFLOW_ANDROID_EXPECTED_CERT_SHA256: "not-a-fingerprint",
    OUTFLOW_ANDROID_EXPECTED_COMMIT: "not-a-commit",
    GITHUB_SHA: "b".repeat(40),
    GITHUB_REF: "refs/heads/release-candidate",
  }, {
    root: "/workspace/outflow",
    inspectPath: () => ({
      exists: true,
      file: true,
      mode: 0o100644,
      size: 0,
      path: "/workspace/outflow/private/upload.jks",
    }),
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("file size is outside")));
  assert.ok(result.errors.some((error) => error.includes("outside the repository")));
  assert.ok(result.errors.some((error) => error.includes("exclude group and other")));
  assert.ok(result.errors.some((error) => error.startsWith("OUTFLOW_ANDROID_KEYSTORE_PASSWORD:")));
  assert.ok(result.errors.some((error) => error.startsWith("OUTFLOW_ANDROID_KEY_ALIAS:")));
  assert.ok(result.errors.some((error) => error.startsWith("OUTFLOW_ANDROID_KEY_PASSWORD:")));
  assert.ok(result.errors.some((error) => error.startsWith("OUTFLOW_ANDROID_EXPECTED_CERT_SHA256:")));
  assert.ok(result.errors.some((error) => error.startsWith("OUTFLOW_ANDROID_EXPECTED_COMMIT:")));
  assert.ok(result.errors.some((error) => error.startsWith("GITHUB_SHA:")));
  assert.ok(result.errors.some((error) => error.startsWith("GITHUB_REF:")));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test("Android release preflight rejects the wrong certificate and bounds keytool failure", () => {
  const wrongCertificate = verifyAndroidReleaseEnvironment(validEnvironment, {
    root: "/workspace/outflow",
    inspectPath: () => privateKeystore,
    execute: (_command, args) => args.includes("-list") ? "Entry type: PrivateKeyEntry" : "certificate-pem",
    parseCertificate: () => ({
      fingerprint256: `${"AA:".repeat(31)}AA`,
      validFrom: "Jan 1 00:00:00 2020 GMT",
      validTo: "Jan 1 00:00:00 2021 GMT",
    }),
    now: "2026-07-20T12:00:00Z",
  });
  const unreadable = verifyAndroidReleaseEnvironment(validEnvironment, {
    root: "/workspace/outflow",
    inspectPath: () => privateKeystore,
    execute: () => {
      throw new Error(`keytool failed with ${validEnvironment.OUTFLOW_ANDROID_KEYSTORE_PASSWORD}`);
    },
  });

  assert.equal(wrongCertificate.valid, false);
  assert.match(wrongCertificate.errors.join("\n"), /does not match the independent pin/);
  assert.match(wrongCertificate.errors.join("\n"), /not currently valid/);
  assert.equal(unreadable.valid, false);
  assert.deepEqual(unreadable.errors, [
    "OUTFLOW_ANDROID_KEYSTORE_PATH: keytool could not open the configured private-key entry.",
  ]);
  assert.doesNotMatch(JSON.stringify(unreadable), /strong-store-password/);
});

test("the protected Android workflow verifies a signed candidate without retaining artifacts", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const workflow = readFileSync(new URL("../.github/workflows/android-release.yml", import.meta.url), "utf8");
  const installIndex = workflow.indexOf("name: Install locked dependencies");
  const contractsIndex = workflow.indexOf("name: Verify release contracts before secrets");
  const baselineIndex = workflow.indexOf("name: Build and inspect unsigned baseline");
  const keyIndex = workflow.indexOf("name: Materialize private upload keystore");
  const cleanupIndex = workflow.indexOf("name: Remove upload keystore");
  const inspectIndex = workflow.indexOf("name: Inspect fingerprint-pinned signed release");
  const evidenceIndex = workflow.indexOf("name: Record bounded release evidence");

  assert.equal(
    packageJson.scripts["check:mobile:android-release-environment"],
    "node scripts/check-android-release-environment.mjs",
  );
  assert.equal(packageJson.scripts["test:mobile:android-release"], "node --test tests/android-release.test.js");
  assert.match(workflow, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):/m);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: android-production/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /OUTFLOW_ANDROID_EXPECTED_COMMIT: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /^\s{6}OUTFLOW_ANDROID_KEYSTORE_PATH:/m);
  assert.equal(workflow.match(/OUTFLOW_ANDROID_KEYSTORE_PATH: \$\{\{ runner\.temp \}\}/g)?.length, 4);
  assert.equal(workflow.match(/secrets\.OUTFLOW_ANDROID_KEYSTORE_BASE64/g)?.length, 1);
  assert.equal(workflow.match(/secrets\.OUTFLOW_ANDROID_KEYSTORE_PASSWORD/g)?.length, 2);
  assert.equal(workflow.match(/secrets\.OUTFLOW_ANDROID_KEY_PASSWORD/g)?.length, 2);
  assert.match(workflow, /npm run check:mobile:android-release-environment/);
  assert.match(workflow, /OUTFLOW_ANDROID_EXPECT_SIGNED: "true"/);
  assert.doesNotMatch(workflow, /upload-artifact|gh release|play-service|VITE_/i);
  assert.match(workflow, /app-universal-release\.apk/);
  assert.match(workflow, /app-universal-release\.aab/);
  assert.match(workflow, /mapping\.txt/);
  assert.ok(installIndex < contractsIndex && contractsIndex < baselineIndex && baselineIndex < keyIndex);
  assert.ok(keyIndex < cleanupIndex && cleanupIndex < inspectIndex && inspectIndex < evidenceIndex);
});
