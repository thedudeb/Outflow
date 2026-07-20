import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildReminderOperationsReport,
  checkReminderOperations,
  reminderOperationsHealthMatches,
  resolveReminderOperationsConfig,
} from "../scripts/check-reminder-operations.mjs";

const projectRef = "abcdefghijklmnopqrst";
const expectedCommit = "a".repeat(40);
const operationsSecret = "operations-health-secret-0123456789-ABCDEFG";

function environment(overrides = {}) {
  return {
    SUPABASE_URL: `https://${projectRef}.supabase.co`,
    OUTFLOW_ACCEPTANCE_PROJECT_REF: projectRef,
    OUTFLOW_ACCEPTANCE_MODE: "staging",
    OUTFLOW_EXPECTED_DEPLOYMENT_COMMIT: expectedCommit,
    OUTFLOW_OPERATIONS_SECRET: operationsSecret,
    ...overrides,
  };
}

function healthy(overrides = {}) {
  return {
    schemaVersion: 1,
    healthy: true,
    lastRunAt: "2026-07-20T02:23:00.000Z",
    recentRun: true,
    latestCommitMatches: true,
    runs1h: 1,
    claimed1h: 3,
    sent1h: 3,
    failed1h: 0,
    completionErrors1h: 0,
    exhaustedDeliveries: 0,
    overdueRetries: 0,
    stuckClaims: 0,
    suppressions24h: 0,
    alerts: [],
    warnings: [],
    ...overrides,
  };
}

test("reminder operations configuration is bound to one hosted staging commit", () => {
  const valid = resolveReminderOperationsConfig(environment());
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.projectRef, projectRef);
  assert.equal(valid.operationsSecret, operationsSecret);
  assert.equal(valid.expectedDeploymentCommit, expectedCommit);

  const invalid = resolveReminderOperationsConfig(environment({
    SUPABASE_URL: "https://production.example.com",
    OUTFLOW_ACCEPTANCE_PROJECT_REF: "another-project",
    OUTFLOW_ACCEPTANCE_MODE: "production",
    OUTFLOW_EXPECTED_DEPLOYMENT_COMMIT: "not-a-commit",
    OUTFLOW_OPERATIONS_SECRET: "repeated-repeated-repeated-repeated",
  }));
  assert.match(invalid.errors.join("\n"), /SUPABASE_URL/);
  assert.match(invalid.errors.join("\n"), /OUTFLOW_ACCEPTANCE_PROJECT_REF/);
  assert.match(invalid.errors.join("\n"), /literal value staging/);
  assert.match(invalid.errors.join("\n"), /OUTFLOW_EXPECTED_DEPLOYMENT_COMMIT/);
  assert.match(invalid.errors.join("\n"), /OUTFLOW_OPERATIONS_SECRET/);
});

test("aggregate health accepts only the fixed internally consistent privacy surface", () => {
  assert.equal(reminderOperationsHealthMatches(healthy()), true);
  assert.equal(reminderOperationsHealthMatches(healthy({ extra: "private" })), false);
  assert.equal(reminderOperationsHealthMatches(healthy({ claimed1h: 4 })), false);
  assert.equal(reminderOperationsHealthMatches(healthy({ recentRun: false })), false);
  assert.equal(reminderOperationsHealthMatches(healthy({ warnings: ["unknown"] })), false);

  const degraded = healthy({
    healthy: false,
    latestCommitMatches: false,
    claimed1h: 12,
    sent1h: 0,
    failed1h: 12,
    completionErrors1h: 1,
    exhaustedDeliveries: 1,
    overdueRetries: 1,
    stuckClaims: 1,
    suppressions24h: 1,
    alerts: [
      "commit_mismatch",
      "completion_errors",
      "exhausted_deliveries",
      "stuck_claims",
      "failure_spike",
    ],
    warnings: ["retry_backlog", "suppression_growth"],
  });
  assert.equal(reminderOperationsHealthMatches(degraded), true);
});

test("operations probe calls only the dedicated worker health action for the expected commit", async () => {
  const config = resolveReminderOperationsConfig(environment());
  let request;
  const result = await checkReminderOperations(config, {
    fetchImpl: async (input, init) => {
      request = { input, init };
      return new Response(JSON.stringify(healthy()), {
        status: 200,
        headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(request.input, `https://${projectRef}.supabase.co/functions/v1/send-due-reminders`);
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Authorization, `Bearer ${operationsSecret}`);
  assert.deepEqual(JSON.parse(request.init.body), { action: "health", expectedCommit });
  assert.deepEqual(result, healthy());

  await assert.rejects(() => checkReminderOperations(config, {
    fetchImpl: async () => new Response(JSON.stringify({ error: "private@example.com" }), {
      status: 500,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
    }),
  }), /failed \(http-500\)/);
});

test("operations report contains fixed aggregate evidence without private service data", () => {
  const report = buildReminderOperationsReport({
    health: healthy({ warnings: ["provider_failures"], claimed1h: 4, sent1h: 3, failed1h: 1 }),
    projectRef,
    commitSha: expectedCommit,
    actor: "release-operator",
    runId: "12345",
    completedAt: "2026-07-20T02:24:00.000Z",
  });
  assert.match(report, /Status: `healthy`/);
  assert.match(report, /Warnings: `provider_failures`/);
  assert.match(report, /Claimed \/ sent \/ failed \/ 1h: `4 \/ 3 \/ 1`/);
  assert.match(report, /aggregate counters and fixed operational codes only/);
  assert.doesNotMatch(report, /@|Bearer |sb_secret_|providerMessageId|subscriptionId|https:\/\//);
});

test("scheduled operations workflow is opt-in, protected, and receives no provider or deployment secrets", async () => {
  const workflow = await readFile(new URL("../.github/workflows/reminder-operations.yml", import.meta.url), "utf8");
  const quality = await readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8");
  assert.match(workflow, /cron: "23 \* \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /vars\.OUTFLOW_OPERATIONS_ENABLED == 'true'/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /OUTFLOW_OPERATIONS_SECRET: \$\{\{ secrets\.OUTFLOW_OPERATIONS_SECRET \}\}/);
  assert.match(workflow, /OUTFLOW_EXPECTED_DEPLOYMENT_COMMIT: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /SUPABASE_(?:PUBLISHABLE|SECRET)_KEY|RESEND|STRIPE|CRON_SECRET|ACCESS_TOKEN|DB_PASSWORD|functions deploy|db push/);
  assert.match(quality, /npm run test:reminder-operations/);
});
