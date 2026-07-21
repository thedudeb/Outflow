import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("all application dialogs share the guarded backdrop dismissal contract", async () => {
  const [app, ui, guestBehavior, accountBehavior, accessibility, quality, packageSource] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ui.jsx", import.meta.url), "utf8"),
    readFile(new URL("./e2e/dialog-dismissal.spec.js", import.meta.url), "utf8"),
    readFile(new URL("./account-service/account-service.spec.js", import.meta.url), "utf8"),
    readFile(new URL("../docs/accessibility.md", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal((app.match(/<DialogOverlay\b/g) || []).length, 6);
  assert.equal((ui.match(/data-dialog-overlay/g) || []).length, 1);
  assert.match(ui, /event\.target === event\.currentTarget && !closeDisabled/);
  assert.doesNotMatch(app, /<div className="fixed inset-0 z-50 grid grid-cols-\[minmax\(0,1fr\)\] place-items-center bg-black\/85/);
  assert.match(app, /<DialogOverlay onClose=\{closeAccountControls\} closeDisabled=\{Boolean\(accountBusy\)\}>/);
  assert.match(app, /<DialogOverlay onClose=\{closeCalendarExport\} closeDisabled=\{Boolean\(calendarFeedBusy\)\}>/);
  assert.match(app, /<DialogOverlay onClose=\{closeStarterPacks\}>/);
  assert.match(guestBehavior, /every guest dialog closes from its backdrop but not from its panel/);
  assert.match(accountBehavior, /dialog\.locator\("xpath=\.\."\)\.click/);
  assert.match(accessibility, /clicking its backdrop/);
  assert.equal(packageJson.scripts["test:dialog-dismissal"], "node --test tests/dialog-dismissal.test.js");
  assert.match(quality, /npm run test:dialog-dismissal/);
});
