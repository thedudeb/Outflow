import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);

function read(path) {
  return readFileSync(new URL(path, rootUrl), "utf8");
}

function directive(csp, name) {
  return csp
    .split(";")
    .map((value) => value.trim())
    .find((value) => value === name || value.startsWith(`${name} `));
}

test("the desktop shell embeds the tracker with a narrow native boundary", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));
  const mainWindow = config.app.windows.find((window) => window.label === "main");
  const csp = config.app.security.csp;

  assert.equal(config.productName, "Outflow");
  assert.equal(config.identifier, "com.thedudeb.outflow");
  assert.deepEqual(config.build, {
    frontendDist: "../dist",
    devUrl: "http://localhost:5173",
    beforeDevCommand: "npm run dev",
    beforeBuildCommand: "npm run build",
  });
  assert.equal(mainWindow.url, "index.html#app");
  assert.equal(mainWindow.resizable, true);
  assert.ok(mainWindow.minWidth <= 360);
  assert.ok(mainWindow.minHeight <= 600);

  assert.equal(config.app.security.freezePrototype, true);
  assert.equal(config.app.security.dangerousDisableAssetCspModification, false);
  assert.deepEqual(config.app.security.assetProtocol, { enable: false, scope: [] });
  assert.deepEqual(config.app.security.capabilities, ["main-notifications", "main-macos-updater"]);
  assert.equal(directive(csp, "default-src"), "default-src 'self'");
  assert.equal(directive(csp, "base-uri"), "base-uri 'self'");
  assert.equal(directive(csp, "form-action"), "form-action 'self'");
  assert.equal(directive(csp, "frame-ancestors"), "frame-ancestors 'none'");
  assert.equal(directive(csp, "object-src"), "object-src 'none'");
  assert.equal(directive(csp, "script-src"), "script-src 'self'");
  assert.equal(
    directive(csp, "connect-src"),
    "connect-src 'self' ipc: http://ipc.localhost https://*.supabase.co wss://*.supabase.co",
  );
  assert.doesNotMatch(csp, /unsafe-eval|https?:\/\/\*\b|wss?:\/\/\*\b/);

  const capabilityUrl = new URL("src-tauri/capabilities/", rootUrl);
  const capabilityFiles = existsSync(capabilityUrl)
    ? readdirSync(capabilityUrl).filter((name) => name.endsWith(".json"))
    : [];
  assert.deepEqual(capabilityFiles, ["main-macos-updater.json", "main-notifications.json"]);
  const notificationCapability = JSON.parse(read("src-tauri/capabilities/main-notifications.json"));
  const updaterCapability = JSON.parse(read("src-tauri/capabilities/main-macos-updater.json"));
  assert.equal(notificationCapability.identifier, "main-notifications");
  assert.deepEqual(notificationCapability.windows, ["main"]);
  assert.deepEqual(notificationCapability.permissions, [
    "notification:allow-is-permission-granted",
    "notification:allow-request-permission",
    "notification:allow-notify",
  ]);
  assert.equal(updaterCapability.identifier, "main-macos-updater");
  assert.deepEqual(updaterCapability.windows, ["main"]);
  assert.deepEqual(updaterCapability.platforms, ["macOS"]);
  assert.deepEqual(updaterCapability.permissions, [
    "updater:allow-check",
    "updater:allow-download-and-install",
    "process:allow-restart",
  ]);
  assert.deepEqual(config.bundle.targets, ["app"]);
  assert.equal(config.bundle.category, "Finance");
  config.bundle.icon.forEach((path) => {
    assert.equal(existsSync(new URL(`src-tauri/${path}`, rootUrl)), true, `${path} must exist`);
  });
});

test("the native backend exposes notifications plus macOS-gated update plugins and no commands", () => {
  const manifest = read("src-tauri/Cargo.toml");
  const backend = read("src-tauri/src/lib.rs");

  assert.match(manifest, /name = "outflow"/);
  assert.match(manifest, /repository = "https:\/\/github\.com\/thedudeb\/Outflow"/);
  assert.match(manifest, /tauri-build = \{ version = "=2\.6\.3"/);
  assert.match(manifest, /tauri = \{ version = "=2\.11\.5"/);
  assert.match(manifest, /tauri-plugin-notification = "=2\.3\.3"/);
  assert.match(manifest, /tauri-plugin-process = "=2\.3\.1"/);
  assert.match(manifest, /tauri-plugin-updater = "=2\.10\.1"/);
  assert.match(manifest, /serde_json = "=1\.0\.150"/);
  assert.doesNotMatch(manifest, /serde\s*=|reqwest|tokio/);
  assert.match(backend, /tauri::Builder::default\(\)/);
  assert.match(backend, /\.plugin\(tauri_plugin_notification::init\(\)\)/);
  assert.match(backend, /#\[cfg\(target_os = "macos"\)\]/);
  assert.match(backend, /tauri_plugin_updater::Builder::new\(\)\.build\(\)/);
  assert.match(backend, /tauri_plugin_process::init\(\)/);
  assert.equal(backend.match(/\.plugin\(/g)?.length, 3);
  assert.doesNotMatch(backend, /invoke_handler|Command|http|shell/);
});

test("desktop builds use the shared frontend and remain a tested release gate", () => {
  const packageJson = JSON.parse(read("package.json"));
  const macosConfig = JSON.parse(read("src-tauri/tauri.macos.conf.json"));
  const vite = read("vite.config.js");
  const app = read("src/App.jsx");
  const releaseBuilder = read("scripts/build-macos-release.mjs");
  const releaseInspector = read("scripts/check-macos-release.mjs");
  const releaseEnvironment = read("scripts/check-macos-release-environment.mjs");
  const quality = read(".github/workflows/quality.yml");

  assert.equal(packageJson.devDependencies["@tauri-apps/cli"], "2.11.4");
  assert.equal(packageJson.dependencies["@tauri-apps/plugin-notification"], "2.3.3");
  assert.equal(packageJson.dependencies["@tauri-apps/plugin-process"], "2.3.1");
  assert.equal(packageJson.dependencies["@tauri-apps/plugin-updater"], "2.10.1");
  assert.equal(packageJson.scripts["desktop:dev"], "tauri dev");
  assert.equal(packageJson.scripts["desktop:build"], "tauri build --bundles app");
  assert.equal(packageJson.scripts["desktop:release"], "node scripts/build-macos-release.mjs");
  assert.equal(packageJson.scripts["test:desktop-shell"], "node --test tests/desktop-shell.test.js");
  assert.equal(packageJson.scripts["test:desktop-release"], "node --test tests/macos-release.test.js");
  assert.equal(packageJson.scripts["test:app-updates"], "node --test tests/app-updates.test.js");
  assert.equal(packageJson.scripts["create:desktop:update-manifest"], "node scripts/create-macos-update-manifest.mjs");
  assert.equal(packageJson.scripts["check:desktop:release"], "node scripts/check-macos-release.mjs");
  assert.equal(packageJson.scripts["check:desktop:release-environment"], "node scripts/check-macos-release-environment.mjs");
  assert.deepEqual(macosConfig.bundle.macOS, { hardenedRuntime: true, signingIdentity: "-" });
  assert.match(vite, /envPrefix: \["VITE_", "TAURI_ENV_\*"\]/);
  assert.match(vite, /ignored: \["\*\*\/src-tauri\/\*\*"\]/);
  assert.match(app, /nativeApp = Boolean\(import\.meta\.env\.TAURI_ENV_PLATFORM\)/);
  assert.match(app, /!nativeApp && import\.meta\.env\.PROD/);
  assert.match(app, /pwa\.nativeApp \? "Native local" : "Offline ready"/);
  assert.match(app, /sendDeviceNotification/);
  assert.match(app, /checkForMacosUpdate/);
  assert.match(app, /installMacosUpdate/);
  assert.match(releaseBuilder, /LANG: "C"/);
  assert.match(releaseBuilder, /--keepParent/);
  assert.match(releaseBuilder, /tauriConfig\.productName/);
  assert.match(releaseBuilder, /tauriConfig\.version/);
  assert.match(releaseBuilder, /createUpdaterArtifacts: true/);
  assert.match(releaseBuilder, /universal-apple-darwin/);
  assert.doesNotMatch(releaseBuilder, /Outflow_0\.1\.0/);
  assert.match(releaseInspector, /tauriConfig\.identifier/);
  assert.match(releaseInspector, /tauriConfig\.version/);
  assert.doesNotMatch(releaseInspector, /Outflow_0\\\.1\\\.0/);
  assert.match(releaseInspector, /release-readiness app must not contain a notarization ticket/);
  assert.match(releaseInspector, /source=Notarized Developer ID/);
  assert.match(releaseEnvironment, /configure exactly one authentication mode/);
  assert.match(releaseEnvironment, /private key must be stored outside the repository/);
  assert.match(quality, /desktop:\n\s+runs-on: macos-latest/);
  assert.match(quality, /persist-credentials: false/);
  assert.match(quality, /npm run test:desktop-shell/);
  assert.match(quality, /npm run test:device-notifications/);
  assert.match(quality, /npm run test:app-updates/);
  assert.match(quality, /npm run test:desktop-release/);
  assert.match(quality, /npm run desktop:release/);
  assert.match(quality, /npm run check:desktop:release/);
  assert.doesNotMatch(quality, /VITE_SUPABASE|SUPABASE_SECRET|SERVICE_ROLE|STRIPE_|RESEND_/);
});
