import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildAccountPlaneReport,
  openRealtimeProbe,
  probeHostedCalendarLifecycle,
  probeHostedRealtimeReconnect,
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
    "hosted calendar publication",
    "calendar cache revalidation",
    "calendar token rotation",
    "calendar feed revocation",
    "idempotent write replay",
    "stale revision conflict",
    "authoritative reconnect catch-up",
    "post-reconnect Realtime delivery",
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

  assert.match(report, /PASS\*\* \(21 authenticated checks\)/);
  assert.match(report, /PASS \/ cross-user ledger isolation/);
  assert.match(report, /PASS \/ two-client Realtime delivery/);
  assert.match(report, /PASS \/ authoritative reconnect catch-up/);
  assert.match(report, /PASS \/ post-reconnect Realtime delivery/);
  assert.match(report, /Migration Inventory \(2\)/);
  assert.match(report, /Browser-visible reconnect behavior, provider email, third-party calendar clients/);
  assert.doesNotMatch(report, /sb_(?:publishable|secret)_|@example\.com|Bearer\s|password|A{43}|B{43}/i);
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

test("hosted reconnect probe rejects a missed stale write, catches up, and receives the next update", async () => {
  const editorUserId = "22222222-2222-4222-8222-222222222222";
  const subscriptionId = "accept-subscription";
  const initialSnapshot = [{ id: subscriptionId, amount: 33 }];
  const disconnectedSnapshot = [{ id: subscriptionId, amount: 44 }];
  const reconnectedSnapshot = [{ id: subscriptionId, amount: 55 }];
  const editorCalls = [];
  const ownerCalls = [];
  const editorClient = {
    async rpc(name, body) {
      editorCalls.push({ name, body });
      assert.equal(name, "replace_ledger_snapshot");
      assert.match(body.client_operation_id, /^[0-9a-f-]{36}$/);
      if (body.expected_revision === 1) {
        return { data: { status: "applied", baseRevision: 1, currentRevision: 2 }, error: null };
      }
      if (body.expected_revision === 2) {
        return { data: { status: "applied", baseRevision: 2, currentRevision: 3 }, error: null };
      }
      return { data: null, error: { code: "unexpected_revision" } };
    },
  };
  const ownerClient = {
    async rpc(name, body) {
      ownerCalls.push({ name, body });
      assert.equal(name, "replace_ledger_snapshot");
      assert.match(body.client_operation_id, /^[0-9a-f-]{36}$/);
      return { data: { status: "conflict", baseRevision: 1, currentRevision: 2 }, error: null };
    },
  };
  let readCount = 0;
  const readState = async (client, ledgerId) => {
    assert.equal(client, ownerClient);
    assert.equal(ledgerId, "accept-ledger");
    readCount += 1;
    return readCount === 1
      ? {
        revision: 2,
        subscriptions: [{ id: subscriptionId, amount: "44.0000", revision: 1, updated_by: editorUserId }],
      }
      : {
        revision: 3,
        subscriptions: [{ id: subscriptionId, amount: "55.0000", revision: 2, updated_by: editorUserId }],
      };
  };
  let closeCount = 0;
  const openProbe = (client, ledgerId, expectedSubscriptionId, timeoutMs, event) => {
    assert.equal(client, ownerClient);
    assert.equal(ledgerId, "accept-ledger");
    assert.equal(expectedSubscriptionId, subscriptionId);
    assert.equal(timeoutMs, 15_000);
    assert.equal(event, "UPDATE");
    return {
      subscribed: Promise.resolve("SUBSCRIBED"),
      delivered: Promise.resolve({ eventType: "UPDATE", schema: "public", table: "subscriptions" }),
      async close() {
        closeCount += 1;
        return "ok";
      },
    };
  };

  const completed = await probeHostedRealtimeReconnect({
    ownerClient,
    editorClient,
    ledgerId: "accept-ledger",
    subscriptionId,
    editorUserId,
    initialSnapshot,
    disconnectedSnapshot,
    reconnectedSnapshot,
    readState,
    openProbe,
  });

  assert.deepEqual(completed, [
    "stale revision conflict",
    "authoritative reconnect catch-up",
    "post-reconnect Realtime delivery",
  ]);
  assert.deepEqual(editorCalls.map(({ body }) => [body.expected_revision, body.subscriptions_payload]), [
    [1, disconnectedSnapshot],
    [2, reconnectedSnapshot],
  ]);
  assert.equal(ownerCalls.length, 1);
  assert.equal(ownerCalls[0].body.expected_revision, 1);
  assert.equal(ownerCalls[0].body.subscriptions_payload, initialSnapshot);
  assert.equal(readCount, 2);
  assert.equal(closeCount, 1);
});

test("hosted calendar probe validates private HTTP lifecycle without returning feed secrets", async () => {
  const firstToken = "A".repeat(43);
  const secondToken = "B".repeat(43);
  const etag = `"${"c".repeat(64)}"`;
  let activeToken = "";
  let publishCount = 0;
  const rpcCalls = [];
  const client = {
    async rpc(name, body) {
      rpcCalls.push({ name, body });
      if (name === "create_or_rotate_calendar_feed") {
        publishCount += 1;
        activeToken = publishCount === 1 ? firstToken : secondToken;
        return { data: { ledgerId: "accept-ledger", includePaused: false, token: activeToken }, error: null };
      }
      if (name === "get_calendar_feed") {
        return { data: activeToken ? { ledgerId: "accept-ledger", includePaused: false } : null, error: null };
      }
      if (name === "revoke_calendar_feed") {
        activeToken = "";
        return { data: true, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
  };
  const calendarHeaders = {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": 'inline; filename="outflow-accept-ledger.ics"',
    "Cache-Control": "private, no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
  };
  const body = [
    "BEGIN:VCALENDAR",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:accept-subscription.accept-ledger@outflow.local",
    "SUMMARY:Editor Acceptance / $33.00",
    "DTSTART;VALUE=DATE:20260819",
    "RRULE:FREQ=MONTHLY",
    "CLASS:PRIVATE",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const requestedTokens = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const token = url.searchParams.get("token");
    requestedTokens.push(token);
    if (token !== activeToken) {
      return new Response('{"error":"Calendar feed not found."}', {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (init.headers?.["If-None-Match"] === etag) return new Response(null, { status: 304, headers: calendarHeaders });
    return new Response(init.method === "HEAD" ? null : body, { status: 200, headers: calendarHeaders });
  };

  const completed = await probeHostedCalendarLifecycle({
    client,
    projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
    ledgerId: "accept-ledger",
    subscriptionId: "accept-subscription",
    forbiddenFragments: ["private-account-id", "synthetic"],
    fetchImpl,
  });
  assert.deepEqual(completed, [
    "hosted calendar publication",
    "calendar cache revalidation",
    "calendar token rotation",
    "calendar feed revocation",
  ]);
  assert.deepEqual(requestedTokens, [firstToken, firstToken, firstToken, firstToken, secondToken, secondToken]);
  assert.equal(rpcCalls.filter(({ name }) => name === "create_or_rotate_calendar_feed").length, 2);
  assert.equal(rpcCalls.at(-1).name, "get_calendar_feed");
  assert.doesNotMatch(JSON.stringify(completed), new RegExp(`${firstToken}|${secondToken}`));
});

test("the account-plane workflow is manual, protected, and provider-secret free", async () => {
  const source = await readFile(new URL("../.github/workflows/staging-account-plane.yml", import.meta.url), "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /\b(push|pull_request|schedule):/);
  assert.match(source, /environment: staging/);
  assert.match(source, /if: github\.ref == 'refs\/heads\/main'/);
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
  assert.match(source, /event = "INSERT"/);
  assert.match(source, /await realtime\.delivered/);
  assert.match(source, /removeChannel\(channel\)/);
  assert.match(source, /probeHostedRealtimeReconnect/);
  assert.match(source, /expected_revision: 2/);
  assert.match(source, /15_000, "UPDATE"/);
  assert.ok(
    source.indexOf('assert(await realtime.close() === "ok"')
      < source.lastIndexOf("completed.push(...await probeHostedRealtimeReconnect({"),
  );
  assert.match(source, /probeHostedCalendarLifecycle/);
  assert.match(source, /If-None-Match/);
  assert.match(source, /method: "HEAD"/);
  assert.match(source, /revoke_calendar_feed/);
  assert.match(source, /functions\/v1\/delete-account/);
  assert.match(source, /finally \{/);
  assert.match(source, /cleanupAcceptance\(admin, createdUserIds, closeRealtime\)/);
  assert.ok(source.indexOf("createdUserIds.push(ownerUser.id)") < source.indexOf("member account setup"));
  assert.doesNotMatch(source, /console\.log\([^\n]*(email|password|token|secret)/i);
});
