import assert from "node:assert/strict";
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
  assert.equal(packageJson.scripts["check:mobile:ios-bundle"], "node scripts/check-ios-bundle.mjs");
  assert.deepEqual(capability.permissions, [
    "notification:allow-is-permission-granted",
    "notification:allow-request-permission",
    "notification:allow-notify",
  ]);
  assert.match(entitlements, /<dict\s*\/>/);
  assert.doesNotMatch(entitlements, /keychain|network|application-groups|icloud|healthkit/i);
  assert.match(backend, /#\[cfg_attr\(mobile, tauri::mobile_entry_point\)\]/);
  assert.match(backend, /tauri_plugin_notification::init\(\)/);
  assert.doesNotMatch(backend, /invoke_handler|Command|http|shell|process/);
  assert.match(app, /pwa\.nativeApp \? "Native local" : "Offline ready"/);
  assert.match(initializer, /execFileSync\(tauri, \["ios", "init", "--ci"/);
  assert.match(initializer, /generated launch screen background changed/);
  assert.match(initializer, /Outflow launch color was not applied/);
  assert.match(quality, /ios:\n\s+runs-on: macos-latest/);
  assert.match(quality, /rustup target add aarch64-apple-ios-sim/);
  assert.match(quality, /npm run test:mobile-shell/);
  assert.match(quality, /npm run mobile:ios:build/);
  assert.match(quality, /npm run check:mobile:ios-bundle/);
});
