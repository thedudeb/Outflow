import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("repository onboarding points operators to the bounded closed beta", () => {
  const readme = read("README.md");
  const beta = read("docs/closed-beta.md");
  const provisioning = read("docs/service-provisioning.md");
  const prd = read("prds/outflow-product-vision.md");

  assert.match(readme, /https:\/\/thedudeb\.github\.io\/Outflow\//);
  assert.match(readme, /docs\/closed-beta\.md/);
  assert.match(readme, /docs\/service-provisioning\.md/);
  assert.match(beta, /10 to 20 invited testers/);
  assert.match(beta, /protected staging boundary, account plane, browser sync, billing plane, and messaging plane/);
  assert.match(beta, /Do not add third-party behavioral tracking/);
  assert.match(beta, /zero unresolved Blocker or Major/);
  assert.match(provisioning, /external staging project required/);
  assert.match(prd, /Closed Beta Decision Gate/);
  assert.match(prd, /Do not inspect subscription content or add third-party behavioral tracking/);
});

test("beta feedback form requires a privacy acknowledgement", () => {
  const form = read(".github/ISSUE_TEMPLATE/beta-feedback.yml");

  assert.match(form, /name: Beta feedback/);
  assert.match(form, /Accessibility problem/);
  assert.match(form, /Candidate commit or beta date/);
  assert.match(form, /I removed account details, financial data, access codes, credentials, and private links/);
  assert.match(form, /required: true/);
});
