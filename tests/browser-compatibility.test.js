import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("guest browser compatibility is a direct three-engine CI contract", async () => {
  const [config, spec, packageSource, workflow, contract, prd] = await Promise.all([
    readFile(new URL("../playwright.browser-compatibility.config.js", import.meta.url), "utf8"),
    readFile(new URL("./e2e/browser-compatibility.spec.js", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8"),
    readFile(new URL("../docs/browser-compatibility.md", import.meta.url), "utf8"),
    readFile(new URL("../prds/outflow-product-vision.md", import.meta.url), "utf8"),
  ]);

  for (const profile of ["desktop-chromium", "desktop-firefox", "desktop-webkit"]) {
    assert.match(config, new RegExp(`name: "${profile}"`));
  }
  assert.doesNotMatch(config, /mobile-(?:chromium|firefox|webkit)/);
  for (const guestSpec of [
    "browser-compatibility.spec.js",
    "free-core.spec.js",
    "internal-calendar.spec.js",
    "data-portability.spec.js",
    "calendar-export.spec.js",
    "ledger-backup.spec.js",
    "local-workspace.spec.js",
  ]) {
    assert.match(config, new RegExp(`"${guestSpec.replaceAll(".", "\\.")}"`));
  }
  assert.match(config, /retries: 0/);
  assert.match(config, /trace: "off"/);
  assert.match(config, /screenshot: "off"/);
  assert.match(config, /video: "off"/);

  assert.match(spec, /collectBrowserFailures/);
  assert.match(spec, /documentElement\.scrollWidth/);
  assert.match(spec, /Current release status/);
  assert.match(spec, /Personal \/ On this device/);
  assert.match(spec, /Account \/ Guest/);

  const packageJson = JSON.parse(packageSource);
  assert.equal(
    packageJson.scripts["test:browser-compatibility"],
    "playwright test --config=playwright.browser-compatibility.config.js",
  );
  assert.match(workflow, /npm run test:browser-compatibility/);
  assert.match(workflow, /playwright install --with-deps chromium firefox webkit/);
  assert.match(contract, /Free core and local data workflows \| Required \| Required \| Required \| Required/);
  assert.match(contract, /npm run test:browser-compatibility/);
  assert.match(prd, /direct desktop Chromium, Firefox, and WebKit guest compatibility gate/);
});
