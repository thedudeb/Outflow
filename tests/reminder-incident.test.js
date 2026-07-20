import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  REMINDER_INCIDENT_MARKER,
  REMINDER_INCIDENT_TITLE,
  resolveReminderIncidentConfig,
  syncReminderOperationsIncident,
} from "../scripts/sync-reminder-operations-incident.mjs";

const commitSha = "a".repeat(40);
const token = `ghs_${"t".repeat(40)}`;

function environment(overrides = {}) {
  return {
    GITHUB_REPOSITORY: "thedudeb/Outflow",
    OUTFLOW_OPERATIONS_ASSIGNEE: "thedudeb",
    GITHUB_TOKEN: token,
    GITHUB_API_URL: "https://api.github.com",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_RUN_ID: "123456789",
    GITHUB_SHA: commitSha,
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function issue(number = 7, overrides = {}) {
  return {
    number,
    title: REMINDER_INCIDENT_TITLE,
    body: `${REMINDER_INCIDENT_MARKER}\nprivacy-safe incident`,
    assignees: [{ login: "thedudeb" }],
    ...overrides,
  };
}

test("incident configuration binds one repository, operator, run, and exact commit", () => {
  const valid = resolveReminderIncidentConfig(environment(), "failure");
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.repository, "thedudeb/Outflow");
  assert.equal(valid.operator, "thedudeb");

  const invalid = resolveReminderIncidentConfig(environment({
    GITHUB_REPOSITORY: "not a repository",
    OUTFLOW_OPERATIONS_ASSIGNEE: "@invalid",
    GITHUB_TOKEN: "weak",
    GITHUB_API_URL: "http://api.github.com",
    GITHUB_SERVER_URL: "https://github.com/path",
    GITHUB_RUN_ID: "run-id",
    GITHUB_SHA: "not-a-commit",
  }), "unknown");
  assert.match(invalid.errors.join("\n"), /GITHUB_REPOSITORY/);
  assert.match(invalid.errors.join("\n"), /OUTFLOW_OPERATIONS_ASSIGNEE/);
  assert.match(invalid.errors.join("\n"), /GITHUB_TOKEN/);
  assert.match(invalid.errors.join("\n"), /GITHUB_API_URL/);
  assert.match(invalid.errors.join("\n"), /GITHUB_SERVER_URL/);
  assert.match(invalid.errors.join("\n"), /GITHUB_RUN_ID/);
  assert.match(invalid.errors.join("\n"), /GITHUB_SHA/);
  assert.match(invalid.errors.join("\n"), /status/);
  assert.doesNotMatch(invalid.errors.join("\n"), /weak|not-a-commit/);
});

test("a failed health run creates one assigned privacy-bounded incident", async () => {
  const config = resolveReminderIncidentConfig(environment(), "failure");
  const requests = [];
  const result = await syncReminderOperationsIncident(config, {
    fetchImpl: async (input, init) => {
      const request = { url: String(input), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
      requests.push(request);
      if (request.url.includes("/issues?")) return jsonResponse([]);
      if (request.url.endsWith("/assignees/thedudeb")) return new Response(null, { status: 204 });
      if (request.url.endsWith("/issues") && request.method === "POST") {
        return jsonResponse(issue(18, { body: request.body.body, assignees: [{ login: "thedudeb" }] }), 201);
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    },
  });

  assert.deepEqual(result, { action: "created", issueNumber: 18 });
  const created = requests.find((request) => request.method === "POST");
  assert.equal(created.body.title, REMINDER_INCIDENT_TITLE);
  assert.deepEqual(created.body.assignees, ["thedudeb"]);
  assert.match(created.body.body, /Assigned operator: @thedudeb/);
  assert.match(created.body.body, new RegExp(commitSha));
  assert.match(created.body.body, /actions\/runs\/123456789/);
  assert.match(created.body.body, /no account, recipient, ledger, subscription, provider/);
  assert.doesNotMatch(created.body.body, /Bearer |ghs_|@example|sb_secret_|RESEND|STRIPE|OUTFLOW_OPERATIONS_SECRET/);
  assert.equal(requests[0].headers.Authorization, `Bearer ${token}`);
});

test("a repeated failure updates the assigned incident and appends bounded run evidence", async () => {
  const config = resolveReminderIncidentConfig(environment(), "failure");
  const requests = [];
  const result = await syncReminderOperationsIncident(config, {
    fetchImpl: async (input, init) => {
      const request = { url: String(input), method: init.method, body: init.body ? JSON.parse(init.body) : null };
      requests.push(request);
      if (request.url.includes("/issues?")) return jsonResponse([issue()]);
      if (request.url.endsWith("/assignees/thedudeb")) return new Response(null, { status: 204 });
      if (request.url.endsWith("/issues/7") && request.method === "PATCH") return jsonResponse(issue());
      if (request.url.endsWith("/issues/7/comments")) return jsonResponse({ id: 1 }, 201);
      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    },
  });

  assert.deepEqual(result, { action: "updated", issueNumber: 7 });
  assert.deepEqual(requests.find((request) => request.method === "PATCH").body, { assignees: ["thedudeb"] });
  const comment = requests.find((request) => request.url.endsWith("/comments")).body.body;
  assert.match(comment, /failed again/);
  assert.match(comment, /actions\/runs\/123456789/);
  assert.doesNotMatch(comment, /Bearer |ghs_|accountId|subscriptionId|response body/);
});

test("a healthy run resolves the exact open incident and does nothing when none exists", async () => {
  const config = resolveReminderIncidentConfig(environment(), "success");
  const requests = [];
  const resolved = await syncReminderOperationsIncident(config, {
    fetchImpl: async (input, init) => {
      const request = { url: String(input), method: init.method, body: init.body ? JSON.parse(init.body) : null };
      requests.push(request);
      if (request.url.includes("/issues?")) return jsonResponse([issue(12)]);
      if (request.url.endsWith("/issues/12/comments")) return jsonResponse({ id: 2 }, 201);
      if (request.url.endsWith("/issues/12") && request.method === "PATCH") return jsonResponse({ ...issue(12), state: "closed" });
      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    },
  });
  assert.deepEqual(resolved, { action: "resolved", issueNumber: 12 });
  assert.deepEqual(requests.find((request) => request.method === "PATCH").body, { state: "closed", state_reason: "completed" });
  assert.match(requests.find((request) => request.url.endsWith("/comments")).body.body, /recovered/);
  assert.equal(requests.some((request) => request.url.includes("/assignees/")), false);

  const none = await syncReminderOperationsIncident(config, {
    fetchImpl: async () => jsonResponse([]),
  });
  assert.deepEqual(none, { action: "none", issueNumber: null });
});

test("remote errors are bounded and duplicate incidents fail closed", async () => {
  const config = resolveReminderIncidentConfig(environment(), "failure");
  await assert.rejects(() => syncReminderOperationsIncident(config, {
    fetchImpl: async () => jsonResponse({ message: "private@example.com Bearer private-token" }, 500),
  }), /failed \(http-500\)/);
  await assert.rejects(() => syncReminderOperationsIncident(config, {
    fetchImpl: async () => jsonResponse([issue(1), issue(2)]),
  }), /Multiple open reminder incidents/);

  let requestCount = 0;
  await assert.rejects(() => syncReminderOperationsIncident(
    resolveReminderIncidentConfig(environment(), "success"),
    {
      fetchImpl: async () => {
        requestCount += 1;
        if (requestCount === 1) return jsonResponse([issue(3)]);
        if (requestCount === 2) return jsonResponse({ id: 3 }, 201);
        return jsonResponse({ ...issue(3), state: "open" });
      },
    },
  ), /did not close/);
});

test("workflow routes health failure and recovery through the named incident path", async () => {
  const workflow = await readFile(new URL("../.github/workflows/reminder-operations.yml", import.meta.url), "utf8");
  const quality = await readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8");
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /id: health/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /outcome: \$\{\{ steps\.health\.outcome \}\}/);
  assert.match(workflow, /needs: reminder-health/);
  assert.match(workflow, /needs\.reminder-health\.outputs\.outcome == 'success'/);
  assert.match(workflow, /needs\.reminder-health\.outputs\.outcome == 'failure'/);
  assert.match(workflow, /npm run check:reminder-incident -- --status/);
  assert.match(workflow, /OUTFLOW_OPERATIONS_ASSIGNEE: \$\{\{ vars\.OUTFLOW_OPERATIONS_ASSIGNEE \}\}/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(workflow, /name: Enforce aggregate reminder health[\s\S]*run: exit 1/);
  const healthJob = workflow.slice(workflow.indexOf("reminder-health:"), workflow.indexOf("reminder-incident:"));
  assert.doesNotMatch(healthJob, /issues: write|GITHUB_TOKEN|OUTFLOW_OPERATIONS_ASSIGNEE/);
  const incidentJob = workflow.slice(workflow.indexOf("reminder-incident:"));
  assert.doesNotMatch(incidentJob, /environment: staging|OUTFLOW_OPERATIONS_SECRET|SUPABASE_/);
  assert.match(quality, /npm run test:reminder-incident/);
});
