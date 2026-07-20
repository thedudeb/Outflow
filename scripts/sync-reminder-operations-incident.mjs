import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REMINDER_INCIDENT_TITLE = "[Outflow] Reminder operations requires attention";
export const REMINDER_INCIDENT_MARKER = "<!-- outflow-reminder-operations-incident -->";

function exactHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname === "/"
      && url.origin === value;
  } catch {
    return false;
  }
}

function validOperator(value) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value);
}

export function resolveReminderIncidentConfig(env, status) {
  const errors = [];
  const repository = String(env.GITHUB_REPOSITORY || "").trim();
  const operator = String(env.OUTFLOW_OPERATIONS_ASSIGNEE || "").trim();
  const token = String(env.GITHUB_TOKEN || "").trim();
  const apiOrigin = String(env.GITHUB_API_URL || "https://api.github.com").trim();
  const serverOrigin = String(env.GITHUB_SERVER_URL || "https://github.com").trim();
  const runId = String(env.GITHUB_RUN_ID || "").trim();
  const commitSha = String(env.GITHUB_SHA || "").trim();

  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    errors.push("GITHUB_REPOSITORY: expected one owner/name repository.");
  }
  if (!validOperator(operator)) {
    errors.push("OUTFLOW_OPERATIONS_ASSIGNEE: expected one GitHub username.");
  }
  if (token.length < 20 || token.length > 512 || /\s/.test(token)) {
    errors.push("GITHUB_TOKEN: expected a bounded workflow token.");
  }
  if (!exactHttpsOrigin(apiOrigin)) {
    errors.push("GITHUB_API_URL: expected an exact HTTPS API origin.");
  }
  if (!exactHttpsOrigin(serverOrigin)) {
    errors.push("GITHUB_SERVER_URL: expected an exact HTTPS server origin.");
  }
  if (!/^\d{1,20}$/.test(runId)) {
    errors.push("GITHUB_RUN_ID: expected the current numeric workflow run ID.");
  }
  if (!/^[a-f0-9]{40}$/.test(commitSha)) {
    errors.push("GITHUB_SHA: expected the exact lowercase Git commit SHA.");
  }
  if (!new Set(["success", "failure"]).has(status)) {
    errors.push("status: expected success or failure.");
  }

  return {
    errors,
    repository,
    operator,
    token,
    apiOrigin,
    serverOrigin,
    runId,
    commitSha,
    status,
  };
}

function incidentBody(config) {
  return [
    REMINDER_INCIDENT_MARKER,
    "",
    "The privacy-safe reminder operations gate failed and requires operator review.",
    "",
    `- Assigned operator: @${config.operator}`,
    `- Commit: \`${config.commitSha}\``,
    `- Workflow run: ${config.serverOrigin}/${config.repository}/actions/runs/${config.runId}`,
    "",
    "Review the bounded workflow summary and restore reminder health before closing this incident.",
    "",
    "This issue contains no account, recipient, ledger, subscription, provider, message, endpoint, response, or credential data.",
  ].join("\n");
}

function failureComment(config) {
  return [
    "Reminder operations failed again.",
    "",
    `- Commit: \`${config.commitSha}\``,
    `- Workflow run: ${config.serverOrigin}/${config.repository}/actions/runs/${config.runId}`,
    "",
    `Assigned operator: @${config.operator}`,
  ].join("\n");
}

function recoveryComment(config) {
  return [
    "Reminder operations recovered and the aggregate health gate passed.",
    "",
    `- Commit: \`${config.commitSha}\``,
    `- Workflow run: ${config.serverOrigin}/${config.repository}/actions/runs/${config.runId}`,
  ].join("\n");
}

async function githubRequest(config, path, { method = "GET", body, expected = [200], fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${config.apiOrigin}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "outflow-reminder-operations/1.0",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!expected.includes(response.status)) {
    throw new Error(`Reminder incident synchronization failed (http-${response.status}).`);
  }
  if (response.status === 204) return null;
  const rawBody = await response.text();
  if (new TextEncoder().encode(rawBody).byteLength > 2 * 1024 * 1024) {
    throw new Error("Reminder incident synchronization returned an oversized response.");
  }
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error("Reminder incident synchronization returned invalid JSON.");
  }
}

async function findOpenIncident(config, fetchImpl) {
  const matches = [];
  for (let page = 1; page <= 3; page += 1) {
    const issues = await githubRequest(
      config,
      `/repos/${config.repository}/issues?state=open&per_page=100&sort=created&direction=asc&page=${page}`,
      { fetchImpl },
    );
    if (!Array.isArray(issues)) throw new Error("Reminder incident synchronization returned an invalid issue list.");
    matches.push(...issues.filter((issue) =>
      !issue?.pull_request
      && issue?.title === REMINDER_INCIDENT_TITLE
      && typeof issue?.body === "string"
      && issue.body.includes(REMINDER_INCIDENT_MARKER)
      && Number.isSafeInteger(issue?.number)
      && issue.number > 0
    ));
    if (issues.length < 100) break;
  }
  if (matches.length > 1) throw new Error("Multiple open reminder incidents require manual reconciliation.");
  return matches[0] || null;
}

function issueHasOperator(issue, operator) {
  return Array.isArray(issue?.assignees)
    && issue.assignees.some((assignee) => String(assignee?.login || "").toLowerCase() === operator.toLowerCase());
}

export async function syncReminderOperationsIncident(config, { fetchImpl = fetch } = {}) {
  const existing = await findOpenIncident(config, fetchImpl);

  if (config.status === "success") {
    if (!existing) return { action: "none", issueNumber: null };
    await githubRequest(config, `/repos/${config.repository}/issues/${existing.number}/comments`, {
      method: "POST",
      body: { body: recoveryComment(config) },
      expected: [201],
      fetchImpl,
    });
    const closed = await githubRequest(config, `/repos/${config.repository}/issues/${existing.number}`, {
      method: "PATCH",
      body: { state: "closed", state_reason: "completed" },
      fetchImpl,
    });
    if (closed?.state !== "closed") throw new Error("GitHub did not close the recovered reminder incident.");
    return { action: "resolved", issueNumber: existing.number };
  }

  await githubRequest(config, `/repos/${config.repository}/assignees/${config.operator}`, {
    expected: [204],
    fetchImpl,
  });

  if (existing) {
    const updated = await githubRequest(config, `/repos/${config.repository}/issues/${existing.number}`, {
      method: "PATCH",
      body: { assignees: [config.operator] },
      fetchImpl,
    });
    if (!issueHasOperator(updated, config.operator)) {
      throw new Error("The configured reminder operator was not assigned to the incident.");
    }
    await githubRequest(config, `/repos/${config.repository}/issues/${existing.number}/comments`, {
      method: "POST",
      body: { body: failureComment(config) },
      expected: [201],
      fetchImpl,
    });
    return { action: "updated", issueNumber: existing.number };
  }

  const created = await githubRequest(config, `/repos/${config.repository}/issues`, {
    method: "POST",
    body: {
      title: REMINDER_INCIDENT_TITLE,
      body: incidentBody(config),
      assignees: [config.operator],
    },
    expected: [201],
    fetchImpl,
  });
  if (!Number.isSafeInteger(created?.number) || created.number < 1 || !issueHasOperator(created, config.operator)) {
    throw new Error("GitHub did not create an assigned reminder incident.");
  }
  return { action: "created", issueNumber: created.number };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

async function main() {
  const config = resolveReminderIncidentConfig(process.env, argumentValue("--status"));
  if (config.errors.length) {
    for (const error of config.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  try {
    const result = await syncReminderOperationsIncident(config);
    console.log(`Reminder operations incident: ${result.action}${result.issueNumber ? ` / issue ${result.issueNumber}` : ""}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Reminder incident synchronization failed.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
