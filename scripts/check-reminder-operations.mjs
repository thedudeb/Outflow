import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnvFile } from "./check-service-readiness.mjs";

const ALERT_CODES = Object.freeze([
  "stale_worker",
  "commit_mismatch",
  "completion_errors",
  "exhausted_deliveries",
  "stuck_claims",
  "retry_backlog",
  "failure_spike",
  "suppression_spike",
]);
const WARNING_CODES = Object.freeze([
  "retry_backlog",
  "provider_failures",
  "suppression_growth",
]);
const HEALTH_KEYS = Object.freeze([
  "alerts",
  "claimed1h",
  "completionErrors1h",
  "exhaustedDeliveries",
  "failed1h",
  "healthy",
  "lastRunAt",
  "latestCommitMatches",
  "overdueRetries",
  "recentRun",
  "runs1h",
  "schemaVersion",
  "sent1h",
  "stuckClaims",
  "suppressions24h",
  "warnings",
]);

function hostedProjectOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && /^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname)
      && url.origin === value;
  } catch {
    return false;
  }
}

export function resolveReminderOperationsConfig(env) {
  const errors = [];
  const projectUrl = String(env.SUPABASE_URL || "").trim();
  const projectRef = String(env.OUTFLOW_ACCEPTANCE_PROJECT_REF || "").trim();
  const mode = String(env.OUTFLOW_ACCEPTANCE_MODE || "").trim();
  const expectedDeploymentCommit = String(env.OUTFLOW_EXPECTED_DEPLOYMENT_COMMIT || "").trim();
  const operationsSecret = String(env.OUTFLOW_OPERATIONS_SECRET || "").trim();

  if (!hostedProjectOrigin(projectUrl)) {
    errors.push("SUPABASE_URL: expected an exact hosted Supabase project origin.");
  }
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    errors.push("OUTFLOW_ACCEPTANCE_PROJECT_REF: expected the protected staging project reference.");
  }
  if (hostedProjectOrigin(projectUrl) && projectRef && new URL(projectUrl).hostname.split(".")[0] !== projectRef) {
    errors.push("OUTFLOW_ACCEPTANCE_PROJECT_REF: does not match the configured Supabase project.");
  }
  if (mode !== "staging") {
    errors.push("OUTFLOW_ACCEPTANCE_MODE: must be the literal value staging.");
  }
  if (!/^[a-f0-9]{40}$/.test(expectedDeploymentCommit)) {
    errors.push("OUTFLOW_EXPECTED_DEPLOYMENT_COMMIT: expected the exact lowercase Git commit SHA.");
  }
  if (operationsSecret.length < 32 || /\s/.test(operationsSecret) || new Set(operationsSecret).size < 12) {
    errors.push("OUTFLOW_OPERATIONS_SECRET: expected at least 32 high-entropy, whitespace-free characters.");
  }

  return { errors, projectUrl, projectRef, operationsSecret, expectedDeploymentCommit };
}

function canonicalCodes(value, allowed) {
  return Array.isArray(value)
    && value.every((code) => typeof code === "string")
    && JSON.stringify(value) === JSON.stringify(allowed.filter((code) => value.includes(code)));
}

export function reminderOperationsHealthMatches(health) {
  if (!health || typeof health !== "object" || Array.isArray(health)) return false;
  if (JSON.stringify(Object.keys(health).sort()) !== JSON.stringify([...HEALTH_KEYS].sort())) return false;
  if (health.schemaVersion !== 1 || typeof health.healthy !== "boolean") return false;
  if (typeof health.recentRun !== "boolean" || typeof health.latestCommitMatches !== "boolean") return false;
  if (health.lastRunAt !== null && (typeof health.lastRunAt !== "string" || !Number.isFinite(Date.parse(health.lastRunAt)))) return false;
  for (const key of [
    "runs1h",
    "claimed1h",
    "sent1h",
    "failed1h",
    "completionErrors1h",
    "exhaustedDeliveries",
    "overdueRetries",
    "stuckClaims",
    "suppressions24h",
  ]) {
    if (!Number.isInteger(health[key]) || health[key] < 0 || health[key] > 1_000_000) return false;
  }
  if (health.claimed1h !== health.sent1h + health.failed1h) return false;
  if (!canonicalCodes(health.alerts, ALERT_CODES) || !canonicalCodes(health.warnings, WARNING_CODES)) return false;
  if (health.healthy !== (health.alerts.length === 0)) return false;
  const hasAlert = (code) => health.alerts.includes(code);
  const hasWarning = (code) => health.warnings.includes(code);
  if (hasAlert("stale_worker") !== !health.recentRun) return false;
  if (hasAlert("commit_mismatch") !== (health.recentRun && !health.latestCommitMatches)) return false;
  if (hasAlert("completion_errors") !== (health.completionErrors1h > 0)) return false;
  if (hasAlert("exhausted_deliveries") !== (health.exhaustedDeliveries > 0)) return false;
  if (hasAlert("stuck_claims") !== (health.stuckClaims > 0)) return false;
  if (hasAlert("retry_backlog") !== (health.overdueRetries >= 5)) return false;
  if (hasAlert("failure_spike") !== (health.failed1h >= 10)) return false;
  if (hasAlert("suppression_spike") !== (health.suppressions24h >= 5)) return false;
  if (hasWarning("retry_backlog") !== (health.overdueRetries >= 1 && health.overdueRetries <= 4)) return false;
  if (hasWarning("provider_failures") !== (health.failed1h >= 1 && health.failed1h <= 9)) return false;
  if (hasWarning("suppression_growth") !== (health.suppressions24h >= 1 && health.suppressions24h <= 4)) return false;
  if (health.recentRun && health.lastRunAt === null) return false;
  if (!health.recentRun && health.lastRunAt !== null && Date.parse(health.lastRunAt) > Date.now() + 60_000) return false;
  return true;
}

export async function checkReminderOperations(config, { fetchImpl = fetch } = {}) {
  const operationsResponse = await fetchImpl(`${config.projectUrl}/functions/v1/send-due-reminders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.operationsSecret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "health", expectedCommit: config.expectedDeploymentCommit }),
  });
  if (operationsResponse.headers.get("cache-control") !== "no-store") {
    throw new Error("Reminder operations response was not marked private.");
  }
  if (!/^application\/json(?:;|$)/i.test(operationsResponse.headers.get("content-type") || "")) {
    throw new Error("Reminder operations returned an invalid content type.");
  }
  const responseText = await operationsResponse.text();
  if (new TextEncoder().encode(responseText).byteLength > 16_384) {
    throw new Error("Reminder operations response exceeded the aggregate contract limit.");
  }
  if (!operationsResponse.ok) throw new Error(`Reminder operations check failed (http-${operationsResponse.status}).`);
  let health;
  try {
    health = JSON.parse(responseText);
  } catch {
    throw new Error("Reminder operations returned invalid JSON.");
  }
  if (!reminderOperationsHealthMatches(health)) throw new Error("Reminder operations returned an invalid health contract.");
  return health;
}

export function buildReminderOperationsReport({ health, projectRef, commitSha, actor, runId, completedAt }) {
  if (!reminderOperationsHealthMatches(health)) throw new Error("Reminder operations report requires valid health data.");
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("Reminder operations report requires one project reference.");
  const safeCommit = /^[a-f0-9]{40}$/.test(String(commitSha || "")) ? commitSha : "local";
  const safeActor = /^[A-Za-z0-9_-]{1,80}$/.test(String(actor || "")) ? actor : "local";
  const safeRun = /^[A-Za-z0-9_-]{1,80}$/.test(String(runId || "")) ? runId : "local";
  const safeTime = Number.isFinite(Date.parse(completedAt)) ? new Date(completedAt).toISOString() : new Date().toISOString();
  const codes = (value) => value.length ? value.map((code) => `\`${code}\``).join(", ") : "`none`";
  return [
    "## Outflow reminder operations",
    "",
    `- Commit: \`${safeCommit}\``,
    `- Actor: \`${safeActor}\``,
    `- Run: \`${safeRun}\``,
    `- Supabase project: \`${projectRef}\``,
    `- Completed: \`${safeTime}\``,
    `- Status: \`${health.healthy ? "healthy" : "attention-required"}\``,
    `- Alerts: ${codes(health.alerts)}`,
    `- Warnings: ${codes(health.warnings)}`,
    `- Worker runs / 1h: \`${health.runs1h}\``,
    `- Claimed / sent / failed / 1h: \`${health.claimed1h} / ${health.sent1h} / ${health.failed1h}\``,
    `- Completion errors / 1h: \`${health.completionErrors1h}\``,
    `- Exhausted / overdue / stuck: \`${health.exhaustedDeliveries} / ${health.overdueRetries} / ${health.stuckClaims}\``,
    `- Suppressions / 24h: \`${health.suppressions24h}\``,
    "",
    "This report contains aggregate counters and fixed operational codes only. It excludes account, recipient, ledger, subscription, provider, message, request, response, endpoint, and credential data.",
    "",
  ].join("\n");
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

async function main() {
  const envFile = argumentValue("--env-file");
  const summaryFile = argumentValue("--summary-file");
  const fileEnvironment = envFile ? parseEnvFile(await readFile(resolve(envFile), "utf8")) : {};
  const config = resolveReminderOperationsConfig({ ...fileEnvironment, ...process.env });
  if (config.errors.length) {
    for (const error of config.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  try {
    const health = await checkReminderOperations(config);
    const report = buildReminderOperationsReport({
      health,
      projectRef: config.projectRef,
      commitSha: process.env.GITHUB_SHA,
      actor: process.env.GITHUB_ACTOR,
      runId: process.env.GITHUB_RUN_ID,
      completedAt: new Date().toISOString(),
    });
    if (summaryFile) await appendFile(resolve(summaryFile), report, "utf8");
    console.log(report);
    for (const warning of health.warnings) {
      console.warn(`::warning title=Outflow reminder operations::${warning}`);
    }
    if (!health.healthy) {
      console.error("::error title=Outflow reminder operations::Critical reminder health thresholds were exceeded.");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Reminder operations check failed.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
