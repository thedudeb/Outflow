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
  assert.deepEqual(config.app.security.capabilities, ["main-notifications"]);
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
  assert.deepEqual(capabilityFiles, ["main-notifications.json"]);
  const notificationCapability = JSON.parse(read("src-tauri/capabilities/main-notifications.json"));
  assert.equal(notificationCapability.identifier, "main-notifications");
  assert.deepEqual(notificationCapability.windows, ["main"]);
  assert.deepEqual(notificationCapability.permissions, [
    "notification:allow-is-permission-granted",
    "notification:allow-request-permission",
    "notification:allow-notify",
  ]);
  assert.deepEqual(config.bundle.targets, ["app"]);
  assert.equal(config.bundle.category, "Finance");
  config.bundle.icon.forEach((path) => {
    assert.equal(existsSync(new URL(`src-tauri/${path}`, rootUrl)), true, `${path} must exist`);
  });
});

test("the native backend exposes only the notification plugin and no commands", () => {
  const manifest = read("src-tauri/Cargo.toml");
  const backend = read("src-tauri/src/lib.rs");

  assert.match(manifest, /name = "outflow"/);
  assert.match(manifest, /repository = "https:\/\/github\.com\/thedudeb\/Outflow"/);
  assert.match(manifest, /tauri-build = \{ version = "=2\.6\.3"/);
  assert.match(manifest, /tauri = \{ version = "=2\.11\.5"/);
  assert.match(manifest, /tauri-plugin-notification = "=2\.3\.3"/);
  assert.doesNotMatch(manifest, /tauri-plugin-(?!notification)|serde|reqwest|tokio/);
  assert.match(backend, /tauri::Builder::default\(\)/);
  assert.match(backend, /\.plugin\(tauri_plugin_notification::init\(\)\)/);
  assert.equal(backend.match(/\.plugin\(/g)?.length, 1);
  assert.doesNotMatch(backend, /invoke_handler|Command|http|shell|process/);
});

test("desktop builds use the shared frontend and remain a tested release gate", () => {
  const packageJson = JSON.parse(read("package.json"));
  const vite = read("vite.config.js");
  const app = read("src/App.jsx");
  const quality = read(".github/workflows/quality.yml");

  assert.equal(packageJson.devDependencies["@tauri-apps/cli"], "2.11.4");
  assert.equal(packageJson.dependencies["@tauri-apps/plugin-notification"], "2.3.3");
  assert.equal(packageJson.scripts["desktop:dev"], "tauri dev");
  assert.equal(packageJson.scripts["desktop:build"], "tauri build --bundles app");
  assert.equal(packageJson.scripts["test:desktop-shell"], "node --test tests/desktop-shell.test.js");
  assert.match(vite, /envPrefix: \["VITE_", "TAURI_ENV_\*"\]/);
  assert.match(vite, /ignored: \["\*\*\/src-tauri\/\*\*"\]/);
  assert.match(app, /nativeApp = Boolean\(import\.meta\.env\.TAURI_ENV_PLATFORM\)/);
  assert.match(app, /!nativeApp && import\.meta\.env\.PROD/);
  assert.match(app, /pwa\.nativeApp \? "Native local" : "Offline ready"/);
  assert.match(app, /sendDeviceNotification/);
  assert.match(quality, /desktop:\n\s+runs-on: macos-latest/);
  assert.match(quality, /persist-credentials: false/);
  assert.match(quality, /npm run test:desktop-shell/);
  assert.match(quality, /npm run test:device-notifications/);
  assert.match(quality, /npm run desktop:build/);
  assert.doesNotMatch(quality, /VITE_SUPABASE|SUPABASE_SECRET|SERVICE_ROLE|STRIPE_|RESEND_/);
});
