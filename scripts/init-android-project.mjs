import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const gradleVersion = "8.14.3";
const gradleDistributionSha256 = "bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531";
const gradleWrapperSha256 = "7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172";

const tauri = resolve("node_modules/.bin/tauri");
execFileSync(tauri, ["android", "init", "--ci", ...process.argv.slice(2)], { stdio: "inherit" });

const androidRoot = resolve("src-tauri/gen/android/app/src");
const manifestPath = resolve(androidRoot, "main/AndroidManifest.xml");
const gradlePath = resolve("src-tauri/gen/android/app/build.gradle.kts");
const gradleRoot = resolve("src-tauri/gen/android");
const gradleWrapperPropertiesPath = resolve(gradleRoot, "gradle/wrapper/gradle-wrapper.properties");
const gradleWrapperJarPath = resolve(gradleRoot, "gradle/wrapper/gradle-wrapper.jar");
const generatedManifest = readFileSync(manifestPath, "utf8");
const generatedGradle = readFileSync(gradlePath, "utf8");

assert.match(generatedManifest, /android\.permission\.INTERNET/, "generated Android network permission changed");
assert.match(generatedManifest, /androidx\.core\.content\.FileProvider/, "generated Android file provider changed");
assert.match(generatedGradle, /compileSdk = 36/, "generated Android compile SDK changed");
assert.match(generatedGradle, /targetSdk = 36/, "generated Android target SDK changed");

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" tools:node="remove" />
    <uses-permission android:name="android.permission.WAKE_LOCK" tools:node="remove" />

    <application
        android:allowBackup="false"
        android:fullBackupContent="false"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:networkSecurityConfig="@xml/network_security_config"
        android:theme="@style/Theme.outflow"
        android:usesCleartextTraffic="\${usesCleartextTraffic}">
        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:exported="true"
            android:label="@string/main_activity_title"
            android:launchMode="singleTask"
            android:name=".MainActivity">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <provider
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true"
            android:name="androidx.core.content.FileProvider">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>

        <receiver android:name="app.tauri.notification.TimedNotificationPublisher" tools:node="remove" />
        <receiver android:name="app.tauri.notification.LocalNotificationRestoreReceiver" tools:node="remove" />
    </application>
</manifest>
`;

const colors = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="outflow_background">#FF08090A</color>
    <color name="outflow_accent">#FFF2B84B</color>
</resources>
`;

const theme = `<resources>
    <style name="Theme.outflow" parent="Theme.MaterialComponents.DayNight.NoActionBar">
        <item name="android:colorAccent">@color/outflow_accent</item>
        <item name="android:navigationBarColor">@color/outflow_background</item>
        <item name="android:statusBarColor">@color/outflow_background</item>
        <item name="android:windowActionModeOverlay">true</item>
        <item name="android:windowBackground">@color/outflow_background</item>
        <item name="android:windowLightNavigationBar">false</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowNoTitle">true</item>
    </style>
</resources>
`;

const android12Theme = `<resources>
    <style name="Theme.outflow" parent="Theme.MaterialComponents.DayNight.NoActionBar">
        <item name="android:colorAccent">@color/outflow_accent</item>
        <item name="android:navigationBarColor">@color/outflow_background</item>
        <item name="android:statusBarColor">@color/outflow_background</item>
        <item name="android:windowBackground">@color/outflow_background</item>
        <item name="android:windowLightNavigationBar">false</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowNoTitle">true</item>
        <item name="android:windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="android:windowSplashScreenAnimationDuration">0</item>
        <item name="android:windowSplashScreenBackground">@color/outflow_background</item>
    </style>
</resources>
`;

const layout = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:background="@color/outflow_background"
    android:layout_height="match_parent"
    android:layout_width="match_parent" />
`;

const filePaths = `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <cache-path name="outflow_cache" path="." />
</paths>
`;

const networkSecurity = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
`;

const activity = `package com.thedudeb.outflow

import android.os.Bundle

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
  }
}
`;

const debugNetworkSecurity = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
</network-security-config>
`;

mkdirSync(resolve(androidRoot, "main/res/values-v31"), { recursive: true });
mkdirSync(resolve(androidRoot, "debug/res/xml"), { recursive: true });
writeFileSync(manifestPath, manifest);
writeFileSync(resolve(androidRoot, "main/res/values/colors.xml"), colors);
writeFileSync(resolve(androidRoot, "main/res/values/themes.xml"), theme);
writeFileSync(resolve(androidRoot, "main/res/values-night/themes.xml"), theme);
writeFileSync(resolve(androidRoot, "main/res/values-v31/themes.xml"), android12Theme);
writeFileSync(resolve(androidRoot, "main/res/layout/activity_main.xml"), layout);
writeFileSync(resolve(androidRoot, "main/res/xml/file_paths.xml"), filePaths);
writeFileSync(resolve(androidRoot, "main/res/xml/network_security_config.xml"), networkSecurity);
writeFileSync(resolve(androidRoot, "debug/res/xml/network_security_config.xml"), debugNetworkSecurity);
writeFileSync(resolve(androidRoot, "main/java/com/thedudeb/outflow/MainActivity.kt"), activity);

const normalizedGradle = generatedGradle.replace(
  "packaging {                jniLibs.keepDebugSymbols",
  "packaging {\n                jniLibs.keepDebugSymbols",
);
writeFileSync(gradlePath, normalizedGradle);

const generatedWrapperProperties = readFileSync(gradleWrapperPropertiesPath, "utf8");
assert.match(generatedWrapperProperties, new RegExp(`gradle-${gradleVersion.replaceAll(".", "\\.")}-bin\\.zip`));
const pinnedWrapperProperties = generatedWrapperProperties.includes("distributionSha256Sum=")
  ? generatedWrapperProperties.replace(/^distributionSha256Sum=.*$/m, `distributionSha256Sum=${gradleDistributionSha256}`)
  : generatedWrapperProperties.replace(
    "distributionBase=GRADLE_USER_HOME\n",
    `distributionBase=GRADLE_USER_HOME\ndistributionSha256Sum=${gradleDistributionSha256}\n`,
  );
writeFileSync(gradleWrapperPropertiesPath, pinnedWrapperProperties);

const gradleWrapper = process.platform === "win32" ? resolve(gradleRoot, "gradlew.bat") : resolve(gradleRoot, "gradlew");
execFileSync(gradleWrapper, [
  "wrapper",
  `--gradle-version=${gradleVersion}`,
  "--distribution-type=bin",
  `--gradle-distribution-sha256-sum=${gradleDistributionSha256}`,
], { cwd: gradleRoot, stdio: "inherit" });

const wrapperDigest = createHash("sha256").update(readFileSync(gradleWrapperJarPath)).digest("hex");
assert.equal(wrapperDigest, gradleWrapperSha256, "generated Gradle wrapper JAR does not match the official release");

[
  gradlePath,
  resolve(gradleRoot, "build.gradle.kts"),
  resolve(gradleRoot, "buildSrc/build.gradle.kts"),
  resolve(gradleRoot, "buildSrc/src/main/java/com/thedudeb/outflow/kotlin/BuildTask.kt"),
  resolve(gradleRoot, "buildSrc/src/main/java/com/thedudeb/outflow/kotlin/RustPlugin.kt"),
  resolve(gradleRoot, "gradlew"),
  resolve(gradleRoot, "gradlew.bat"),
  resolve(gradleRoot, "settings.gradle"),
].forEach((path) => {
  const normalized = `${readFileSync(path, "utf8")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trimEnd()}\n`;
  writeFileSync(path, normalized);
});

assert.doesNotMatch(manifest, /external-path|LEANBACK_LAUNCHER/);
assert.match(manifest, /android:allowBackup="false"/);
assert.match(normalizedGradle, /packaging \{\n\s+jniLibs\.keepDebugSymbols/);
console.log("Generated the hardened Outflow Android project");
