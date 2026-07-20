import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  buildGitHubEnvironmentProtectionReport,
  collectGitHubEnvironmentSnapshot,
  evaluateGitHubEnvironmentProtection,
  loadGitHubEnvironmentRequirements,
} from "./check-github-environments.mjs";

const apiHeaders = [
  "Accept: application/vnd.github+json",
  "X-GitHub-Api-Version: 2022-11-28",
];

function encodedEnvironment(name) {
  return encodeURIComponent(name);
}

function reviewerEntries(rule) {
  return (rule?.reviewers || []).map((entry) => {
    const reviewer = entry.reviewer || entry;
    const type = entry.type === "Team" || reviewer.slug ? "Team" : "User";
    return { type, id: Number(reviewer.id) };
  }).filter((entry) => Number.isSafeInteger(entry.id) && entry.id > 0);
}

function sortedReviewers(reviewers) {
  return [...new Map(reviewers.map((reviewer) => [`${reviewer.type}:${reviewer.id}`, reviewer])).values()]
    .sort((left, right) => left.type.localeCompare(right.type) || left.id - right.id);
}

export function buildGitHubEnvironmentProtectionPlan(requirements, snapshot, reviewer) {
  if (!reviewer || !Number.isSafeInteger(reviewer.id) || reviewer.id < 1 || !/^[A-Za-z0-9-]+$/.test(reviewer.login || "")) {
    throw new TypeError("A resolved GitHub user reviewer is required.");
  }

  const operations = [];
  for (const [name, requirement] of Object.entries(requirements.environments)) {
    const environment = snapshot.environments?.[name];
    const allowedPolicies = new Set(requirement.allowedBranches.map((branch) => `branch:${branch}`));
    const existingPolicies = (environment?.branchPolicies || []).map((policy) => `${policy.type}:${policy.name}`);
    const unexpectedPolicies = existingPolicies.filter((policy) => !allowedPolicies.has(policy));
    if (unexpectedPolicies.length) {
      throw new Error(`${name} has unexpected deployment policies: ${unexpectedPolicies.join(", ")}. Remove them deliberately before provisioning.`);
    }

    const reviewerRule = (environment?.protectionRules || []).find((rule) => rule.type === "required_reviewers");
    const waitRule = (environment?.protectionRules || []).find((rule) => rule.type === "wait_timer");
    const reviewers = sortedReviewers([
      ...reviewerEntries(reviewerRule),
      { type: "User", id: reviewer.id },
    ]);
    if (reviewers.length > 6) throw new Error(`${name} would exceed GitHub's six-reviewer environment limit.`);

    const branchPolicy = environment?.deploymentBranchPolicy || {};
    const environmentNeedsUpdate = !environment
      || !reviewerEntries(reviewerRule).some((entry) => entry.type === "User" && entry.id === reviewer.id)
      || branchPolicy.custom_branch_policies !== true
      || branchPolicy.protected_branches !== false;
    const basePath = `repos/${requirements.repository}/environments/${encodedEnvironment(name)}`;
    if (environmentNeedsUpdate) {
      operations.push({
        label: `Protect ${name} with reviewer @${reviewer.login} and custom branch policies`,
        method: "PUT",
        path: basePath,
        body: {
          wait_timer: Number.isSafeInteger(waitRule?.wait_timer) ? waitRule.wait_timer : 0,
          prevent_self_review: reviewerRule?.prevent_self_review === true,
          reviewers,
          deployment_branch_policy: {
            protected_branches: false,
            custom_branch_policies: true,
          },
        },
      });
    }

    for (const branch of requirement.allowedBranches) {
      if (existingPolicies.includes(`branch:${branch}`)) continue;
      operations.push({
        label: `Allow ${name} deployments from branch ${branch}`,
        method: "POST",
        path: `${basePath}/deployment-branch-policies`,
        body: { name: branch, type: "branch" },
      });
    }
  }
  return operations;
}

export function buildGitHubEnvironmentProtectionPlanReport(repository, reviewer, operations, apply = false) {
  const lines = [
    `GitHub environment protection plan: ${operations.length ? `${operations.length} change${operations.length === 1 ? "" : "s"}` : "no changes"}`,
    `Repository: ${repository}`,
    `Reviewer: @${reviewer.login}`,
    `Mode: ${apply ? "APPLY" : "DRY RUN"}`,
    "Variables, secrets, and their values will not be requested or changed.",
  ];
  if (operations.length) lines.push("", ...operations.map((operation) => `- ${operation.method} ${operation.label}`));
  if (!apply && operations.length) lines.push("", "Re-run with --apply only after reviewing this plan.");
  return `${lines.join("\n")}\n`;
}

function ghRequest(path, { method = "GET", body } = {}) {
  const args = ["api", "--method", method, path];
  for (const header of apiHeaders) args.push("--header", header);
  if (body) args.push("--input", "-");
  const response = spawnSync("gh", args, {
    encoding: "utf8",
    input: body ? JSON.stringify(body) : undefined,
    stdio: [body ? "pipe" : "ignore", "pipe", "pipe"],
  });
  if (response.error || response.status !== 0) throw new Error(`GitHub API ${method} failed for ${path}.`);
  if (!response.stdout.trim()) return {};
  try {
    return JSON.parse(response.stdout);
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${path}.`);
  }
}

function argumentValue(argv, name, fallback = "") {
  const equals = argv.find((argument) => argument.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

async function main() {
  const requirements = await loadGitHubEnvironmentRequirements();
  const argv = process.argv.slice(2);
  const repository = argumentValue(argv, "--repo", requirements.repository);
  const reviewerLogin = argumentValue(argv, "--reviewer");
  const apply = argv.includes("--apply");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new TypeError("--repo must use owner/repository format.");
  if (!/^[A-Za-z0-9-]+$/.test(reviewerLogin)) throw new TypeError("--reviewer must name one GitHub user.");
  const supported = new Set(["--apply", "--repo", "--reviewer"]);
  const unknown = argv.filter((argument, index) => {
    if (argument.includes("=")) return !supported.has(argument.slice(0, argument.indexOf("=")));
    if (supported.has(argument)) return false;
    return index === 0 || !supported.has(argv[index - 1]);
  });
  if (unknown.length) throw new TypeError(`Unsupported argument: ${unknown[0]}.`);

  const resolved = ghRequest(`users/${reviewerLogin}`);
  if (resolved.type !== "User" || !Number.isSafeInteger(resolved.id)) throw new TypeError("--reviewer must resolve to a GitHub user.");
  const reviewer = { id: resolved.id, login: resolved.login };
  const request = (path) => ghRequest(path);
  const snapshot = await collectGitHubEnvironmentSnapshot(requirements, { repository, request });
  const repositoryRequirements = { ...requirements, repository };
  const operations = buildGitHubEnvironmentProtectionPlan(repositoryRequirements, snapshot, reviewer);
  process.stdout.write(buildGitHubEnvironmentProtectionPlanReport(repository, reviewer, operations, apply));
  if (!apply) return;

  for (const operation of operations) ghRequest(operation.path, operation);
  const verifiedSnapshot = await collectGitHubEnvironmentSnapshot(repositoryRequirements, { repository, request });
  const result = evaluateGitHubEnvironmentProtection(repositoryRequirements, verifiedSnapshot);
  process.stdout.write(`\n${buildGitHubEnvironmentProtectionReport(repository, result)}`);
  if (result.errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`GitHub environment provisioning failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
