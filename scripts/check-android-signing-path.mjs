import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const javaTool = (name) => process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? `${name}.exe` : name)
  : name;
const gradle = resolve("src-tauri/gen/android", process.platform === "win32" ? "gradlew.bat" : "gradlew");
const signingNames = [
  "OUTFLOW_ANDROID_KEYSTORE_PATH",
  "OUTFLOW_ANDROID_KEYSTORE_PASSWORD",
  "OUTFLOW_ANDROID_KEY_ALIAS",
  "OUTFLOW_ANDROID_KEY_PASSWORD",
];
const cleanEnvironment = { ...process.env };
signingNames.forEach((name) => delete cleanEnvironment[name]);
delete cleanEnvironment.OUTFLOW_ANDROID_EXPECT_SIGNED;
delete cleanEnvironment.OUTFLOW_ANDROID_EXPECTED_CERT_SHA256;

const partial = spawnSync(gradle, ["help", "--no-daemon"], {
  cwd: resolve("src-tauri/gen/android"),
  env: {
    ...cleanEnvironment,
    OUTFLOW_ANDROID_KEYSTORE_PATH: resolve("missing-test-keystore.jks"),
  },
  encoding: "utf8",
});
assert.notEqual(partial.status, 0, "partial Android signing configuration must fail closed");
assert.match(`${partial.stdout}\n${partial.stderr}`, /Android release signing requires a complete Outflow signing environment\./);

const temporaryDirectory = mkdtempSync(join(tmpdir(), "outflow-android-signing-"));
const keystorePath = join(temporaryDirectory, "outflow-test-release.jks");
const password = randomBytes(24).toString("hex");
const alias = "outflow-test-release";

try {
  execFileSync(javaTool("keytool"), [
    "-genkeypair",
    "-keystore", keystorePath,
    "-storepass", password,
    "-keypass", password,
    "-alias", alias,
    "-keyalg", "RSA",
    "-keysize", "2048",
    "-validity", "3650",
    "-dname", "CN=Outflow CI Release Path, O=Outflow Test, C=CA",
  ], { stdio: "pipe" });

  const signingEnvironment = {
    ...cleanEnvironment,
    OUTFLOW_ANDROID_KEYSTORE_PATH: keystorePath,
    OUTFLOW_ANDROID_KEYSTORE_PASSWORD: password,
    OUTFLOW_ANDROID_KEY_ALIAS: alias,
    OUTFLOW_ANDROID_KEY_PASSWORD: password,
  };
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "mobile:android:release"], {
    env: signingEnvironment,
    stdio: "inherit",
  });

  const certificate = execFileSync(javaTool("keytool"), [
    "-list",
    "-v",
    "-keystore", keystorePath,
    "-storepass", password,
    "-alias", alias,
  ], { encoding: "utf8" });
  const fingerprint = certificate.match(/SHA256:\s*([A-F0-9:]+)/i)?.[1]?.replaceAll(":", "");
  assert.match(fingerprint || "", /^[A-F0-9]{64}$/i, "temporary signing certificate fingerprint is unavailable");

  execFileSync(process.execPath, ["scripts/check-android-release.mjs"], {
    env: {
      ...signingEnvironment,
      OUTFLOW_ANDROID_EXPECT_SIGNED: "true",
      OUTFLOW_ANDROID_EXPECTED_CERT_SHA256: fingerprint,
    },
    stdio: "inherit",
  });
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Verified the fail-closed Outflow Android signing path with a disposable test certificate");
