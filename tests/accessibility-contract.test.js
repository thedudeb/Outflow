import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("production web and PWA releases keep the WCAG 2.2 regression gates", () => {
  const packageJson = JSON.parse(read("package.json"));
  const accessibility = read("tests/e2e/accessibility.spec.js");
  const pwa = read("tests/pwa/pwa.spec.js");
  const deployment = read("tests/deployment/live-web.spec.js");
  const quality = read(".github/workflows/quality.yml");
  const deploy = read(".github/workflows/deploy-pages.yml");

  assert.equal(packageJson.scripts["test:a11y"], "playwright test tests/e2e/accessibility.spec.js");
  assert.equal(packageJson.scripts["test:accessibility-contract"], "node --test tests/accessibility-contract.test.js");
  assert.match(accessibility, /wcag22aa/);
  assert.match(accessibility, /WCAG 2\.2 minimum target size/);
  assert.match(accessibility, /user text spacing does not clip/);
  assert.match(accessibility, /forced colors are active/);
  assert.match(pwa, /AxeBuilder/);
  assert.match(pwa, /production landing, privacy, tracker, and offline states meet the WCAG A and AA gate/);
  assert.match(deployment, /AxeBuilder/);
  assert.match(deployment, /expectNoWcagViolations/);
  assert.match(quality, /npm run test:e2e/);
  assert.match(quality, /npm run test:pwa/);
  assert.match(deploy, /npm run test:pwa:pages/);
  assert.match(deploy, /npm run test:web-deployment/);
});

test("every release platform retains the shared accessibility contract", () => {
  const quality = read(".github/workflows/quality.yml");
  const app = read("src/App.jsx");
  const desktopConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
  const androidActivity = read("src-tauri/gen/android/app/src/main/java/com/thedudeb/outflow/MainActivity.kt");
  const acceptance = read("docs/accessibility-acceptance.md");
  const accessibility = read("docs/accessibility.md");
  const desktop = read("docs/native-desktop.md");
  const mobile = read("docs/native-mobile.md");

  assert.equal((quality.match(/npm run test:accessibility-contract/g) || []).length, 4);
  assert.equal(desktopConfig.app.windows[0].resizable, true);
  assert.ok(desktopConfig.app.windows[0].minWidth <= 360);
  assert.match(app, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(app, /aria-disabled=\{pwa\.updateBusy\}/);
  assert.match(app, /aria-busy=\{pwa\.updateBusy\}/);
  assert.match(app, /<LiveMessage className="sr-only">\{pwa\.updateLabel\}<\/LiveMessage>/);
  assert.match(androidActivity, /Snackbar[\s\S]+"Outflow update ready"[\s\S]+setAction\("Restart"\)/);
  ["VoiceOver", "NVDA", "TalkBack", "Switch Control", "Switch Access", "200%"].forEach((term) => {
    assert.match(acceptance, new RegExp(term.replace("%", "%")));
  });
  assert.match(acceptance, /Web and Installed PWA/);
  assert.match(acceptance, /macOS client/);
  assert.match(acceptance, /iPhone and iPad/);
  assert.match(acceptance, /Android phone and tablet/);
  assert.match(acceptance, /Blocker/);
  assert.match(accessibility, /accessibility-acceptance\.md/);
  assert.match(desktop, /accessibility-acceptance\.md/);
  assert.match(mobile, /accessibility-acceptance\.md/);
});
