import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const apkPath = resolve(
  process.env.OUTFLOW_ANDROID_APK_PATH
    || "src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk",
);
const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;

assert.ok(sdkRoot, "ANDROID_HOME or ANDROID_SDK_ROOT is required");
assert.equal(existsSync(apkPath), true, `Android APK is missing at ${apkPath}`);
assert.ok(statSync(apkPath).size > 5_000_000, "Android APK is unexpectedly small");

const analyzer = join(sdkRoot, "cmdline-tools", "latest", "bin", "apkanalyzer");
const buildTools = join(sdkRoot, "build-tools", "36.0.0");
const zipalign = join(buildTools, "zipalign");
const apksigner = join(buildTools, "apksigner");
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
  ...options,
}).trim();
const analyze = (subject, verb) => run(analyzer, [subject, verb, apkPath]);

assert.equal(analyze("manifest", "application-id"), "com.thedudeb.outflow.debug");
assert.equal(analyze("manifest", "version-name"), "0.1.0");
assert.equal(analyze("manifest", "version-code"), "1000");
assert.equal(analyze("manifest", "min-sdk"), "24");
assert.equal(analyze("manifest", "target-sdk"), "36");
assert.equal(analyze("manifest", "debuggable"), "true");

const permissions = analyze("manifest", "permissions").split("\n").filter(Boolean);
assert.ok(permissions.includes("android.permission.INTERNET"));
assert.ok(permissions.includes("android.permission.POST_NOTIFICATIONS"));
assert.ok(permissions.includes("com.thedudeb.outflow.debug.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"));
[
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.WAKE_LOCK",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_CONTACTS",
].forEach((permission) => assert.ok(!permissions.includes(permission), `${permission} must not be packaged`));

const manifest = analyze("manifest", "print");
assert.match(manifest, /android:allowBackup="false"/);
assert.match(manifest, /android:name="com\.thedudeb\.outflow\.MainActivity"/);
assert.match(manifest, /android:name="app\.tauri\.notification\.NotificationDismissReceiver"/);
assert.doesNotMatch(manifest, /TimedNotificationPublisher|LocalNotificationRestoreReceiver|LEANBACK_LAUNCHER/);

const files = analyze("files", "list");
assert.match(files, /^\/lib\/arm64-v8a\/liboutflow_lib\.so$/m);
assert.doesNotMatch(files, /^\/lib\/(armeabi-v7a|x86|x86_64)\//m);
assert.match(files, /^\/assets\/tauri\.conf\.json$/m);

execFileSync(zipalign, ["-c", "-P", "16", "4", apkPath], { stdio: "pipe" });
const signature = run(apksigner, ["verify", "--verbose", "--print-certs", apkPath]);
assert.match(signature, /Verified using v2 scheme \(APK Signature Scheme v2\): true/);
assert.match(signature, /Signer #1 certificate DN: .*CN=Android Debug/);

console.log(`Verified the debug-signed, 16 KB-aligned Outflow Android APK at ${apkPath}`);
