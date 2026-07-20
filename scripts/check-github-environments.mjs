import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const requirementsUrl = new URL("../config/github-environments.json", import.meta.url);

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameNames(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function validateNameList(value, label, pattern = /^[A-Z0-9_-]+$/) {
  if (!Array.isArray(value) || value.some((name) => typeof name !== "string" || !pattern.test(name))) {
    throw new TypeError(`${label} must be an array of setting names.`);
  }
  if (value.length !== new Set(value).size) throw new TypeError(`${label} contains duplicate names.`);
}

export function validateGitHubEnvironmentRequirements(requirements) {
  if (!requirements || requirements.schemaVersion !== 1) throw new TypeError("GitHub environment requirements must use schema version 1.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(requirements.repository || "")) {
    throw new TypeError("GitHub environment requirements must name one owner/repository.");
  }
  const entries = Object.entries(requirements.environments || {});
  if (!entries.length) throw new TypeError("At least one GitHub environment is required.");
  for (const [name, requirement] of entries) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new TypeError(`Invalid GitHub environment name: ${name}.`);
    validateNameList(requirement.allowedBranches, `${name}.allowedBranches`, /^[A-Za-z0-9_./-]+$/);
    validateNameList(requirement.variables, `${name}.variables`);
    validateNameList(requirement.secrets, `${name}.secrets`);
    if (!Number.isSafeInteger(requirement.minimumReviewers) || requirement.minimumReviewers < 1) {
      throw new TypeError(`${name}.minimumReviewers must be at least 1.`);
    }
  }
  return requirements;
}

export async function loadGitHubEnvironmentRequirements(url = requirementsUrl) {
  return validateGitHubEnvironmentRequirements(JSON.parse(await readFile(url, "utf8")));
}

export function evaluateGitHubEnvironmentProtection(requirements, snapshot) {
  validateGitHubEnvironmentRequirements(requirements);
  const errors = [];

  for (const [name, requirement] of Object.entries(requirements.environments)) {
    const environment = snapshot.environments?.[name];
    if (!environment) {
      errors.push(`${name}: environment is missing.`);
      continue;
    }

    const reviewerRule = (environment.protectionRules || []).find((rule) => rule.type === "required_reviewers");
    const reviewerCount = Array.isArray(reviewerRule?.reviewers) ? reviewerRule.reviewers.length : 0;
    if (reviewerCount < requirement.minimumReviewers) {
      errors.push(`${name}: requires at least ${requirement.minimumReviewers} reviewer.`);
    }

    const branchPolicy = environment.deploymentBranchPolicy || {};
    const deploymentPolicies = (environment.branchPolicies || []).map((policy) => (
      typeof policy === "string" ? `branch:${policy}` : `${policy.type}:${policy.name}`
    ));
    const requiredPolicies = requirement.allowedBranches.map((branch) => `branch:${branch}`);
    if (branchPolicy.custom_branch_policies !== true || !sameNames(deploymentPolicies, requiredPolicies)) {
      errors.push(`${name}: deployment branches must be exactly ${requirement.allowedBranches.join(", ")}.`);
    }
  }

  return {
    errors,
    environmentCount: Object.keys(requirements.environments).length,
  };
}

export function evaluateGitHubEnvironmentReadiness(requirements, snapshot) {
  const protection = evaluateGitHubEnvironmentProtection(requirements, snapshot);
  const errors = [...protection.errors];
  let variableCount = 0;
  let secretCount = 0;

  for (const [name, requirement] of Object.entries(requirements.environments)) {
    variableCount += requirement.variables.length;
    secretCount += requirement.secrets.length;
    const environment = snapshot.environments?.[name];
    if (!environment) continue;

    const missingVariables = requirement.variables.filter((name) => !(environment.variableNames || []).includes(name));
    if (missingVariables.length) errors.push(`${name}: missing variables: ${missingVariables.join(", ")}.`);
    const missingSecrets = requirement.secrets.filter((name) => !(environment.secretNames || []).includes(name));
    if (missingSecrets.length) errors.push(`${name}: missing secrets: ${missingSecrets.join(", ")}.`);
  }

  return {
    errors,
    environmentCount: protection.environmentCount,
    variableCount,
    secretCount,
  };
}

export function buildGitHubEnvironmentProtectionReport(repository, result) {
  const status = result.errors.length ? "BLOCKED" : "READY";
  const lines = [
    `GitHub environment protection: ${status}`,
    `Repository: ${repository}`,
    `Contract: ${result.environmentCount} protected environments`,
    "Variables, secrets, and their values were not requested or changed.",
  ];
  if (result.errors.length) lines.push("", ...result.errors.map((error) => `- ${error}`));
  return `${lines.join("\n")}\n`;
}

export function buildGitHubEnvironmentReadinessReport(repository, result) {
  const status = result.errors.length ? "BLOCKED" : "READY";
  const lines = [
    `GitHub environment readiness: ${status}`,
    `Repository: ${repository}`,
    `Contract: ${result.environmentCount} environments / ${result.variableCount} variables / ${result.secretCount} secrets`,
    "Secret values were not requested or read.",
  ];
  if (result.errors.length) {
    lines.push("", ...result.errors.map((error) => `- ${error}`));
  }
  return `${lines.join("\n")}\n`;
}

async function defaultRequest(path) {
  const response = spawnSync("gh", ["api", path], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (response.error || response.status !== 0) throw new Error(`GitHub API request failed for ${path}.`);
  try {
    return JSON.parse(response.stdout);
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${path}.`);
  }
}

export async function collectGitHubEnvironmentSnapshot(requirements, { repository = requirements.repository, request = defaultRequest } = {}) {
  const environmentsResponse = await request(`repos/${repository}/environments`);
  const available = new Map((environmentsResponse.environments || []).map((environment) => [environment.name, environment]));
  const environments = {};

  for (const name of Object.keys(requirements.environments)) {
    const source = available.get(name);
    if (!source) continue;
    const encodedName = encodeURIComponent(name);
    const [variables, secrets] = await Promise.all([
      request(`repos/${repository}/environments/${encodedName}/variables`),
      request(`repos/${repository}/environments/${encodedName}/secrets`),
    ]);
    let branchPolicies = [];
    if (source.deployment_branch_policy?.custom_branch_policies === true) {
      const response = await request(`repos/${repository}/environments/${encodedName}/deployment-branch-policies`);
      branchPolicies = (response.branch_policies || []).map((policy) => ({ name: policy.name, type: policy.type }));
    }
    environments[name] = {
      protectionRules: source.protection_rules || [],
      deploymentBranchPolicy: source.deployment_branch_policy,
      branchPolicies,
      variableNames: (variables.variables || []).map((variable) => variable.name),
      secretNames: (secrets.secrets || []).map((secret) => secret.name),
    };
  }
  return { environments };
}

function repositoryArgument(argv, fallback) {
  const equals = argv.find((argument) => argument.startsWith("--repo="));
  if (equals) return equals.slice("--repo=".length);
  const index = argv.indexOf("--repo");
  return index >= 0 ? argv[index + 1] : process.env.GITHUB_REPOSITORY || fallback;
}

async function main() {
  const requirements = await loadGitHubEnvironmentRequirements();
  const repository = repositoryArgument(process.argv.slice(2), requirements.repository);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "")) throw new TypeError("--repo must use owner/repository format.");
  const snapshot = await collectGitHubEnvironmentSnapshot(requirements, { repository });
  const result = evaluateGitHubEnvironmentReadiness(requirements, snapshot);
  process.stdout.write(buildGitHubEnvironmentReadinessReport(repository, result));
  if (result.errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`GitHub environment readiness failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
