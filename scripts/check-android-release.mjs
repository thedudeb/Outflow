import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const outputRoot = "src-tauri/gen/android/app/build/outputs";
const expectSigned = process.env.OUTFLOW_ANDROID_EXPECT_SIGNED === "true";
const apkPath = resolve(
  process.env.OUTFLOW_ANDROID_RELEASE_APK_PATH
    || `${outputRoot}/apk/universal/release/app-universal-release${expectSigned ? "" : "-unsigned"}.apk`,
);
const aabPath = resolve(
  process.env.OUTFLOW_ANDROID_RELEASE_AAB_PATH
    || `${outputRoot}/bundle/universalRelease/app-universal-release.aab`,
);
const mappingPath = resolve(
  process.env.OUTFLOW_ANDROID_RELEASE_MAPPING_PATH
    || `${outputRoot}/mapping/universalRelease/mapping.txt`,
);
const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;

assert.ok(sdkRoot, "ANDROID_HOME or ANDROID_SDK_ROOT is required");
[
  [apkPath, 5_000_000, "release APK"],
  [aabPath, 4_000_000, "release AAB"],
  [mappingPath, 100_000, "R8 mapping"],
].forEach(([path, minimumSize, label]) => {
  assert.equal(existsSync(path), true, `Android ${label} is missing at ${path}`);
  assert.ok(statSync(path).size > minimumSize, `Android ${label} is unexpectedly small`);
});

const analyzer = join(sdkRoot, "cmdline-tools", "latest", "bin", "apkanalyzer");
const buildTools = join(sdkRoot, "build-tools", "36.0.0");
const zipalign = join(buildTools, "zipalign");
const apksigner = join(buildTools, "apksigner");
const javaTool = (name) => process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? `${name}.exe` : name)
  : name;
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
  ...options,
}).trim();
const analyze = (subject, verb) => run(analyzer, [subject, verb, apkPath]);

assert.equal(analyze("manifest", "application-id"), "com.thedudeb.outflow");
assert.equal(analyze("manifest", "version-name"), "0.1.0");
assert.equal(analyze("manifest", "version-code"), "1000");
assert.equal(analyze("manifest", "min-sdk"), "24");
assert.equal(analyze("manifest", "target-sdk"), "36");
assert.equal(analyze("manifest", "debuggable"), "false");

const permissions = analyze("manifest", "permissions").split("\n").filter(Boolean);
assert.deepEqual(permissions.sort(), [
  "android.permission.INTERNET",
  "android.permission.POST_NOTIFICATIONS",
  "com.thedudeb.outflow.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
].sort());

const manifest = analyze("manifest", "print");
assert.match(manifest, /android:allowBackup="false"/);
assert.match(manifest, /android:usesCleartextTraffic="false"/);
assert.match(manifest, /android:name="com\.thedudeb\.outflow\.MainActivity"/);
assert.match(manifest, /android:name="app\.tauri\.notification\.NotificationDismissReceiver"/);
assert.doesNotMatch(manifest, /TimedNotificationPublisher|LocalNotificationRestoreReceiver|LEANBACK_LAUNCHER/);

const files = analyze("files", "list");
assert.match(files, /^\/lib\/arm64-v8a\/liboutflow_lib\.so$/m);
assert.doesNotMatch(files, /^\/lib\/(armeabi-v7a|x86|x86_64)\//m);
assert.match(files, /^\/assets\/tauri\.conf\.json$/m);

execFileSync(zipalign, ["-c", "-P", "16", "4", apkPath], { stdio: "pipe" });
const aabEntries = run("unzip", ["-Z1", aabPath]).split("\n").filter(Boolean);
[
  "BundleConfig.pb",
  "base/manifest/AndroidManifest.xml",
  "base/assets/tauri.conf.json",
  "base/lib/arm64-v8a/liboutflow_lib.so",
  "BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map",
].forEach((entry) => assert.ok(aabEntries.includes(entry), `${entry} is missing from the release AAB`));
assert.ok(!aabEntries.some((entry) => /^base\/lib\/(armeabi-v7a|x86|x86_64)\//.test(entry)));

const topLevelSignatures = aabEntries.filter((entry) => /^META-INF\/.*\.(RSA|DSA|EC|SF|MF)$/i.test(entry));
if (expectSigned) {
  const expectedFingerprint = String(process.env.OUTFLOW_ANDROID_EXPECTED_CERT_SHA256 || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toUpperCase();
  assert.match(expectedFingerprint, /^[A-F0-9]{64}$/, "a 32-byte expected Android certificate SHA-256 fingerprint is required");

  const apkSignature = run(apksigner, ["verify", "--verbose", "--print-certs", apkPath]);
  assert.match(apkSignature, /Verified using v2 scheme \(APK Signature Scheme v2\): true/);
  const apkFingerprint = apkSignature.match(/Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)/)?.[1]?.toUpperCase();
  assert.equal(apkFingerprint, expectedFingerprint, "APK signing certificate does not match the pinned fingerprint");

  assert.ok(topLevelSignatures.length >= 2, "signed release AAB is missing JAR signature entries");
  const aabVerification = run(javaTool("jarsigner"), ["-verify", "-certs", aabPath]);
  assert.match(aabVerification, /jar verified\./i);
  const aabCertificate = run(javaTool("keytool"), ["-printcert", "-jarfile", aabPath]);
  const aabFingerprint = aabCertificate.match(/SHA256:\s*([A-F0-9:]+)/i)?.[1]?.replaceAll(":", "").toUpperCase();
  assert.equal(aabFingerprint, expectedFingerprint, "AAB signing certificate does not match the pinned fingerprint");
} else {
  const apkSignature = spawnSync(apksigner, ["verify", "--verbose", "--print-certs", apkPath], {
    encoding: "utf8",
  });
  assert.notEqual(apkSignature.status, 0, "release-readiness APK must remain unsigned");
  assert.match(`${apkSignature.stdout}\n${apkSignature.stderr}`, /DOES NOT VERIFY|Missing META-INF\/MANIFEST\.MF/);
  assert.equal(topLevelSignatures.length, 0, "release-readiness AAB must remain unsigned");
}

console.log(`Verified the ${expectSigned ? "fingerprint-pinned signed" : "unsigned"}, minified, 16 KB-aligned Outflow Android release APK and AAB at ${outputRoot}`);
