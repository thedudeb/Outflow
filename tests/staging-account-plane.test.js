import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildAccountPlaneReport,
  openRealtimeProbe,
  resolveAccountAcceptanceConfig,
} from "../scripts/check-staging-account-plane.mjs";

const projectRef = "abcdefghijklmnopqrst";
const publishableKey = `sb_publishable_${"p".repeat(24)}`;
const secretKey = `sb_secret_${"s".repeat(24)}`;

function environment(overrides = {}) {
  return {
    SUPABASE_URL: `https://${projectRef}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SECRET_KEY: secretKey,
    OUTFLOW_APP_URL: "https://staging.outflow.example",
    OUTFLOW_ACCEPTANCE_PROJECT_REF: projectRef,
    OUTFLOW_ACCEPTANCE_MODE: "staging",
    ...overrides,
  };
}

test("account-plane configuration binds destructive setup to one hosted staging project", () => {
  const valid = resolveAccountAcceptanceConfig(environment());
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.projectRef, projectRef);
  assert.equal(valid.appOrigin, "https://staging.outflow.example");
  assert.equal(
    resolveAccountAcceptanceConfig(environment({ OUTFLOW_APP_URL: "https://staging.outflow.example/" })).appOrigin,
    "https://staging.outflow.example",
  );

  const invalid = resolveAccountAcceptanceConfig(environment({
    SUPABASE_URL: "https://production.example.com",
    OUTFLOW_APP_URL: "http://localhost:5173",
    OUTFLOW_ACCEPTANCE_MODE: "production",
    SUPABASE_SECRET_KEY: publishableKey,
  }));
  assert.ok(invalid.errors.some((error) => error.includes("SUPABASE_URL")));
  assert.ok(invalid.errors.some((error) => error.includes("OUTFLOW_APP_URL")));
  assert.ok(invalid.errors.some((error) => error.includes("OUTFLOW_ACCEPTANCE_MODE")));
  assert.ok(invalid.errors.some((error) => error.includes("must differ")));
});

test("account-plane report records bounded evidence without synthetic identities or credentials", () => {
  const completed = [
    "synthetic accounts",
    "transactional guest migration",
    "migration replay",
    "cross-user ledger isolation",
    "cross-user write isolation",
    "invitation authorization",
    "private invitation acceptance",
    "viewer write denial",
    "editor revision write",
    "two-client Realtime delivery",
    "idempotent write replay",
    "stale revision conflict",
    "member access revocation",
    "account deletion function",
    "cascade cleanup",
  ];
  const report = buildAccountPlaneReport({
    projectUrl: `https://${projectRef}.supabase.co`,
    appOrigin: "https://staging.outflow.example",
    completed,
    migrations: [
      "20260719133000_account_foundation.sql",
      "not-a-migration.sql",
      "20260719213000_cloud_ledger_sync.sql",
    ],
    commit: "abcdef1234567890",
    actor: "outflow-ci",
    recordedAt: "2026-07-19T12:00:00.000Z",
    runUrl: "https://github.com/thedudeb/Outflow/actions/runs/123",
  });

  assert.match(report, /PASS\*\* \(15 authenticated checks\)/);
  assert.match(report, /PASS \/ cross-user ledger isolation/);
  assert.match(report, /PASS \/ two-client Realtime delivery/);
  assert.match(report, /Migration Inventory \(2\)/);
  assert.match(report, /Provider email, Realtime reconnect behavior/);
  assert.doesNotMatch(report, /publishable|sb_secret|@outflow\.invalid|password|token/i);
  assert.doesNotMatch(report, /not-a-migration/);
  assert.throws(
    () => buildAccountPlaneReport({
      projectUrl: `https://${projectRef}.supabase.co`,
      appOrigin: "https://staging.outflow.example",
      completed: completed.slice(0, -1),
      migrations: [],
    }),
    /complete ordered acceptance inventory/,
  );
});

test("Realtime probe waits for the exact authenticated insert and removes its channel", async () => {
  let changeHandler;
  let statusHandler;
  let removedChannel;
  const channel = {
    on(type, filter, handler) {
      assert.equal(type, "postgres_changes");
      assert.deepEqual(filter, {
        event: "INSERT",
        schema: "public",
        table: "subscriptions",
        filter: "ledger_id=eq.accept-ledger",
      });
      changeHandler = handler;
      return this;
    },
    subscribe(handler) {
      statusHandler = handler;
      return this;
    },
  };
  const client = {
    channel(name) {
      assert.match(name, /^outflow-acceptance-[0-9a-f-]{36}$/);
      return channel;
    },
    async removeChannel(target) {
      removedChannel = target;
      return "ok";
    },
  };

  const probe = openRealtimeProbe(client, "accept-ledger", "accept-subscription", 1_000);
  statusHandler("SUBSCRIBED");
  assert.equal(await probe.subscribed, "SUBSCRIBED");
  changeHandler({
    eventType: "INSERT",
    schema: "public",
    table: "subscriptions",
    new: { ledger_id: "another-ledger", id: "accept-subscription" },
  });
  changeHandler({
    eventType: "INSERT",
    schema: "public",
    table: "subscriptions",
    new: { ledger_id: "accept-ledger", id: "accept-subscription", amount: "private-row-data" },
  });
  assert.deepEqual(await probe.delivered, {
    eventType: "INSERT",
    schema: "public",
    table: "subscriptions",
  });
  assert.equal(await probe.close(), "ok");
  assert.equal(removedChannel, channel);
});

test("the account-plane workflow is manual, protected, and provider-secret free", async () => {
  const source = await readFile(new URL("../.github/workflows/staging-account-plane.yml", import.meta.url), "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /\b(push|pull_request|schedule):/);
  assert.match(source, /environment: staging/);
  assert.match(source, /permissions:\n\s+contents: read/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /OUTFLOW_ACCEPTANCE_MODE: staging/);
  assert.match(source, /secrets\.OUTFLOW_SUPABASE_SECRET_KEY/);
  const liveStep = source.slice(source.indexOf("- name: Run authenticated account-plane acceptance"));
  assert.doesNotMatch(source.slice(0, source.indexOf("- name: Run authenticated account-plane acceptance")), /OUTFLOW_SUPABASE_SECRET_KEY/);
  assert.match(liveStep, /env:\n[\s\S]*secrets\.OUTFLOW_SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(source, /STRIPE|RESEND|WEBHOOK|CRON/);
  assert.match(source, /npm run test:staging-account-plane/);
  assert.match(source, /npm run check:staging-account-plane/);

  const quality = await readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8");
  assert.match(quality, /npm run test:staging-account-plane/);
});

test("the live harness uses authenticated sessions, fixed assertions, and finally cleanup", async () => {
  const source = await readFile(new URL("../scripts/check-staging-account-plane.mjs", import.meta.url), "utf8");
  assert.match(source, /signInWithPassword/);
  assert.match(source, /migrate_guest_workspace/);
  assert.match(source, /accept_ledger_invitation/);
  assert.match(source, /replace_ledger_snapshot/);
  assert.match(source, /postgres_changes/);
  assert.match(source, /event: "INSERT"/);
  assert.match(source, /await realtime\.delivered/);
  assert.match(source, /removeChannel\(channel\)/);
  assert.match(source, /functions\/v1\/delete-account/);
  assert.match(source, /finally \{/);
  assert.match(source, /cleanupAcceptance\(admin, createdUserIds, closeRealtime\)/);
  assert.ok(source.indexOf("createdUserIds.push(ownerUser.id)") < source.indexOf("member account setup"));
  assert.doesNotMatch(source, /console\.log\([^\n]*(email|password|token|secret)/i);
});
