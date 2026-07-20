import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("the public privacy view is versioned, deep-linkable, and available inside the product", () => {
  const app = read("src/App.jsx");

  assert.match(app, /const PRIVACY_VIEW = "privacy"/);
  assert.match(app, /const PRIVACY_POLICY_VERSION = "2026-07-20"/);
  assert.match(app, /privacyPolicyHref = `\$\{import\.meta\.env\.BASE_URL\}\?view=\$\{PRIVACY_VIEW\}`/);
  assert.match(app, /new URLSearchParams\(location\.search\)\.get\("view"\) === PRIVACY_VIEW/);
  assert.match(app, /data-policy-version=\{PRIVACY_POLICY_VERSION\}/);
  assert.match(app, /Privacy and data controls \| Outflow/);
  assert.ok((app.match(/href=\{privacyPolicyHref\}/g) || []).length >= 2, "landing and account surfaces must link to the policy");
});

test("the policy reflects the implemented local, hosted, provider, and data-control boundaries", () => {
  const app = read("src/App.jsx");
  const requiredStatements = [
    "No bank connections",
    "No ads or tracking",
    "No sale of personal data",
    "Signing in alone does not upload subscriptions from this device",
    "Payment-card details are entered with Stripe and are not collected by the Outflow application",
    "Outflow does not create a recurring product subscription",
    "GitHub Pages",
    "Supabase",
    "Resend",
    "Stripe",
    "Download a free account-data archive when signed in",
    "Deleting a cloud account does not delete independent subscription lists",
  ];

  requiredStatements.forEach((statement) => assert.match(app, new RegExp(statement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
  assert.match(app, /cloudConfigured\s*\?\s*"Optional account services are configured/);
  assert.match(app, /"Guest-only\. Account, synchronization, hosted email, hosted calendar, and purchase services are not configured/);
  assert.doesNotMatch(app, /privacyPolicyHref[^\n]+(?:token|secret|email)=/i);
});

test("privacy is covered by accessibility, offline, deployment, and release documentation contracts", () => {
  const packageJson = JSON.parse(read("package.json"));
  const quality = read(".github/workflows/quality.yml");
  const accessibility = read("tests/e2e/accessibility.spec.js");
  const pwa = read("tests/pwa/pwa.spec.js");
  const deployment = read("tests/deployment/live-web.spec.js");
  const documentation = read("docs/privacy-policy.md");

  assert.equal(packageJson.scripts["test:privacy-policy"], "node --test tests/privacy-policy.test.js");
  assert.match(quality, /npm run test:privacy-policy/);
  assert.match(accessibility, /privacy and data controls meet the automated WCAG A and AA gate/);
  assert.match(accessibility, /\?view=privacy/);
  assert.match(pwa, /\?view=privacy/);
  assert.match(pwa, /Guest-only/);
  assert.match(deployment, /published privacy policy is direct, responsive, and matches the guest release/);
  assert.match(documentation, /https:\/\/thedudeb\.github\.io\/Outflow\/\?view=privacy/);
  assert.match(documentation, /App Store Connect/);
  assert.match(documentation, /Google Play/);
});
