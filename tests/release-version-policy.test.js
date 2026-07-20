import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("shared and native product versions stay aligned", () => {
  const packageJson = JSON.parse(read("package.json"));
  const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));

  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(tauri.version, packageJson.version);
  assert.equal(tauri.productName, "Outflow");
  assert.equal(tauri.identifier, "com.thedudeb.outflow");
});

test("release workflows and documentation enforce immutable platform versions", () => {
  const policy = read("docs/release-versioning.md");
  const quality = read(".github/workflows/quality.yml");
  const macos = read(".github/workflows/macos-release.yml");
  const ios = read(".github/workflows/ios-release.yml");
  const android = read(".github/workflows/android-release.yml");

  [quality, macos, ios, android].forEach((workflow) => {
    assert.match(workflow, /npm run test:release-version-policy/);
  });
  assert.match(policy, /package\.json/);
  assert.match(policy, /src-tauri\/tauri\.conf\.json/);
  assert.match(policy, /A released version is immutable/);
  assert.match(policy, /versionCode/);
  assert.match(policy, /App Store build number/);
  assert.match(policy, /service worker cache fingerprint/);
  assert.match(policy, /forward migration/);
});
