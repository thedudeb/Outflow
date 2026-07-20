import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildMessagingPlaneReport,
  extractInvitationToken,
  invokeReminderWorker,
  replayResendDelivery,
  resolveMessagingAcceptanceConfig,
  schedulerStatusMatches,
  waitForResendDelivery,
  waitForResendEvent,
} from "../scripts/check-staging-messaging-plane.mjs";

const projectRef = "abcdefghijklmnopqrst";
const publishableKey = `sb_publishable_${"p".repeat(24)}`;
const secretKey = `sb_secret_${"s".repeat(24)}`;
const resendKey = `re_${"r".repeat(24)}`;
const cronSecret = "acceptance-cron-secret-0123456789-ABCDEFG";

function environment(overrides = {}) {
  return {
    SUPABASE_URL: `https://${projectRef}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SECRET_KEY: secretKey,
    OUTFLOW_APP_URL: "https://staging.outflow.example",
    OUTFLOW_ACCEPTANCE_PROJECT_REF: projectRef,
    OUTFLOW_ACCEPTANCE_MODE: "staging",
    RESEND_API_KEY: resendKey,
    OUTFLOW_CRON_SECRET: cronSecret,
    ...overrides,
  };
}

const checks = [
  "cron scheduler registration",
  "synthetic messaging accounts",
  "provider invitation delivery",
  "invitation content privacy",
  "private invitation acceptance",
  "active reminder delivery",
  "provider reminder delivery",
  "paused reminder exclusion",
  "durable reminder retry",
  "retry provider delivery",
  "reminder idempotent replay",
  "paused reminder opt-in",
  "provider bounce event",
  "provider suppression",
  "suppression recovery",
  "provider complaint event",
  "complaint suppression",
  "email opt-out suspension",
  "refund suspension",
  "synthetic messaging cleanup",
];

test("messaging-plane configuration binds provider access to one protected staging project", () => {
  const valid = resolveMessagingAcceptanceConfig(environment());
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.projectRef, projectRef);
  assert.equal(valid.appOrigin, "https://staging.outflow.example");
  assert.equal(valid.resendKey, resendKey);

  const invalid = resolveMessagingAcceptanceConfig(environment({
    SUPABASE_URL: "https://production.example.com",
    OUTFLOW_APP_URL: "http://localhost:5173",
    OUTFLOW_ACCEPTANCE_MODE: "production",
    RESEND_API_KEY: "invalid",
    OUTFLOW_CRON_SECRET: "repeated-repeated-repeated-repeated",
  }));
  assert.match(invalid.errors.join("\n"), /SUPABASE_URL/);
  assert.match(invalid.errors.join("\n"), /OUTFLOW_APP_URL/);
  assert.match(invalid.errors.join("\n"), /literal value staging/);
  assert.match(invalid.errors.join("\n"), /RESEND_API_KEY/);
  assert.match(invalid.errors.join("\n"), /OUTFLOW_CRON_SECRET/);
});

test("scheduler status requires the exact redacted Cron and Vault health contract", () => {
  const healthy = {
    cronReady: true,
    networkReady: true,
    vaultReady: true,
    endpointConfigured: true,
    cronSecretConfigured: true,
    jobConfigured: true,
    jobActive: true,
    schedule: "7 * * * *",
    lastRunStatus: "succeeded",
    lastRunAt: "2026-07-20T01:07:00.000Z",
    lastSuccessAt: "2026-07-20T01:07:00.000Z",
    recentSuccess: true,
    workerRequestStatus: 200,
    workerRequestAt: "2026-07-20T01:07:01.000Z",
    workerReached: true,
    healthy: true,
  };
  assert.equal(schedulerStatusMatches(healthy), true);
  assert.equal(schedulerStatusMatches({ ...healthy, recentSuccess: false, healthy: false }), false);
  assert.equal(schedulerStatusMatches({ ...healthy, schedule: "* * * * *" }), false);
  assert.equal(schedulerStatusMatches({ ...healthy, workerRequestStatus: 401, workerReached: false, healthy: false }), false);
  assert.equal(schedulerStatusMatches({ ...healthy, endpoint: "https://secret.example" }), false);
});

test("Resend receipt probe correlates an exact synthetic recipient and waits for delivery", async () => {
  const recipient = "delivered+acceptance@resend.dev";
  const providerId = "11111111-1111-4111-8111-111111111111";
  const createdAt = "2026-07-19T12:00:01.000Z";
  const requests = [];
  let receiptReads = 0;
  const response = (body) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  const fetchImpl = async (input, init) => {
    requests.push({ url: String(input), method: init.method, headers: new Headers(init.headers) });
    if (String(input).endsWith("/emails")) {
      return response({
        object: "list",
        has_more: false,
        data: [{
          id: providerId,
          to: [recipient],
          subject: "Invite to Acceptance Ledger",
          created_at: createdAt,
          last_event: "queued",
        }],
      });
    }
    receiptReads += 1;
    return response({
      object: "email",
      id: providerId,
      to: [recipient],
      subject: "Invite to Acceptance Ledger",
      created_at: createdAt,
      last_event: receiptReads === 1 ? "sent" : "delivered",
      text: "private content",
    });
  };
  let sleeps = 0;
  const message = await waitForResendDelivery({
    resendKey,
    recipient,
    subjectIncludes: "Acceptance Ledger",
    startedAt: Date.parse("2026-07-19T12:00:00.000Z"),
    fetchImpl,
    sleepImpl: async (milliseconds) => {
      assert.equal(milliseconds, 1_000);
      sleeps += 1;
    },
    attempts: 3,
  });

  assert.equal(message.last_event, "delivered");
  assert.equal(receiptReads, 2);
  assert.equal(sleeps, 1);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ method, headers }) => method === "GET" && headers.get("authorization") === `Bearer ${resendKey}`));
});

test("Resend event probe waits for the exact synthetic bounce", async () => {
  const recipient = "bounced+acceptance@resend.dev";
  const providerId = "11111111-1111-4111-8111-111111111111";
  let reads = 0;
  let sleeps = 0;
  const event = await waitForResendEvent({
    resendKey,
    recipient,
    subjectIncludes: "Bounce acceptance",
    providerId,
    expectedEvent: "bounced",
    startedAt: Date.parse("2026-07-19T12:00:00.000Z"),
    attempts: 3,
    sleepImpl: async (milliseconds) => {
      assert.equal(milliseconds, 1_000);
      sleeps += 1;
    },
    fetchImpl: async () => {
      reads += 1;
      return Response.json({
        id: providerId,
        to: [recipient],
        subject: "Bounce acceptance is due today",
        created_at: "2026-07-19T12:00:01.000Z",
        last_event: reads === 1 ? "sent" : "bounced",
      });
    },
  });
  assert.equal(event.last_event, "bounced");
  assert.equal(reads, 2);
  assert.equal(sleeps, 1);
});

test("Resend event probe allows delivery before the exact synthetic complaint", async () => {
  const recipient = "complained+acceptance@resend.dev";
  const providerId = "22222222-2222-4222-8222-222222222222";
  let reads = 0;
  const event = await waitForResendEvent({
    resendKey,
    recipient,
    subjectIncludes: "Complaint acceptance",
    providerId,
    expectedEvent: "complained",
    startedAt: Date.parse("2026-07-19T12:00:00.000Z"),
    attempts: 3,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      reads += 1;
      return Response.json({
        id: providerId,
        to: [recipient],
        subject: "Complaint acceptance is due today",
        created_at: "2026-07-19T12:00:01.000Z",
        last_event: reads === 1 ? "delivered" : "complained",
      });
    },
  });
  assert.equal(event.last_event, "complained");
  assert.equal(reads, 2);
});

test("invitation parser accepts only a private link for the configured application origin", () => {
  const token = "A".repeat(43);
  assert.equal(extractInvitationToken({
    text: `Open https://staging.outflow.example/#app?invite=${token} within 7 days.`,
  }, "https://staging.outflow.example"), token);
  assert.equal(extractInvitationToken({
    html: `<a href="https://staging.outflow.example/#app?invite=${token}">Accept</a>`,
  }, "https://staging.outflow.example"), token);
  assert.throws(() => extractInvitationToken({
    text: `Open https://attacker.example/#app?invite=${token}`,
  }, "https://staging.outflow.example"), /private token link was not found/);
});

test("reminder worker probe uses only its cron bearer and validates bounded counts", async () => {
  const config = resolveMessagingAcceptanceConfig(environment());
  let request;
  const result = await invokeReminderWorker(config, async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({ claimed: 2, sent: 1, failed: 1, completionErrors: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  assert.deepEqual(result, { claimed: 2, sent: 1, failed: 1, completionErrors: 0 });
  assert.equal(request.input, `https://${projectRef}.supabase.co/functions/v1/send-due-reminders`);
  assert.equal(new Headers(request.init.headers).get("authorization"), `Bearer ${cronSecret}`);
  assert.deepEqual(JSON.parse(request.init.body), { batchSize: 100 });

  await assert.rejects(() => invokeReminderWorker(config, async () => new Response(JSON.stringify({
    claimed: 1,
    sent: 0,
    failed: 0,
    completionErrors: 0,
  }), { status: 200 })), /assertion failed/);
});

test("provider replay uses the deployed delivery key and requires the original message ID", async () => {
  const providerId = "11111111-1111-4111-8111-111111111111";
  const deliveryId = "22222222-2222-4222-8222-222222222222";
  const message = {
    id: providerId,
    from: "Outflow <reminders@example.test>",
    to: ["delivered+acceptance@resend.dev"],
    subject: "Acceptance charge is due today",
    text: "Acceptance charge is due today.",
    html: "<p>Acceptance charge is due today.</p>",
  };
  let request;
  const replayedId = await replayResendDelivery({
    resendKey,
    message,
    deliveryId,
    fetchImpl: async (input, init) => {
      request = { input: String(input), init };
      return new Response(JSON.stringify({ id: providerId }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(replayedId, providerId);
  const headers = new Headers(request.init.headers);
  assert.equal(request.input, "https://api.resend.com/emails");
  assert.equal(request.init.method, "POST");
  assert.equal(headers.get("authorization"), `Bearer ${resendKey}`);
  assert.equal(headers.get("idempotency-key"), `outflow-reminder/${deliveryId}`);
  assert.deepEqual(JSON.parse(request.init.body), {
    from: message.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  await assert.rejects(() => replayResendDelivery({
    resendKey,
    message,
    deliveryId,
    fetchImpl: async () => new Response(JSON.stringify({ id: "33333333-3333-4333-8333-333333333333" }), { status: 200 }),
  }), /assertion failed/);
});

test("messaging report is fixed, bounded, and free of recipient and provider data", () => {
  const report = buildMessagingPlaneReport({
    checks,
    projectRef,
    appOrigin: "https://staging.outflow.example",
    commitSha: "abcdef1234567890",
    actor: "release-operator",
    runId: "12345",
    completedAt: "2026-07-19T12:00:00.000Z",
  });
  assert.match(report, /PASS \/ provider invitation delivery/);
  assert.match(report, /PASS \/ cron scheduler registration/);
  assert.match(report, /PASS \/ durable reminder retry/);
  assert.match(report, /PASS \/ provider suppression/);
  assert.match(report, /PASS \/ complaint suppression/);
  assert.match(report, /first retry failure was injected/);
  assert.match(report, /Provider-originated signed bounce and complaint/);
  assert.match(report, /exact hourly Supabase Cron job/);
  assert.match(report, /does not prove delivery to a human inbox/);
  assert.doesNotMatch(report, /@resend\.dev|re_[A-Za-z0-9_-]+|Bearer |11111111-1111|#app\?invite=/);
  assert.throws(() => buildMessagingPlaneReport({
    checks: checks.slice(0, -1),
    projectRef,
    appOrigin: "https://staging.outflow.example",
    completedAt: "2026-07-19T12:00:00.000Z",
  }), /complete messaging acceptance inventory/);
});

test("messaging workflow confines live credentials to a protected main-ref acceptance step", async () => {
  const [workflow, script, schedulerMigration] = await Promise.all([
    readFile(new URL("../.github/workflows/staging-messaging-plane.yml", import.meta.url), "utf8"),
    readFile(new URL("../scripts/check-staging-messaging-plane.mjs", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260720233000_reminder_scheduler.sql", import.meta.url), "utf8"),
  ]);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /RESEND_API_KEY: \$\{\{ secrets\.OUTFLOW_RESEND_API_KEY \}\}/);
  assert.match(workflow, /OUTFLOW_CRON_SECRET: \$\{\{ secrets\.OUTFLOW_CRON_SECRET \}\}/);
  assert.match(workflow, /SUPABASE_SECRET_KEY: \$\{\{ secrets\.OUTFLOW_SUPABASE_SECRET_KEY \}\}/);
  assert.doesNotMatch(workflow, /pull_request:|push:/);
  assert.match(script, /delivered\+outflow-invite-\$\{suffix\}@resend\.dev/);
  assert.match(script, /delivered\+outflow-reminder-\$\{suffix\}@resend\.dev/);
  assert.match(script, /bounced\+outflow-reminder-\$\{suffix\}@resend\.dev/);
  assert.match(script, /complained\+outflow-reminder-\$\{suffix\}@resend\.dev/);
  assert.match(script, /admin\.rpc\("reminder_scheduler_status", \{ expected_project_ref: config\.projectRef \}\)/);
  assert.match(script, /notification_provider_events/);
  assert.doesNotMatch(script, /OUTFLOW_(?:INVITE|REMINDER)_RECIPIENT/);
  assert.match(schedulerMigration, /'outflow-due-reminders-hourly'/);
  assert.match(schedulerMigration, /'7 \* \* \* \*'/);
  assert.match(schedulerMigration, /'select public\.invoke_due_reminder_worker\(\);'/);
  assert.match(schedulerMigration, /revoke all on function public\.invoke_due_reminder_worker\(\) from public, anon, authenticated, service_role/);
  assert.doesNotMatch(schedulerMigration, /https:\/\/[a-z0-9]{20}\.supabase\.co|Bearer [A-Za-z0-9_-]{16,}/);
});
