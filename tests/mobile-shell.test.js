import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("the generated iOS target preserves Outflow identity and mobile coverage", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));
  const iosConfig = JSON.parse(read("src-tauri/tauri.ios.conf.json"));
  const project = read("src-tauri/gen/apple/project.yml");
  const xcodeProject = read("src-tauri/gen/apple/outflow.xcodeproj/project.pbxproj");
  const info = read("src-tauri/gen/apple/outflow_iOS/Info.plist");
  const main = read("src-tauri/gen/apple/Sources/outflow/main.mm");
  const launchScreen = read("src-tauri/gen/apple/LaunchScreen.storyboard");
  const privacyManifest = read("src-tauri/PrivacyInfo.xcprivacy");

  assert.equal(config.productName, "Outflow");
  assert.equal(config.identifier, "com.thedudeb.outflow");
  assert.equal(config.app.windows[0].url, "index.html#app");
  assert.equal(iosConfig.bundle.iOS.minimumSystemVersion, "14.0");
  assert.match(project, /deploymentTarget:\n\s+iOS: 14\.0/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER: com\.thedudeb\.outflow/);
  assert.match(project, /outflow_iOS:\n\s+type: application\n\s+platform: iOS/);
  assert.match(project, /UIInterfaceOrientationPortrait/);
  assert.match(project, /UIInterfaceOrientationLandscapeLeft/);
  assert.match(project, /npm run -- tauri ios xcode-script/);
  assert.match(xcodeProject, /"TEMP_OUTFLOW_X86_64"/);
  assert.doesNotMatch(xcodeProject, /"TEMP_[A-F0-9-]+"/);
  assert.match(info, /<key>CFBundleName<\/key>\s*<string>\$\(PRODUCT_NAME\)<\/string>/);
  assert.match(info, /<key>UILaunchStoryboardName<\/key>\s*<string>LaunchScreen<\/string>/);
  assert.match(main, /ffi::start_app\(\)/);
  assert.match(launchScreen, /red="0\.031372549019607843" green="0\.035294117647058823" blue="0\.039215686274509803"/);
  assert.doesNotMatch(launchScreen, /systemBackgroundColor|white="1"/);
  assert.match(privacyManifest, /NSPrivacyTracking/);
  assert.match(privacyManifest, /<false\/>/);
  assert.match(privacyManifest, /C617\.1/);
});

test("the iOS app icon catalog is complete and generated from Outflow artwork", () => {
  const catalog = JSON.parse(read("src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/Contents.json"));
  const images = catalog.images;

  assert.equal(images.length, 18);
  assert.ok(images.some(({ idiom, size, scale }) => idiom === "ios-marketing" && size === "1024x1024" && scale === "1x"));
  assert.ok(images.some(({ idiom, size, scale }) => idiom === "iphone" && size === "60x60" && scale === "3x"));
  assert.ok(images.some(({ idiom, size, scale }) => idiom === "ipad" && size === "83.5x83.5" && scale === "2x"));

  images.forEach(({ filename }) => {
    const iconUrl = new URL(`src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/${filename}`, root);
    assert.equal(existsSync(iconUrl), true, `${filename} is missing`);
    assert.ok(statSync(iconUrl).size > 100, `${filename} is empty`);
    assert.deepEqual([...readFileSync(iconUrl).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  });
});

test("the iOS native boundary stays notification-only and has a clean build gate", () => {
  const packageJson = JSON.parse(read("package.json"));
  const capability = JSON.parse(read("src-tauri/capabilities/main-notifications.json"));
  const entitlements = read("src-tauri/gen/apple/outflow_iOS/outflow_iOS.entitlements");
  const backend = read("src-tauri/src/lib.rs");
  const app = read("src/App.jsx");
  const initializer = read("scripts/init-ios-project.mjs");
  const quality = read(".github/workflows/quality.yml");

  assert.equal(packageJson.scripts.tauri, "tauri");
  assert.equal(packageJson.scripts["mobile:ios:init"], "node scripts/init-ios-project.mjs");
  assert.equal(packageJson.scripts["mobile:ios:build"], "tauri ios build --ci --debug --target aarch64-sim --no-sign");
  assert.equal(packageJson.scripts["mobile:ios:release"], "node scripts/build-ios-release.mjs");
  assert.equal(packageJson.scripts["check:mobile:ios-bundle"], "node scripts/check-ios-bundle.mjs");
  assert.equal(packageJson.scripts["check:mobile:ios-privacy"], "node scripts/check-ios-privacy.mjs");
  assert.equal(packageJson.scripts["check:mobile:ios-release"], "node scripts/check-ios-release.mjs");
  assert.equal(packageJson.scripts["check:mobile:ios-release-environment"], "node scripts/check-ios-release-environment.mjs");
  assert.equal(packageJson.scripts["test:mobile:ios-release"], "node --test tests/ios-release.test.js");
  assert.deepEqual(capability.permissions, [
    "notification:allow-is-permission-granted",
    "notification:allow-request-permission",
    "notification:allow-notify",
  ]);
  assert.match(entitlements, /<dict\s*\/>/);
  assert.doesNotMatch(entitlements, /keychain|network|application-groups|icloud|healthkit/i);
  assert.match(backend, /#\[cfg_attr\(mobile, tauri::mobile_entry_point\)\]/);
  assert.match(backend, /tauri_plugin_notification::init\(\)/);
  assert.match(backend, /#\[cfg\(target_os = "macos"\)\]/);
  assert.doesNotMatch(backend, /invoke_handler|Command|http|shell/);
  assert.match(app, /pwa\.nativeApp \? "Native local" : "Offline ready"/);
  assert.match(initializer, /execFileSync\(tauri, \["ios", "init", "--ci"/);
  assert.match(initializer, /generated launch screen background changed/);
  assert.match(initializer, /Outflow launch color was not applied/);
  assert.match(quality, /ios:\n\s+runs-on: macos-latest/);
  assert.match(quality, /rustup target add aarch64-apple-ios-sim/);
  assert.match(quality, /npm run test:mobile-shell/);
  assert.match(quality, /npm run test:mobile:ios-release/);
  assert.match(quality, /npm run test:mobile:ios-privacy/);
  assert.match(quality, /npm run check:mobile:ios-privacy/);
  assert.match(quality, /npm run mobile:ios:build/);
  assert.match(quality, /npm run check:mobile:ios-bundle/);
});

test("the generated Android target preserves Outflow identity and mobile coverage", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));
  const androidConfig = JSON.parse(read("src-tauri/tauri.android.conf.json"));
  const gradle = read("src-tauri/gen/android/app/build.gradle.kts");
  const manifest = read("src-tauri/gen/android/app/src/main/AndroidManifest.xml");
  const activity = read("src-tauri/gen/android/app/src/main/java/com/thedudeb/outflow/MainActivity.kt");
  const strings = read("src-tauri/gen/android/app/src/main/res/values/strings.xml");
  const colors = read("src-tauri/gen/android/app/src/main/res/values/colors.xml");
  const theme = read("src-tauri/gen/android/app/src/main/res/values/themes.xml");
  const android12Theme = read("src-tauri/gen/android/app/src/main/res/values-v31/themes.xml");

  assert.equal(config.productName, "Outflow");
  assert.equal(config.identifier, "com.thedudeb.outflow");
  assert.equal(config.app.windows[0].url, "index.html#app");
  assert.equal(androidConfig.bundle.android.minSdkVersion, 24);
  assert.match(gradle, /compileSdk = 36/);
  assert.match(gradle, /namespace = "com\.thedudeb\.outflow"/);
  assert.match(gradle, /applicationId = "com\.thedudeb\.outflow"/);
  assert.match(gradle, /minSdk = 24/);
  assert.match(gradle, /targetSdk = 36/);
  assert.match(gradle, /applicationIdSuffix = "\.debug"/);
  assert.match(manifest, /android:name="\.MainActivity"/);
  assert.match(manifest, /android:name="android\.intent\.category\.LAUNCHER"/);
  assert.doesNotMatch(manifest, /LEANBACK|android\.software\.leanback/);
  assert.match(activity, /class MainActivity : TauriActivity\(\)/);
  assert.match(activity, /super\.onCreate\(savedInstanceState\)/);
  assert.match(activity, /AppUpdateManagerFactory\.create\(this\)/);
  assert.match(activity, /AppUpdateType\.FLEXIBLE/);
  assert.match(activity, /UpdateAvailability\.UPDATE_AVAILABLE/);
  assert.match(activity, /BuildConfig\.DEBUG/);
  assert.match(activity, /Outflow update ready/);
  assert.match(activity, /setAction\("Restart"\)/);
  assert.doesNotMatch(activity, /AppUpdateType\.IMMEDIATE/);
  assert.equal((gradle.match(/com\.google\.android\.play:app-update:2\.1\.0/g) || []).length, 1);
  assert.doesNotMatch(activity, /enableEdgeToEdge/);
  assert.match(strings, /<string name="app_name">"Outflow"<\/string>/);
  assert.match(colors, /<color name="outflow_background">#FF08090A<\/color>/);
  assert.doesNotMatch(colors, /purple|teal/i);
  assert.match(theme, /android:windowBackground">@color\/outflow_background/);
  assert.match(android12Theme, /android:windowSplashScreenBackground">@color\/outflow_background/);
  assert.match(android12Theme, /android:windowSplashScreenAnimatedIcon">@mipmap\/ic_launcher_foreground/);
});

test("the Android launcher catalog is complete and generated from Outflow artwork", () => {
  const densities = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
  const variants = ["ic_launcher.png", "ic_launcher_foreground.png", "ic_launcher_round.png"];

  densities.forEach((density) => {
    variants.forEach((variant) => {
      const iconUrl = new URL(`src-tauri/gen/android/app/src/main/res/mipmap-${density}/${variant}`, root);
      assert.equal(existsSync(iconUrl), true, `${density}/${variant} is missing`);
      assert.ok(statSync(iconUrl).size > 500, `${density}/${variant} is empty`);
      assert.deepEqual([...readFileSync(iconUrl).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    });
  });
});

test("the Android native boundary is private, store-updated, and CI built", () => {
  const packageJson = JSON.parse(read("package.json"));
  const capability = JSON.parse(read("src-tauri/capabilities/main-notifications.json"));
  const manifest = read("src-tauri/gen/android/app/src/main/AndroidManifest.xml");
  const filePaths = read("src-tauri/gen/android/app/src/main/res/xml/file_paths.xml");
  const mainNetwork = read("src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml");
  const debugNetwork = read("src-tauri/gen/android/app/src/debug/res/xml/network_security_config.xml");
  const backend = read("src-tauri/src/lib.rs");
  const initializer = read("scripts/init-android-project.mjs");
  const inspector = read("scripts/check-android-bundle.mjs");
  const releaseInspector = read("scripts/check-android-release.mjs");
  const signingHarness = read("scripts/check-android-signing-path.mjs");
  const gradle = read("src-tauri/gen/android/app/build.gradle.kts");
  const activity = read("src-tauri/gen/android/app/src/main/java/com/thedudeb/outflow/MainActivity.kt");
  const wrapperProperties = read("src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties");
  const wrapperJar = readFileSync(new URL("src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar", root));
  const quality = read(".github/workflows/quality.yml");

  assert.equal(packageJson.scripts["mobile:android:init"], "node scripts/init-android-project.mjs");
  assert.equal(packageJson.scripts["mobile:android:build"], "tauri android build --ci --debug --target aarch64 --apk");
  assert.equal(packageJson.scripts["mobile:android:release"], "node scripts/build-android-release.mjs");
  assert.equal(packageJson.scripts["check:mobile:android-bundle"], "node scripts/check-android-bundle.mjs");
  assert.equal(packageJson.scripts["check:mobile:android-release"], "node scripts/check-android-release.mjs");
  assert.equal(packageJson.scripts["test:mobile:android-signing"], "node scripts/check-android-signing-path.mjs");
  assert.deepEqual(capability.permissions, [
    "notification:allow-is-permission-granted",
    "notification:allow-request-permission",
    "notification:allow-notify",
  ]);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:fullBackupContent="false"/);
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(manifest, /android\.permission\.RECEIVE_BOOT_COMPLETED" tools:node="remove"/);
  assert.match(manifest, /android\.permission\.WAKE_LOCK" tools:node="remove"/);
  assert.match(manifest, /TimedNotificationPublisher" tools:node="remove"/);
  assert.match(manifest, /LocalNotificationRestoreReceiver" tools:node="remove"/);
  assert.doesNotMatch(manifest, /READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|ACCESS_FINE_LOCATION|CAMERA|RECORD_AUDIO|READ_CONTACTS/);
  assert.match(filePaths, /<cache-path name="outflow_cache" path="\." \/>/);
  assert.doesNotMatch(filePaths, /external-path|external-files-path/);
  assert.match(mainNetwork, /<base-config cleartextTrafficPermitted="false" \/>/);
  assert.doesNotMatch(mainNetwork, /domain-config/);
  assert.match(debugNetwork, /<domain includeSubdomains="false">10\.0\.2\.2<\/domain>/);
  assert.match(debugNetwork, /<domain includeSubdomains="false">localhost<\/domain>/);
  assert.doesNotMatch(debugNetwork, /includeSubdomains="true"/);
  assert.match(backend, /#\[cfg_attr\(mobile, tauri::mobile_entry_point\)\]/);
  assert.match(backend, /tauri_plugin_notification::init\(\)/);
  assert.match(backend, /#\[cfg\(target_os = "macos"\)\]/);
  assert.doesNotMatch(backend, /invoke_handler|Command|http|shell/);
  assert.match(initializer, /execFileSync\(tauri, \["android", "init", "--ci"/);
  assert.match(initializer, /generated Android compile SDK changed/);
  assert.match(initializer, /Generated the hardened Outflow Android project/);
  assert.match(initializer, /com\.google\.android\.play:app-update:2\.1\.0/);
  assert.match(initializer, /AppUpdateManagerFactory/);
  assert.match(activity, /registerListener\(updateListener\)/);
  assert.match(activity, /unregisterListener\(updateListener\)/);
  assert.match(activity, /updatePromptedThisSession/);
  assert.match(activity, /startUpdateFlowForResult/);
  assert.match(activity, /completeUpdate\(\)/);
  assert.match(inspector, /Signer #1 certificate DN: .*CN=Android Debug/);
  assert.match(inspector, /"-P", "16"/);
  assert.match(releaseInspector, /release-readiness APK must remain unsigned/);
  assert.match(releaseInspector, /APK signing certificate does not match the pinned fingerprint/);
  assert.match(releaseInspector, /BUNDLE-METADATA\/com\.android\.tools\.build\.obfuscation\/proguard\.map/);
  assert.match(releaseInspector, /android:usesCleartextTraffic=/);
  assert.match(releaseInspector, /"-P", "16"/);
  assert.match(gradle, /getByName\("release"\) \{[\s\S]+signingConfig = signingConfigs\.getByName\("outflowRelease"\)[\s\S]+isMinifyEnabled = true/);
  assert.equal((gradle.match(/val releaseKeystorePath/g) || []).length, 1);
  assert.equal((gradle.match(/signingConfigs \{/g) || []).length, 1);
  assert.match(initializer, /replaceAll\(releaseSigningValues, ""\)/);
  assert.match(signingHarness, /partial Android signing configuration must fail closed/);
  assert.match(signingHarness, /mkdtempSync/);
  assert.match(signingHarness, /check-android-release-environment\.mjs/);
  assert.match(signingHarness, /OUTFLOW_ANDROID_EXPECTED_CERT_SHA256/);
  assert.match(wrapperProperties, /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-8\.14\.3-bin\.zip/);
  assert.match(wrapperProperties, /distributionSha256Sum=bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531/);
  assert.equal(
    createHash("sha256").update(wrapperJar).digest("hex"),
    "7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172",
  );
  assert.match(quality, /android:\n\s+runs-on: ubuntu-latest/);
  assert.match(quality, /NDK_HOME: \/usr\/local\/lib\/android\/sdk\/ndk\/27\.2\.12479018/);
  assert.match(quality, /"\$ANDROID_HOME\/cmdline-tools\/latest\/bin\/sdkmanager"/);
  assert.match(quality, /"platforms;android-36"/);
  assert.match(quality, /"build-tools;36\.0\.0"/);
  assert.match(quality, /"ndk;27\.2\.12479018"/);
  assert.match(quality, /rustup target add aarch64-linux-android/);
  assert.match(quality, /npm run test:mobile:android-release/);
  assert.match(quality, /npm run mobile:android:build/);
  assert.match(quality, /npm run check:mobile:android-bundle/);
  assert.match(quality, /npm run mobile:android:release/);
  assert.match(quality, /npm run check:mobile:android-release/);
  assert.match(quality, /npm run test:mobile:android-signing/);
});
