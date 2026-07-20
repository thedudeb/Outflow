import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildGitHubEnvironmentProtectionReport,
  buildGitHubEnvironmentReadinessReport,
  collectGitHubEnvironmentSnapshot,
  evaluateGitHubEnvironmentProtection,
  evaluateGitHubEnvironmentReadiness,
  loadGitHubEnvironmentRequirements,
} from "../scripts/check-github-environments.mjs";
import {
  buildGitHubEnvironmentProtectionPlan,
  buildGitHubEnvironmentProtectionPlanReport,
} from "../scripts/provision-github-environments.mjs";

function completeSnapshot(requirements) {
  return {
    environments: Object.fromEntries(Object.entries(requirements.environments).map(([name, requirement]) => [name, {
      protectionRules: [{ type: "required_reviewers", reviewers: [{ id: 1 }] }],
      deploymentBranchPolicy: { custom_branch_policies: true, protected_branches: false },
      branchPolicies: requirement.allowedBranches.map((branch) => ({ name: branch, type: "branch" })),
      variableNames: [...requirement.variables],
      secretNames: [...requirement.secrets],
    }])),
  };
}

test("complete protected GitHub environments satisfy the versioned readiness contract", async () => {
  const requirements = await loadGitHubEnvironmentRequirements();
  const result = evaluateGitHubEnvironmentReadiness(requirements, completeSnapshot(requirements));
  assert.deepEqual(result.errors, []);
  assert.equal(result.environmentCount, 4);
  assert.equal(result.variableCount, 18);
  assert.equal(result.secretCount, 21);
  assert.match(buildGitHubEnvironmentReadinessReport(requirements.repository, result), /readiness: READY/);
});

test("environment protection can be verified independently of operator-owned settings", async () => {
  const requirements = await loadGitHubEnvironmentRequirements();
  const snapshot = completeSnapshot(requirements);
  for (const environment of Object.values(snapshot.environments)) {
    environment.variableNames = [];
    environment.secretNames = [];
  }
  const result = evaluateGitHubEnvironmentProtection(requirements, snapshot);
  assert.deepEqual(result.errors, []);
  assert.match(buildGitHubEnvironmentProtectionReport(requirements.repository, result), /protection: READY/);
  assert.match(buildGitHubEnvironmentProtectionReport(requirements.repository, result), /were not requested or changed/);
  assert.ok(evaluateGitHubEnvironmentReadiness(requirements, snapshot).errors.some((error) => error.includes("missing variables")));
});

test("protection planner creates missing environments, reviewer rules, and exact main policies", async () => {
  const requirements = await loadGitHubEnvironmentRequirements();
  const reviewer = { id: 202567690, login: "thedudeb" };
  const operations = buildGitHubEnvironmentProtectionPlan(requirements, { environments: {} }, reviewer);
  assert.equal(operations.length, 8);
  assert.deepEqual(operations.map((operation) => operation.method), ["PUT", "POST", "PUT", "POST", "PUT", "POST", "PUT", "POST"]);
  for (const operation of operations.filter((operation) => operation.method === "PUT")) {
    assert.deepEqual(operation.body.reviewers, [{ type: "User", id: reviewer.id }]);
    assert.deepEqual(operation.body.deployment_branch_policy, { protected_branches: false, custom_branch_policies: true });
  }
  for (const operation of operations.filter((operation) => operation.method === "POST")) {
    assert.deepEqual(operation.body, { name: "main", type: "branch" });
  }
  const report = buildGitHubEnvironmentProtectionPlanReport(requirements.repository, reviewer, operations);
  assert.match(report, /Mode: DRY RUN/);
  assert.match(report, /Re-run with --apply/);
  assert.match(report, /secrets, and their values will not be requested or changed/);
  assert.doesNotMatch(report, /private-secret-value/);
});

test("protection planner is idempotent and preserves existing reviewers", async () => {
  const requirements = await loadGitHubEnvironmentRequirements();
  const snapshot = completeSnapshot(requirements);
  const reviewer = { id: 202567690, login: "thedudeb" };
  for (const environment of Object.values(snapshot.environments)) {
    environment.protectionRules = [{
      type: "required_reviewers",
      prevent_self_review: false,
      reviewers: [{ type: "User", reviewer: { id: reviewer.id } }],
    }];
  }
  assert.deepEqual(buildGitHubEnvironmentProtectionPlan(requirements, snapshot, reviewer), []);
});

test("protection planner refuses to delete unexpected deployment policies", async () => {
  const requirements = await loadGitHubEnvironmentRequirements();
  const snapshot = completeSnapshot(requirements);
  snapshot.environments.staging.branchPolicies.push({ name: "release/*", type: "branch" });
  assert.throws(
    () => buildGitHubEnvironmentProtectionPlan(requirements, snapshot, { id: 1, login: "owner" }),
    /unexpected deployment policies: branch:release\/\*/,
  );
});

test("missing settings and weak environment protection fail with names but no values", async () => {
  const requirements = await loadGitHubEnvironmentRequirements();
  const snapshot = completeSnapshot(requirements);
  snapshot.environments.staging.protectionRules = [];
  snapshot.environments.staging.branchPolicies = [{ name: "main", type: "tag" }];
  snapshot.environments.staging.variableNames = snapshot.environments.staging.variableNames.filter((name) => name !== "OUTFLOW_APP_URL");
  snapshot.environments.staging.secretNames = snapshot.environments.staging.secretNames.filter((name) => name !== "OUTFLOW_SUPABASE_SECRET_KEY");
  snapshot.environments.staging.privateValue = "must-not-appear";
  delete snapshot.environments["ios-production"];

  const result = evaluateGitHubEnvironmentReadiness(requirements, snapshot);
  assert.ok(result.errors.some((error) => error.includes("staging: requires at least 1 reviewer")));
  assert.ok(result.errors.some((error) => error.includes("deployment branches must be exactly main")));
  assert.ok(result.errors.some((error) => error.includes("missing variables: OUTFLOW_APP_URL")));
  assert.ok(result.errors.some((error) => error.includes("missing secrets: OUTFLOW_SUPABASE_SECRET_KEY")));
  assert.ok(result.errors.some((error) => error.includes("ios-production: environment is missing")));
  const report = buildGitHubEnvironmentReadinessReport(requirements.repository, result);
  assert.match(report, /readiness: BLOCKED/);
  assert.match(report, /Secret values were not requested or read/);
  assert.doesNotMatch(report, /must-not-appear/);
});

test("collector requests metadata endpoints and retains only setting names", async () => {
  const requirements = await loadGitHubEnvironmentRequirements();
  const staging = requirements.environments.staging;
  const paths = [];
  const request = async (path) => {
    paths.push(path);
    if (path.endsWith("/environments")) return {
      environments: [{
        name: "staging",
        protection_rules: [{ type: "required_reviewers", reviewers: [{ id: 1 }] }],
        deployment_branch_policy: { custom_branch_policies: true },
      }],
    };
    if (path.endsWith("/variables")) return { variables: staging.variables.map((name) => ({ name, value: "private-variable-value" })) };
    if (path.endsWith("/secrets")) return { secrets: staging.secrets.map((name) => ({ name, created_at: "2026-07-20" })) };
    if (path.endsWith("/deployment-branch-policies")) return { branch_policies: [{ name: "main", type: "branch" }] };
    throw new Error(`Unexpected path: ${path}`);
  };

  const snapshot = await collectGitHubEnvironmentSnapshot(requirements, { request });
  assert.deepEqual(snapshot.environments.staging.variableNames, staging.variables);
  assert.deepEqual(snapshot.environments.staging.secretNames, staging.secrets);
  assert.deepEqual(snapshot.environments.staging.branchPolicies, [{ name: "main", type: "branch" }]);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-variable-value/);
  assert.ok(paths.every((path) => path.startsWith("repos/thedudeb/Outflow/environments")));
});

test("workflow setting references cannot drift from the environment inventory", async () => {
  const requirements = await loadGitHubEnvironmentRequirements();
  const workflowMap = {
    staging: [
      "staging-account-plane.yml",
      "staging-billing-plane.yml",
      "staging-boundary.yml",
      "staging-browser-sync.yml",
      "staging-messaging-plane.yml",
      "reminder-operations.yml",
    ],
    "macos-production": ["macos-release.yml"],
    "ios-production": ["ios-release.yml"],
    "android-production": ["android-release.yml"],
  };

  for (const [environment, files] of Object.entries(workflowMap)) {
    const sources = await Promise.all(files.map((file) => readFile(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8")));
    const variables = [...new Set(sources.flatMap((source) => [...source.matchAll(/vars\.([A-Z0-9_]+)/g)].map((match) => match[1])))].sort();
    const secrets = [...new Set(sources.flatMap((source) => [...source.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1])).filter((name) => name !== "GITHUB_TOKEN"))].sort();
    assert.deepEqual([...requirements.environments[environment].variables].sort(), variables, `${environment} variable inventory`);
    assert.deepEqual([...requirements.environments[environment].secrets].sort(), secrets, `${environment} secret inventory`);
  }

  const [packageSource, quality, documentation, prd] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8"),
    readFile(new URL("../docs/github-environment-readiness.md", import.meta.url), "utf8"),
    readFile(new URL("../prds/outflow-product-vision.md", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.scripts["check:github-environments"], "node scripts/check-github-environments.mjs");
  assert.equal(packageJson.scripts["provision:github-environments"], "node scripts/provision-github-environments.mjs");
  assert.equal(packageJson.scripts["test:github-environments"], "node --test tests/github-environments.test.js");
  assert.match(quality, /npm run test:github-environments/);
  assert.match(documentation, /Secret values are never requested/);
  assert.match(prd, /versioned GitHub environment contract/);
  assert.match(prd, /dry-run-first, idempotent provisioner/);
});
