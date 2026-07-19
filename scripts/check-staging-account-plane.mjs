import { appendFile, readFile, readdir } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { parseEnvFile, resolveSupabaseKeys } from "./check-service-readiness.mjs";

const expectedCheckNames = Object.freeze([
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
  "member access revocation",
  "account deletion function",
  "cascade cleanup",
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

function exactHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname === "/";
  } catch {
    return false;
  }
}

export function resolveAccountAcceptanceConfig(env) {
  const errors = [];
  const projectUrl = String(env.SUPABASE_URL || "").trim();
  const expectedProjectRef = String(env.OUTFLOW_ACCEPTANCE_PROJECT_REF || "").trim();
  const appUrl = String(env.OUTFLOW_APP_URL || "").trim();
  const mode = String(env.OUTFLOW_ACCEPTANCE_MODE || "").trim();
  const { publishableKey, secretKey } = resolveSupabaseKeys(env, errors);

  if (!hostedProjectOrigin(projectUrl)) {
    errors.push("SUPABASE_URL: expected an exact hosted Supabase project origin.");
  }
  if (!/^[a-z0-9]{20}$/.test(expectedProjectRef)) {
    errors.push("OUTFLOW_ACCEPTANCE_PROJECT_REF: expected the protected staging project reference.");
  }
  if (hostedProjectOrigin(projectUrl) && expectedProjectRef && new URL(projectUrl).hostname.split(".")[0] !== expectedProjectRef) {
    errors.push("OUTFLOW_ACCEPTANCE_PROJECT_REF: does not match the configured Supabase project.");
  }
  if (!exactHttpsOrigin(appUrl)) {
    errors.push("OUTFLOW_APP_URL: expected the staging application's exact HTTPS origin.");
  }
  if (mode !== "staging") {
    errors.push("OUTFLOW_ACCEPTANCE_MODE: must be the literal value staging.");
  }

  return {
    errors,
    projectUrl,
    projectRef: expectedProjectRef,
    appOrigin: exactHttpsOrigin(appUrl) ? new URL(appUrl).origin : "",
    publishableKey,
    secretKey,
  };
}

function assert(condition, label) {
  if (!condition) throw new Error(`${label}: assertion failed.`);
}

function remoteResult(result, label) {
  if (result?.error) {
    const code = /^[A-Za-z0-9_-]{1,40}$/.test(String(result.error.code || ""))
      ? result.error.code
      : "remote-error";
    throw new Error(`${label}: remote operation failed (${code}).`);
  }
  return result?.data;
}

function clientFor(projectUrl, key, options = {}) {
  return createClient(projectUrl, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
      ...options.auth,
    },
    ...options,
  });
}

function subscription(id, name, amount) {
  return {
    id,
    name,
    amount,
    currency: "USD",
    cycle: "monthly",
    nextBillingDate: "2026-08-19",
    category: "Acceptance",
    tags: ["synthetic"],
    color: "#f59e0b",
    trialEndDate: "",
    reminderLeadDays: [7],
    paused: false,
    revision: 0,
    createdBy: "Staging acceptance",
    updatedBy: "Staging acceptance",
    updatedAt: "2026-07-19T12:00:00.000Z",
  };
}

function workspaceFixture(suffix) {
  const personalId = `accept-personal-${suffix}`;
  const teamId = `accept-team-${suffix}`;
  return {
    workspace: {
      schemaVersion: 1,
      activeLedgerId: personalId,
      ledgers: [
        {
          ledger: { id: personalId, name: "Acceptance Personal", kind: "personal" },
          subscriptions: [subscription(`accept-private-${suffix}`, "Private Acceptance", 11)],
        },
        {
          ledger: { id: teamId, name: "Acceptance Team", kind: "team" },
          subscriptions: [subscription(`accept-shared-${suffix}`, "Shared Acceptance", 22)],
        },
      ],
    },
    personalId,
    teamId,
  };
}

async function signIn(projectUrl, publishableKey, email, password) {
  const client = clientFor(projectUrl, publishableKey);
  const data = remoteResult(await client.auth.signInWithPassword({ email, password }), "synthetic sign-in");
  assert(data?.session?.access_token && data?.user?.id, "synthetic sign-in");
  return { client, session: data.session, user: data.user };
}

async function deleteSyntheticUser(admin, userId) {
  if (!userId) return;
  const result = await admin.auth.admin.deleteUser(userId, false);
  if (result.error && !["user_not_found", "not_found"].includes(result.error.code)) {
    throw new Error("synthetic cleanup: remote operation failed.");
  }
}

async function deleteSyntheticUsers(admin, userIds) {
  let failed = false;
  for (const userId of [...userIds].reverse()) {
    try {
      await deleteSyntheticUser(admin, userId);
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error("synthetic cleanup: one or more identities could not be removed.");
}

function deferredTimeout(label, timeoutMs) {
  let settled = false;
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolvePromiseValue, rejectPromiseValue) => {
    resolvePromise = resolvePromiseValue;
    rejectPromise = rejectPromiseValue;
  });
  promise.catch(() => {});
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectPromise(new Error(`${label}: timed out.`));
  }, timeoutMs);

  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    },
    reject() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new Error(`${label}: channel failed.`));
    },
    cancel() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(null);
    },
  };
}

export function openRealtimeProbe(client, ledgerId, expectedSubscriptionId, timeoutMs = 15_000) {
  const subscribed = deferredTimeout("Realtime subscription", timeoutMs);
  const delivered = deferredTimeout("Realtime delivery", timeoutMs);
  const channel = client
    .channel(`outflow-acceptance-${randomUUID()}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "subscriptions",
      filter: `ledger_id=eq.${ledgerId}`,
    }, (payload) => {
      if (payload?.new?.ledger_id === ledgerId && payload?.new?.id === expectedSubscriptionId) {
        delivered.resolve({ eventType: payload.eventType, schema: payload.schema, table: payload.table });
      }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") subscribed.resolve(status);
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        subscribed.reject();
        delivered.reject();
      }
    });

  return {
    subscribed: subscribed.promise,
    delivered: delivered.promise,
    async close() {
      subscribed.cancel();
      delivered.cancel();
      return client.removeChannel(channel);
    },
  };
}

async function cleanupAcceptance(admin, userIds, closeRealtime) {
  let failed = false;
  try {
    await closeRealtime();
  } catch {
    failed = true;
  }
  try {
    await deleteSyntheticUsers(admin, userIds);
  } catch {
    failed = true;
  }
  if (failed) throw new Error("synthetic cleanup: one or more resources could not be removed.");
}

function calendarPrivacyHeaders(response, cacheControl) {
  return response.headers.get("cache-control") === cacheControl
    && response.headers.get("referrer-policy") === "no-referrer"
    && response.headers.get("x-content-type-options") === "nosniff";
}

async function requestCalendarFeed(projectUrl, token, fetchImpl, init = {}) {
  assert(/^[a-zA-Z0-9_-]{43}$/.test(token), "hosted calendar token");
  const url = new URL(`${projectUrl}/functions/v1/calendar-feed`);
  url.searchParams.set("token", token);
  try {
    return await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      ...init,
    });
  } catch {
    throw new Error("hosted calendar request: request failed.");
  }
}

async function boundedResponseText(response, label) {
  let body;
  try {
    body = await response.text();
  } catch {
    throw new Error(`${label}: response body could not be read.`);
  }
  assert(body.length <= 1_000_000, label);
  return body;
}

function unfoldedCalendar(body) {
  return body.replace(/\r?\n[ \t]/g, "");
}

function calendarFeedBodyIsValid(body, ledgerId, subscriptionId, forbiddenFragments) {
  const unfolded = unfoldedCalendar(body);
  return body.startsWith("BEGIN:VCALENDAR\r\n")
    && body.endsWith("END:VCALENDAR\r\n")
    && unfolded.includes("METHOD:PUBLISH\r\n")
    && unfolded.includes(`UID:${subscriptionId}.${ledgerId}@outflow.local\r\n`)
    && unfolded.includes("SUMMARY:Editor Acceptance / ")
    && unfolded.includes("DTSTART;VALUE=DATE:20260819\r\n")
    && unfolded.includes("RRULE:FREQ=MONTHLY\r\n")
    && unfolded.includes("CLASS:PRIVATE\r\n")
    && unfolded.includes("TRANSP:TRANSPARENT\r\n")
    && forbiddenFragments.every((fragment) => !body.includes(fragment));
}

export async function probeHostedCalendarLifecycle({
  client,
  projectUrl,
  ledgerId,
  subscriptionId,
  forbiddenFragments = [],
  fetchImpl = fetch,
}) {
  const publish = async () => remoteResult(await client.rpc("create_or_rotate_calendar_feed", {
    target_ledger_id: ledgerId,
    requested_include_paused: false,
  }), "hosted calendar publication");
  const firstFeed = await publish();
  assert(
    firstFeed?.ledgerId === ledgerId
      && firstFeed?.includePaused === false
      && /^[a-zA-Z0-9_-]{43}$/.test(firstFeed?.token || ""),
    "hosted calendar publication",
  );
  const metadata = remoteResult(await client.rpc("get_calendar_feed", {
    target_ledger_id: ledgerId,
  }), "hosted calendar metadata");
  assert(
    metadata?.ledgerId === ledgerId
      && metadata?.includePaused === false
      && !Object.prototype.hasOwnProperty.call(metadata, "token"),
    "hosted calendar publication",
  );

  const firstResponse = await requestCalendarFeed(projectUrl, firstFeed.token, fetchImpl);
  assert(
    firstResponse.status === 200
      && firstResponse.headers.get("content-type") === "text/calendar; charset=utf-8"
      && firstResponse.headers.get("content-disposition") === `inline; filename="outflow-${ledgerId}.ics"`
      && calendarPrivacyHeaders(firstResponse, "private, no-cache"),
    "hosted calendar publication",
  );
  const etag = firstResponse.headers.get("etag") || "";
  assert(/^"[a-f0-9]{64}"$/.test(etag), "hosted calendar publication");
  const firstBody = await boundedResponseText(firstResponse, "hosted calendar publication");
  assert(calendarFeedBodyIsValid(firstBody, ledgerId, subscriptionId, forbiddenFragments), "hosted calendar publication");

  const conditionalResponse = await requestCalendarFeed(projectUrl, firstFeed.token, fetchImpl, {
    headers: { "If-None-Match": etag },
  });
  assert(
    conditionalResponse.status === 304
      && conditionalResponse.headers.get("etag") === etag
      && calendarPrivacyHeaders(conditionalResponse, "private, no-cache")
      && await boundedResponseText(conditionalResponse, "calendar cache revalidation") === "",
    "calendar cache revalidation",
  );
  const headResponse = await requestCalendarFeed(projectUrl, firstFeed.token, fetchImpl, { method: "HEAD" });
  assert(
    headResponse.status === 200
      && headResponse.headers.get("etag") === etag
      && await boundedResponseText(headResponse, "calendar cache revalidation") === "",
    "calendar cache revalidation",
  );

  const secondFeed = await publish();
  assert(
    secondFeed?.ledgerId === ledgerId
      && /^[a-zA-Z0-9_-]{43}$/.test(secondFeed?.token || "")
      && secondFeed.token !== firstFeed.token,
    "calendar token rotation",
  );
  const oldResponse = await requestCalendarFeed(projectUrl, firstFeed.token, fetchImpl);
  assert(oldResponse.status === 404 && calendarPrivacyHeaders(oldResponse, "no-store"), "calendar token rotation");
  const oldBody = await boundedResponseText(oldResponse, "calendar token rotation");
  const rotatedResponse = await requestCalendarFeed(projectUrl, secondFeed.token, fetchImpl);
  assert(
    rotatedResponse.status === 200
      && rotatedResponse.headers.get("etag") === etag
      && calendarPrivacyHeaders(rotatedResponse, "private, no-cache"),
    "calendar token rotation",
  );
  const rotatedBody = await boundedResponseText(rotatedResponse, "calendar token rotation");
  assert(
    rotatedBody === firstBody
      && calendarFeedBodyIsValid(rotatedBody, ledgerId, subscriptionId, forbiddenFragments),
    "calendar token rotation",
  );

  const revoked = remoteResult(await client.rpc("revoke_calendar_feed", {
    target_ledger_id: ledgerId,
  }), "calendar feed revocation");
  assert(revoked === true, "calendar feed revocation");
  const revokedMetadata = remoteResult(await client.rpc("get_calendar_feed", {
    target_ledger_id: ledgerId,
  }), "revoked calendar metadata");
  assert(revokedMetadata === null, "calendar feed revocation");
  const revokedResponse = await requestCalendarFeed(projectUrl, secondFeed.token, fetchImpl);
  assert(revokedResponse.status === 404 && calendarPrivacyHeaders(revokedResponse, "no-store"), "calendar feed revocation");
  const revokedBody = await boundedResponseText(revokedResponse, "calendar feed revocation");
  assert(revokedBody === oldBody, "calendar feed revocation");

  return [
    "hosted calendar publication",
    "calendar cache revalidation",
    "calendar token rotation",
    "calendar feed revocation",
  ];
}

export async function runAccountDataPlaneAcceptance(config, { fetchImpl = fetch } = {}) {
  const completed = [];
  const admin = clientFor(config.projectUrl, config.secretKey);
  const suffix = randomBytes(8).toString("hex");
  const password = `${randomBytes(24).toString("base64url")}aA1!`;
  const ownerEmail = `outflow-owner-${suffix}@example.com`;
  const memberEmail = `outflow-member-${suffix}@example.com`;
  const createdUserIds = [];
  let closeRealtime = async () => {};

  try {
    const ownerUser = remoteResult(await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Outflow acceptance owner" },
    }), "owner account setup")?.user;
    if (ownerUser?.id) createdUserIds.push(ownerUser.id);
    const memberUser = remoteResult(await admin.auth.admin.createUser({
      email: memberEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Outflow acceptance member" },
    }), "member account setup")?.user;
    if (memberUser?.id) createdUserIds.push(memberUser.id);
    assert(ownerUser?.id && memberUser?.id, "synthetic accounts");

    const owner = await signIn(config.projectUrl, config.publishableKey, ownerEmail, password);
    const member = await signIn(config.projectUrl, config.publishableKey, memberEmail, password);
    assert(owner.user.id === ownerUser.id && member.user.id === memberUser.id, "synthetic accounts");
    completed.push("synthetic accounts");

    remoteResult(await admin.from("entitlements").upsert({
      user_id: ownerUser.id,
      product: "outflow_pro_lifetime",
      status: "active",
      provider: "manual",
      provider_reference: `staging-acceptance-${suffix}`,
      purchased_at: new Date().toISOString(),
    }, { onConflict: "user_id,product" }), "acceptance entitlement setup");

    const fixture = workspaceFixture(suffix);
    const migrated = remoteResult(await owner.client.rpc("migrate_guest_workspace", {
      workspace_payload: fixture.workspace,
    }), "guest migration");
    assert(migrated?.ledgerCount === 2 && migrated?.subscriptionCount === 2 && migrated?.receiptId, "transactional guest migration");
    completed.push("transactional guest migration");

    const replayed = remoteResult(await owner.client.rpc("migrate_guest_workspace", {
      workspace_payload: fixture.workspace,
    }), "guest migration replay");
    assert(replayed?.receiptId === migrated.receiptId && replayed?.workspaceHash === migrated.workspaceHash, "migration replay");
    completed.push("migration replay");

    const isolatedRead = remoteResult(await member.client.from("ledgers").select("id").in("id", [fixture.personalId, fixture.teamId]), "isolated ledger read");
    assert(Array.isArray(isolatedRead) && isolatedRead.length === 0, "cross-user ledger isolation");
    completed.push("cross-user ledger isolation");

    const forbiddenInsert = await member.client.from("subscriptions").insert({
      ledger_id: fixture.teamId,
      id: `accept-forbidden-${suffix}`,
      name: "Forbidden Acceptance",
      amount: 1,
      currency: "USD",
      cycle: "monthly",
      next_billing_date: "2026-08-19",
      category: "Acceptance",
      tags: ["synthetic"],
      color: "#ef4444",
      reminder_lead_days: [7],
      paused: false,
      created_by: memberUser.id,
      updated_by: memberUser.id,
    });
    assert(Boolean(forbiddenInsert.error), "cross-user write isolation");
    completed.push("cross-user write isolation");

    const invitationContext = remoteResult(await owner.client.rpc("can_invite_to_ledger", {
      target_ledger_id: fixture.teamId,
    }), "invitation authorization");
    assert(invitationContext?.ledgerId === fixture.teamId && invitationContext?.ledgerKind === "team", "invitation authorization");
    completed.push("invitation authorization");

    const invitationToken = randomBytes(32).toString("base64url");
    const invitationHash = createHash("sha256").update(invitationToken).digest("hex");
    remoteResult(await admin.from("ledger_invitations").insert({
      ledger_id: fixture.teamId,
      email: memberEmail,
      role: "viewer",
      token_hash: invitationHash,
      invited_by: ownerUser.id,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }), "private invitation setup");
    const accepted = remoteResult(await member.client.rpc("accept_ledger_invitation", {
      invitation_token: invitationToken,
    }), "private invitation acceptance");
    assert(accepted?.ledgerId === fixture.teamId && accepted?.role === "viewer", "private invitation acceptance");
    const sharedRows = remoteResult(await member.client.from("subscriptions").select("id").eq("ledger_id", fixture.teamId), "shared ledger read");
    assert(sharedRows?.length === 1, "private invitation acceptance");
    completed.push("private invitation acceptance");

    const viewerWrite = await member.client.rpc("replace_ledger_snapshot", {
      target_ledger_id: fixture.teamId,
      expected_revision: 0,
      client_operation_id: randomUUID(),
      subscriptions_payload: [subscription(`accept-editor-${suffix}`, "Editor Acceptance", 33)],
    });
    assert(Boolean(viewerWrite.error), "viewer write denial");
    completed.push("viewer write denial");

    const promoted = remoteResult(await owner.client.from("ledger_members")
      .update({ role: "editor" })
      .eq("ledger_id", fixture.teamId)
      .eq("user_id", memberUser.id)
      .select("role"), "editor promotion");
    assert(promoted?.length === 1 && promoted[0].role === "editor", "editor revision write");

    const operationId = randomUUID();
    const editorSubscriptionId = `accept-editor-${suffix}`;
    const editorSnapshot = [subscription(editorSubscriptionId, "Editor Acceptance", 33)];
    const realtime = openRealtimeProbe(owner.client, fixture.teamId, editorSubscriptionId);
    closeRealtime = realtime.close;
    assert(await realtime.subscribed === "SUBSCRIBED", "two-client Realtime delivery");
    const applied = remoteResult(await member.client.rpc("replace_ledger_snapshot", {
      target_ledger_id: fixture.teamId,
      expected_revision: 0,
      client_operation_id: operationId,
      subscriptions_payload: editorSnapshot,
    }), "editor revision write");
    assert(applied?.status === "applied" && applied?.currentRevision === 1 && applied?.subscriptionCount === 1, "editor revision write");
    completed.push("editor revision write");

    const realtimeEvent = await realtime.delivered;
    assert(
      realtimeEvent?.eventType === "INSERT"
        && realtimeEvent?.schema === "public"
        && realtimeEvent?.table === "subscriptions",
      "two-client Realtime delivery",
    );
    assert(await realtime.close() === "ok", "two-client Realtime delivery");
    closeRealtime = async () => {};
    completed.push("two-client Realtime delivery");

    completed.push(...await probeHostedCalendarLifecycle({
      client: owner.client,
      projectUrl: config.projectUrl,
      ledgerId: fixture.teamId,
      subscriptionId: editorSubscriptionId,
      forbiddenFragments: [ownerEmail, memberEmail, ownerUser.id, memberUser.id, "synthetic"],
      fetchImpl,
    }));

    const replay = remoteResult(await member.client.rpc("replace_ledger_snapshot", {
      target_ledger_id: fixture.teamId,
      expected_revision: 0,
      client_operation_id: operationId,
      subscriptions_payload: editorSnapshot,
    }), "idempotent write replay");
    assert(JSON.stringify(replay) === JSON.stringify(applied), "idempotent write replay");
    completed.push("idempotent write replay");

    const conflict = remoteResult(await owner.client.rpc("replace_ledger_snapshot", {
      target_ledger_id: fixture.teamId,
      expected_revision: 0,
      client_operation_id: randomUUID(),
      subscriptions_payload: editorSnapshot,
    }), "stale revision conflict");
    assert(conflict?.status === "conflict" && conflict?.baseRevision === 0 && conflict?.currentRevision === 1, "stale revision conflict");
    completed.push("stale revision conflict");

    const removed = remoteResult(await owner.client.from("ledger_members")
      .delete()
      .eq("ledger_id", fixture.teamId)
      .eq("user_id", memberUser.id)
      .select("user_id"), "member removal");
    assert(removed?.length === 1, "member access revocation");
    const revokedRead = remoteResult(await member.client.from("ledgers").select("id").eq("id", fixture.teamId), "revoked ledger read");
    assert(Array.isArray(revokedRead) && revokedRead.length === 0, "member access revocation");
    completed.push("member access revocation");

    const deletionResponse = await fetchImpl(`${config.projectUrl}/functions/v1/delete-account`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${member.session.access_token}`,
        "Content-Type": "application/json",
        Origin: config.appOrigin,
      },
      body: "{}",
    });
    assert(deletionResponse.status === 200, "account deletion function");
    const memberCleanupIndex = createdUserIds.indexOf(memberUser.id);
    if (memberCleanupIndex >= 0) createdUserIds.splice(memberCleanupIndex, 1);
    const deletionBody = await deletionResponse.json().catch(() => null);
    assert(deletionBody?.deleted === true, "account deletion function");
    completed.push("account deletion function");

    const deletedMember = await admin.auth.admin.getUserById(memberUser.id);
    assert(Boolean(deletedMember.error) || !deletedMember.data?.user, "cascade cleanup");
    const deletedProfile = remoteResult(await admin.from("profiles").select("id").eq("id", memberUser.id), "deleted profile lookup");
    assert(Array.isArray(deletedProfile) && deletedProfile.length === 0, "cascade cleanup");
    completed.push("cascade cleanup");

    assert(JSON.stringify(completed) === JSON.stringify(expectedCheckNames), "acceptance check inventory");
    return completed;
  } finally {
    await cleanupAcceptance(admin, createdUserIds, closeRealtime);
  }
}

export function buildAccountPlaneReport({
  projectUrl,
  appOrigin,
  completed,
  migrations,
  commit = "unknown",
  actor = "unknown",
  recordedAt = new Date().toISOString(),
  runUrl = "",
}) {
  if (JSON.stringify(completed) !== JSON.stringify(expectedCheckNames)) {
    throw new Error("Account-plane report requires the complete ordered acceptance inventory.");
  }
  const projectHost = new URL(projectUrl).hostname;
  const safeCommit = /^[0-9a-f]{7,40}$/i.test(commit) ? commit : "unknown";
  const safeActor = /^[A-Za-z0-9-]{1,80}$/.test(actor) ? actor : "unknown";
  const safeRunUrl = (() => {
    try {
      const url = new URL(runUrl);
      return url.protocol === "https:" && url.hostname === "github.com" ? url.href : "";
    } catch {
      return "";
    }
  })();
  const validMigrations = migrations.filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const checks = completed
    .filter((name) => expectedCheckNames.includes(name))
    .map((name) => `- PASS / ${name}`)
    .join("\n");

  return [
    "## Outflow Staging Account Plane",
    "",
    `- Result: **PASS** (${completed.length} authenticated checks)`,
    "- Environment: `staging`",
    `- Supabase project: \`${projectHost}\``,
    `- App origin: \`${appOrigin}\``,
    `- Commit: \`${safeCommit}\``,
    `- Tester: \`${safeActor}\``,
    `- Recorded: \`${recordedAt}\``,
    ...(safeRunUrl ? [`- Workflow: [GitHub Actions run](${safeRunUrl})`] : []),
    "",
    "### Authenticated Matrix",
    "",
    checks,
    "",
    `### Migration Inventory (${validMigrations.length})`,
    "",
    ...validMigrations.map((name) => `- \`${name}\``),
    "",
    "> Scope: Supabase identity, RLS, migration, invitation acceptance, revision writes, two-client Realtime delivery, hosted calendar publication/HTTP lifecycle, member revocation, and account deletion. Provider email, Realtime reconnect behavior, third-party calendar clients, reminders, and Stripe still require their separate staging matrices.",
    "",
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const envFileIndex = args.indexOf("--env-file");
  const summaryFileIndex = args.indexOf("--summary-file");
  const file = envFileIndex >= 0 ? args[envFileIndex + 1] : "";
  const summaryFile = summaryFileIndex >= 0 ? args[summaryFileIndex + 1] : "";
  if (envFileIndex >= 0 && !file) throw new Error("--env-file: expected a path.");
  if (summaryFileIndex >= 0 && !summaryFile) throw new Error("--summary-file: expected a path.");
  const env = file ? parseEnvFile(await readFile(resolve(process.cwd(), file), "utf8")) : process.env;
  const config = resolveAccountAcceptanceConfig(env);
  if (config.errors.length) {
    for (const error of config.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  try {
    const completed = await runAccountDataPlaneAcceptance(config);
    if (summaryFile) {
      const migrations = (await readdir(resolve(process.cwd(), "supabase/migrations"))).filter((name) => name.endsWith(".sql"));
      const report = buildAccountPlaneReport({
        projectUrl: config.projectUrl,
        appOrigin: config.appOrigin,
        completed,
        migrations,
        commit: process.env.GITHUB_SHA,
        actor: process.env.GITHUB_ACTOR,
        runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
          ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : "",
      });
      await appendFile(summaryFile, report, "utf8");
    }
    console.log(`Staging account-plane acceptance passed: ${completed.length} authenticated checks.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Staging account-plane acceptance failed.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
