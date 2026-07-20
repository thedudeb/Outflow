import { appendFile, readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnvFile, resolveSupabaseKeys } from "./check-service-readiness.mjs";
import { createAcceptanceClient } from "./staging-acceptance-client.mjs";

const PRODUCT = "outflow_pro_lifetime";
const RESEND_API = "https://api.resend.com";
const expectedCheckNames = Object.freeze([
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

function highEntropySecret(value) {
  return value.length >= 32
    && value.length <= 512
    && !/\s/.test(value)
    && new Set(value).size >= 10;
}

export function resolveMessagingAcceptanceConfig(env) {
  const errors = [];
  const projectUrl = String(env.SUPABASE_URL || "").trim();
  const projectRef = String(env.OUTFLOW_ACCEPTANCE_PROJECT_REF || "").trim();
  const appUrl = String(env.OUTFLOW_APP_URL || "").trim();
  const mode = String(env.OUTFLOW_ACCEPTANCE_MODE || "").trim();
  const resendKey = String(env.RESEND_API_KEY || "").trim();
  const cronSecret = String(env.OUTFLOW_CRON_SECRET || "").trim();
  const { publishableKey, secretKey } = resolveSupabaseKeys(env, errors);

  if (!hostedProjectOrigin(projectUrl)) {
    errors.push("SUPABASE_URL: expected an exact hosted Supabase project origin.");
  }
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    errors.push("OUTFLOW_ACCEPTANCE_PROJECT_REF: expected the protected staging project reference.");
  }
  if (hostedProjectOrigin(projectUrl) && projectRef && new URL(projectUrl).hostname.split(".")[0] !== projectRef) {
    errors.push("OUTFLOW_ACCEPTANCE_PROJECT_REF: does not match the configured Supabase project.");
  }
  if (!exactHttpsOrigin(appUrl)) {
    errors.push("OUTFLOW_APP_URL: expected the staging application's exact HTTPS origin.");
  }
  if (mode !== "staging") {
    errors.push("OUTFLOW_ACCEPTANCE_MODE: must be the literal value staging.");
  }
  if (!/^re_[A-Za-z0-9_-]{16,}$/.test(resendKey)) {
    errors.push("RESEND_API_KEY: expected a Resend API key.");
  }
  if (!highEntropySecret(cronSecret)) {
    errors.push("OUTFLOW_CRON_SECRET: expected a high-entropy secret of at least 32 characters.");
  }

  return {
    errors,
    projectUrl,
    projectRef,
    appOrigin: exactHttpsOrigin(appUrl) ? new URL(appUrl).origin : "",
    publishableKey,
    secretKey,
    resendKey,
    cronSecret,
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

export function schedulerStatusMatches(status) {
  if (!status || typeof status !== "object" || Array.isArray(status)) return false;
  const expectedKeys = [
    "cronReady",
    "networkReady",
    "vaultReady",
    "endpointConfigured",
    "cronSecretConfigured",
    "jobConfigured",
    "jobActive",
    "schedule",
    "lastRunStatus",
    "lastRunAt",
    "lastSuccessAt",
    "recentSuccess",
    "workerRequestStatus",
    "workerRequestAt",
    "workerReached",
    "healthy",
  ].sort();
  if (JSON.stringify(Object.keys(status).sort()) !== JSON.stringify(expectedKeys)) return false;
  const requiredTrue = [
    "cronReady",
    "networkReady",
    "vaultReady",
    "endpointConfigured",
    "cronSecretConfigured",
    "jobConfigured",
    "jobActive",
    "recentSuccess",
    "workerReached",
    "healthy",
  ];
  return requiredTrue.every((key) => status[key] === true)
    && status.schedule === "7 * * * *"
    && status.workerRequestStatus === 200
    && typeof status.lastRunStatus === "string"
    && status.lastRunStatus.length >= 1
    && status.lastRunStatus.length <= 40
    && Number.isFinite(Date.parse(status.lastRunAt))
    && Number.isFinite(Date.parse(status.lastSuccessAt))
    && Number.isFinite(Date.parse(status.workerRequestAt));
}

async function boundedJson(response, label) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  assert(!declaredLength || declaredLength <= 1_000_000, label);
  let source;
  try {
    source = await response.text();
  } catch {
    throw new Error(`${label}: response body could not be read.`);
  }
  assert(source.length <= 1_000_000, label);
  try {
    return source ? JSON.parse(source) : {};
  } catch {
    throw new Error(`${label}: response was not valid JSON.`);
  }
}

async function resendRequest(path, resendKey, fetchImpl, label) {
  let response;
  try {
    response = await fetchImpl(`${RESEND_API}${path}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${resendKey}` },
    });
  } catch {
    throw new Error(`${label}: provider request failed.`);
  }
  assert(response.status === 200, label);
  return boundedJson(response, label);
}

function messageMatches(message, recipient, subjectIncludes, startedAt) {
  return typeof message?.id === "string"
    && Array.isArray(message.to)
    && message.to.some((value) => String(value).toLowerCase() === recipient)
    && typeof message.subject === "string"
    && message.subject.includes(subjectIncludes)
    && Number.isFinite(Date.parse(message.created_at))
    && Date.parse(message.created_at) >= startedAt - 60_000;
}

export async function waitForResendDelivery({
  resendKey,
  recipient,
  subjectIncludes,
  providerId = "",
  startedAt = Date.now(),
  fetchImpl = fetch,
  sleepImpl = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  attempts = 30,
}) {
  assert(/^delivered\+[a-z0-9-]{1,64}@resend\.dev$/.test(recipient), "Resend synthetic recipient");
  assert(typeof subjectIncludes === "string" && subjectIncludes.length > 0 && subjectIncludes.length <= 180, "Resend subject match");
  assert(Number.isInteger(attempts) && attempts >= 1 && attempts <= 60, "Resend delivery attempts");
  let messageId = providerId;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!messageId) {
      const listed = await resendRequest("/emails", resendKey, fetchImpl, "Resend delivery lookup");
      const match = Array.isArray(listed?.data)
        ? listed.data.find((message) => messageMatches(message, recipient, subjectIncludes, startedAt))
        : null;
      messageId = match?.id || "";
    }
    if (messageId) {
      assert(/^[A-Za-z0-9-]{20,100}$/.test(messageId), "Resend message identifier");
      const message = await resendRequest(`/emails/${encodeURIComponent(messageId)}`, resendKey, fetchImpl, "Resend delivery receipt");
      assert(messageMatches(message, recipient, subjectIncludes, startedAt), "Resend delivery receipt");
      if (message.last_event === "delivered") return message;
      if (["bounced", "complained", "canceled", "failed"].includes(message.last_event)) {
        throw new Error("Resend delivery receipt: provider reported a terminal failure.");
      }
    }
    if (attempt + 1 < attempts) await sleepImpl(1_000);
  }
  throw new Error("Resend delivery receipt: timed out.");
}

export async function waitForResendEvent({
  resendKey,
  recipient,
  subjectIncludes,
  providerId,
  expectedEvent,
  startedAt = Date.now(),
  fetchImpl = fetch,
  sleepImpl = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  attempts = 30,
}) {
  assert(/^(?:bounced|complained)\+[a-z0-9-]{1,64}@resend\.dev$/.test(recipient), "Resend synthetic event recipient");
  assert(/^[A-Za-z0-9-]{20,100}$/.test(providerId), "Resend synthetic event identifier");
  assert(["bounced", "complained"].includes(expectedEvent), "Resend synthetic terminal event");
  assert(Number.isInteger(attempts) && attempts >= 1 && attempts <= 60, "Resend synthetic event attempts");

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const message = await resendRequest(`/emails/${encodeURIComponent(providerId)}`, resendKey, fetchImpl, "Resend synthetic event receipt");
    assert(messageMatches(message, recipient, subjectIncludes, startedAt), "Resend synthetic event receipt");
    if (message.last_event === expectedEvent) return message;
    const deliveredBeforeComplaint = expectedEvent === "complained" && message.last_event === "delivered";
    if (!deliveredBeforeComplaint && ["bounced", "complained", "canceled", "failed", "delivered"].includes(message.last_event)) {
      throw new Error("Resend synthetic event receipt: provider reported an unexpected terminal state.");
    }
    if (attempt + 1 < attempts) await sleepImpl(1_000);
  }
  throw new Error("Resend synthetic event receipt: timed out.");
}

export async function replayResendDelivery({ resendKey, message, deliveryId, fetchImpl = fetch }) {
  assert(/^[A-Fa-f0-9-]{36}$/.test(deliveryId), "Resend idempotency replay");
  assert(/^[A-Za-z0-9-]{20,100}$/.test(message?.id || ""), "Resend idempotency replay");
  assert(
    typeof message?.from === "string"
      && Array.isArray(message?.to)
      && message.to.length === 1
      && typeof message.subject === "string"
      && typeof message.text === "string"
      && typeof message.html === "string",
    "Resend idempotency replay",
  );
  let response;
  try {
    response = await fetchImpl(`${RESEND_API}/emails`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `outflow-reminder/${deliveryId}`,
      },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
  } catch {
    throw new Error("Resend idempotency replay: provider request failed.");
  }
  assert(response.status === 200, "Resend idempotency replay");
  const body = await boundedJson(response, "Resend idempotency replay");
  assert(body?.id === message.id, "Resend idempotency replay");
  return body.id;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractInvitationToken(message, appOrigin) {
  assert(exactHttpsOrigin(appOrigin), "invitation application origin");
  const expression = new RegExp(`${escapeRegExp(appOrigin)}/?#app\\?invite=([A-Za-z0-9_-]{43})(?:[^A-Za-z0-9_-]|$)`);
  for (const source of [message?.text, message?.html]) {
    if (typeof source !== "string") continue;
    const match = source.match(expression);
    if (match) return match[1];
  }
  throw new Error("invitation content: private token link was not found.");
}

export async function invokeReminderWorker(config, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${config.projectUrl}/functions/v1/send-due-reminders`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${config.cronSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ batchSize: 100 }),
    });
  } catch {
    throw new Error("reminder worker: request failed.");
  }
  assert(response.status === 200, "reminder worker");
  const body = await boundedJson(response, "reminder worker");
  for (const field of ["claimed", "sent", "failed", "completionErrors"]) {
    assert(Number.isInteger(body[field]) && body[field] >= 0 && body[field] <= 100, "reminder worker");
  }
  assert(body.claimed === body.sent + body.failed, "reminder worker");
  return body;
}

function formattedAcceptanceDate(billingDate) {
  return new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(`${billingDate}T00:00:00Z`));
}

function subscriptionFixture(id, name, amount, billingDate, paused = false) {
  return {
    id,
    name,
    amount,
    currency: "USD",
    cycle: "monthly",
    nextBillingDate: billingDate,
    category: "Acceptance",
    tags: ["synthetic"],
    color: "#f59e0b",
    trialEndDate: "",
    reminderLeadDays: [0],
    paused,
    revision: 0,
    createdBy: "Staging acceptance",
    updatedBy: "Staging acceptance",
    updatedAt: new Date().toISOString(),
  };
}

function workspaceFixture(suffix, billingDate) {
  const personalId = `accept-message-personal-${suffix}`;
  const ledgerId = `accept-message-household-${suffix}`;
  const activeId = `accept-message-active-${suffix}`;
  const pausedId = `accept-message-paused-${suffix}`;
  const ledgerName = `Messaging ${suffix}`;
  return {
    personalId,
    ledgerId,
    ledgerName,
    activeId,
    pausedId,
    workspace: {
      schemaVersion: 1,
      activeLedgerId: ledgerId,
      ledgers: [
        { ledger: { id: personalId, name: "Acceptance Personal", kind: "personal" }, subscriptions: [] },
        {
          ledger: { id: ledgerId, name: ledgerName, kind: "household" },
          subscriptions: [
            subscriptionFixture(activeId, "Active reminder acceptance", 12.34, billingDate),
            subscriptionFixture(pausedId, "Paused reminder acceptance", 23.45, billingDate, true),
          ],
        },
      ],
    },
  };
}

async function signIn(config, email, password) {
  const client = createAcceptanceClient(config.projectUrl, config.publishableKey);
  const data = remoteResult(await client.auth.signInWithPassword({ email, password }), "synthetic messaging sign-in");
  assert(data?.session?.access_token && data?.user?.id, "synthetic messaging sign-in");
  return { client, session: data.session, user: data.user };
}

async function savePreferences(client, emailEnabled, pausedEnabled) {
  const saved = remoteResult(await client.rpc("save_notification_preferences", {
    requested_email_enabled: emailEnabled,
    requested_paused_schedule_enabled: pausedEnabled,
    requested_timezone: "UTC",
  }), "notification preference update");
  assert(saved?.emailEnabled === emailEnabled && saved?.pausedScheduleEnabled === pausedEnabled && saved?.timezone === "UTC", "notification preference update");
}

async function insertDueSubscription(admin, ledgerId, ownerId, id, name, amount, billingDate) {
  remoteResult(await admin.from("subscriptions").insert({
    ledger_id: ledgerId,
    id,
    name,
    amount,
    currency: "USD",
    cycle: "monthly",
    next_billing_date: billingDate,
    category: "Acceptance",
    tags: ["synthetic"],
    color: "#f59e0b",
    reminder_lead_days: [0],
    paused: false,
    created_by: ownerId,
    updated_by: ownerId,
    source_created_by: "Staging acceptance",
    source_updated_by: "Staging acceptance",
    client_updated_at: new Date().toISOString(),
  }), "reminder subscription setup");
}

async function deliveryRows(admin, ownerId, subscriptionIds) {
  const rows = remoteResult(await admin.from("notification_deliveries")
    .select("id, subscription_id, status, attempt_count, next_attempt_at, provider_message_id, provider_status, provider_event_at, last_error_code")
    .eq("user_id", ownerId)
    .in("subscription_id", subscriptionIds), "reminder delivery lookup");
  return Array.isArray(rows) ? rows : [];
}

async function waitForProviderSuppression({
  admin,
  userId,
  deliveryId,
  expectedReason,
  sleepImpl = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  attempts = 30,
}) {
  assert(["bounced", "complained"].includes(expectedReason), "provider suppression reason");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const preferences = remoteResult(await admin.from("notification_preferences")
      .select("email_enabled, email_suppressed_at, email_suppression_reason")
      .eq("user_id", userId), "provider suppression preference");
    const deliveries = remoteResult(await admin.from("notification_deliveries")
      .select("provider_status, provider_event_at")
      .eq("id", deliveryId), "provider suppression delivery");
    if (
      preferences?.length === 1
      && preferences[0].email_enabled === false
      && preferences[0].email_suppression_reason === expectedReason
      && Number.isFinite(Date.parse(preferences[0].email_suppressed_at))
      && deliveries?.length === 1
      && deliveries[0].provider_status === expectedReason
      && Number.isFinite(Date.parse(deliveries[0].provider_event_at))
    ) return { preference: preferences[0], delivery: deliveries[0] };
    if (attempt + 1 < attempts) await sleepImpl(1_000);
  }
  throw new Error("provider suppression: timed out.");
}

function workerMatches(body, claimed, sent, failed = 0) {
  return body.claimed === claimed
    && body.sent === sent
    && body.failed === failed
    && body.completionErrors === 0;
}

function safeMessageContent(message, required, forbidden) {
  const content = `${message?.subject || ""}\n${message?.text || ""}\n${message?.html || ""}`;
  return required.every((fragment) => content.includes(fragment))
    && forbidden.every((fragment) => !content.includes(fragment));
}

async function deleteUser(admin, userId) {
  if (!userId) return;
  const result = await admin.auth.admin.deleteUser(userId, false);
  if (result.error && !["user_not_found", "not_found"].includes(result.error.code)) throw result.error;
}

export async function cleanupMessagingAcceptance(admin, resources) {
  let failed = false;
  for (const userId of [...resources.userIds].reverse()) {
    try {
      await deleteUser(admin, userId);
    } catch {
      failed = true;
    }
  }
  try {
    if (resources.userIds.length) {
      const profiles = remoteResult(await admin.from("profiles").select("id").in("id", resources.userIds), "messaging profile cleanup");
      if (profiles?.length) failed = true;
    }
    if (resources.ledgerId) {
      const ledgers = remoteResult(await admin.from("ledgers").select("id").eq("id", resources.ledgerId), "messaging ledger cleanup");
      const invitations = remoteResult(await admin.from("ledger_invitations").select("id").eq("ledger_id", resources.ledgerId), "messaging invitation cleanup");
      if (ledgers?.length || invitations?.length) failed = true;
    }
    if (resources.userIds.length) {
      const deliveries = remoteResult(await admin.from("notification_deliveries").select("id").in("user_id", resources.userIds), "messaging delivery cleanup");
      if (deliveries?.length) failed = true;
    }
  } catch {
    failed = true;
  }
  if (failed) throw new Error("synthetic messaging cleanup: one or more resources could not be removed.");
}

export async function runMessagingPlaneAcceptance(config, { fetchImpl = fetch, sleepImpl } = {}) {
  const completed = [];
  const admin = createAcceptanceClient(config.projectUrl, config.secretKey);
  const suffix = randomBytes(8).toString("hex");
  const ownerEmail = `delivered+outflow-reminder-${suffix}@resend.dev`;
  const recipientEmail = `delivered+outflow-invite-${suffix}@resend.dev`;
  const bouncedEmail = `bounced+outflow-reminder-${suffix}@resend.dev`;
  const complainedEmail = `complained+outflow-reminder-${suffix}@resend.dev`;
  const password = `${randomBytes(24).toString("base64url")}aA1!`;
  const billingDate = new Date().toISOString().slice(0, 10);
  const fixture = workspaceFixture(suffix, billingDate);
  const bouncedFixture = workspaceFixture(`bounce-${suffix}`, billingDate);
  const complainedFixture = workspaceFixture(`complaint-${suffix}`, billingDate);
  const resources = { userIds: [], ledgerId: fixture.ledgerId };

  try {
    const schedulerStatus = remoteResult(
      await admin.rpc("reminder_scheduler_status", { expected_project_ref: config.projectRef }),
      "cron scheduler registration",
    );
    assert(schedulerStatusMatches(schedulerStatus), "cron scheduler registration");
    completed.push("cron scheduler registration");

    const ownerUser = remoteResult(await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Outflow messaging acceptance owner" },
    }), "messaging owner setup")?.user;
    if (ownerUser?.id) resources.userIds.push(ownerUser.id);
    const recipientUser = remoteResult(await admin.auth.admin.createUser({
      email: recipientEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Outflow messaging acceptance recipient" },
    }), "messaging recipient setup")?.user;
    if (recipientUser?.id) resources.userIds.push(recipientUser.id);
    const bouncedUser = remoteResult(await admin.auth.admin.createUser({
      email: bouncedEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Outflow bounce acceptance" },
    }), "messaging bounce account setup")?.user;
    if (bouncedUser?.id) resources.userIds.push(bouncedUser.id);
    const complainedUser = remoteResult(await admin.auth.admin.createUser({
      email: complainedEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Outflow complaint acceptance" },
    }), "messaging complaint account setup")?.user;
    if (complainedUser?.id) resources.userIds.push(complainedUser.id);
    assert(ownerUser?.id && recipientUser?.id && bouncedUser?.id && complainedUser?.id, "synthetic messaging accounts");

    const owner = await signIn(config, ownerEmail, password);
    const recipient = await signIn(config, recipientEmail, password);
    const bounced = await signIn(config, bouncedEmail, password);
    const complained = await signIn(config, complainedEmail, password);
    assert(
      owner.user.id === ownerUser.id
        && recipient.user.id === recipientUser.id
        && bounced.user.id === bouncedUser.id
        && complained.user.id === complainedUser.id,
      "synthetic messaging accounts",
    );
    completed.push("synthetic messaging accounts");

    remoteResult(await admin.from("entitlements").upsert({
      user_id: ownerUser.id,
      product: PRODUCT,
      status: "active",
      provider: "manual",
      provider_reference: `staging-messaging-${suffix}`,
      purchased_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: "user_id,product" }), "messaging entitlement setup");
    remoteResult(await admin.from("entitlements").upsert({
      user_id: bouncedUser.id,
      product: PRODUCT,
      status: "active",
      provider: "manual",
      provider_reference: `staging-messaging-bounce-${suffix}`,
      purchased_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: "user_id,product" }), "messaging bounce entitlement setup");
    remoteResult(await admin.from("entitlements").upsert({
      user_id: complainedUser.id,
      product: PRODUCT,
      status: "active",
      provider: "manual",
      provider_reference: `staging-messaging-complaint-${suffix}`,
      purchased_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: "user_id,product" }), "messaging complaint entitlement setup");
    const migrated = remoteResult(await owner.client.rpc("migrate_guest_workspace", {
      workspace_payload: fixture.workspace,
    }), "messaging workspace setup");
    assert(migrated?.ledgerCount === 2 && migrated?.subscriptionCount === 2, "messaging workspace setup");
    const bouncedMigrated = remoteResult(await bounced.client.rpc("migrate_guest_workspace", {
      workspace_payload: bouncedFixture.workspace,
    }), "messaging bounce workspace setup");
    assert(bouncedMigrated?.ledgerCount === 2 && bouncedMigrated?.subscriptionCount === 2, "messaging bounce workspace setup");
    const complainedMigrated = remoteResult(await complained.client.rpc("migrate_guest_workspace", {
      workspace_payload: complainedFixture.workspace,
    }), "messaging complaint workspace setup");
    assert(complainedMigrated?.ledgerCount === 2 && complainedMigrated?.subscriptionCount === 2, "messaging complaint workspace setup");

    const invitationStartedAt = Date.now();
    const inviteResponse = await fetchImpl(`${config.projectUrl}/functions/v1/send-ledger-invite`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${owner.session.access_token}`,
        "Content-Type": "application/json",
        Origin: config.appOrigin,
      },
      body: JSON.stringify({ ledgerId: fixture.ledgerId, email: recipientEmail, role: "viewer" }),
    });
    assert(inviteResponse.status === 201, "provider invitation delivery");
    const inviteResult = await boundedJson(inviteResponse, "provider invitation delivery");
    assert(inviteResult?.email === recipientEmail && inviteResult?.role === "viewer", "provider invitation delivery");
    const invitationMessage = await waitForResendDelivery({
      resendKey: config.resendKey,
      recipient: recipientEmail,
      subjectIncludes: fixture.ledgerName,
      startedAt: invitationStartedAt,
      fetchImpl,
      sleepImpl,
    });
    completed.push("provider invitation delivery");

    assert(safeMessageContent(
      invitationMessage,
      [fixture.ledgerName, "viewer", config.appOrigin, "Outflow"],
      [ownerUser.id, recipientUser.id, fixture.ledgerId, password, "token_hash", "provider_message_id"],
    ), "invitation content privacy");
    const invitationToken = extractInvitationToken(invitationMessage, config.appOrigin);
    completed.push("invitation content privacy");

    const accepted = remoteResult(await recipient.client.rpc("accept_ledger_invitation", {
      invitation_token: invitationToken,
    }), "private invitation acceptance");
    assert(accepted?.ledgerId === fixture.ledgerId && accepted?.role === "viewer", "private invitation acceptance");
    const recipientMembership = remoteResult(await recipient.client.from("ledger_members")
      .select("role")
      .eq("ledger_id", fixture.ledgerId)
      .eq("user_id", recipientUser.id), "private invitation membership");
    assert(recipientMembership?.length === 1 && recipientMembership[0].role === "viewer", "private invitation acceptance");
    const reusedInvitation = await recipient.client.rpc("accept_ledger_invitation", {
      invitation_token: invitationToken,
    });
    assert(Boolean(reusedInvitation.error), "private invitation acceptance");
    completed.push("private invitation acceptance");

    await savePreferences(owner.client, true, false);
    const activeStartedAt = Date.now();
    const activeWorker = await invokeReminderWorker(config, fetchImpl);
    assert(workerMatches(activeWorker, 1, 1), "active reminder delivery");
    const initialRows = await deliveryRows(admin, ownerUser.id, [fixture.activeId, fixture.pausedId]);
    const activeDelivery = initialRows.find((row) => row.subscription_id === fixture.activeId);
    assert(
      initialRows.length === 1
        && activeDelivery?.status === "sent"
        && activeDelivery?.attempt_count === 1
        && typeof activeDelivery?.provider_message_id === "string",
      "active reminder delivery",
    );
    completed.push("active reminder delivery");

    const activeMessage = await waitForResendDelivery({
      resendKey: config.resendKey,
      recipient: ownerEmail,
      subjectIncludes: "Active reminder acceptance",
      providerId: activeDelivery.provider_message_id,
      startedAt: activeStartedAt,
      fetchImpl,
      sleepImpl,
    });
    assert(safeMessageContent(
      activeMessage,
      ["Active reminder acceptance", "$12.34", formattedAcceptanceDate(billingDate), fixture.ledgerName, "household", config.appOrigin],
      [ownerUser.id, fixture.ledgerId, activeDelivery.id, password, "provider_message_id"],
    ), "provider reminder delivery");
    completed.push("provider reminder delivery");

    assert(!initialRows.some((row) => row.subscription_id === fixture.pausedId), "paused reminder exclusion");
    completed.push("paused reminder exclusion");

    const retryId = `accept-message-retry-${suffix}`;
    await insertDueSubscription(admin, fixture.ledgerId, ownerUser.id, retryId, "Retry reminder acceptance", 34.56, billingDate);
    const claimToken = randomUUID();
    const claimed = remoteResult(await admin.rpc("claim_due_email_notifications", {
      requested_batch_size: 100,
      worker_claim_token: claimToken,
    }), "durable reminder claim");
    assert(claimed?.length === 1 && claimed[0].subscription_name === "Retry reminder acceptance", "durable reminder retry");
    const completedFailure = remoteResult(await admin.rpc("complete_email_notification", {
      target_delivery_id: claimed[0].delivery_id,
      worker_claim_token: claimToken,
      delivery_succeeded: false,
      provider_identifier: null,
      error_code: "synthetic_provider_failure",
    }), "durable reminder failure");
    assert(completedFailure === true, "durable reminder retry");
    const failedRows = await deliveryRows(admin, ownerUser.id, [retryId]);
    assert(
      failedRows.length === 1
        && failedRows[0].status === "failed"
        && failedRows[0].attempt_count === 1
        && failedRows[0].last_error_code === "synthetic_provider_failure"
        && Date.parse(failedRows[0].next_attempt_at) > Date.now(),
      "durable reminder retry",
    );
    remoteResult(await admin.from("notification_deliveries")
      .update({ next_attempt_at: new Date(Date.now() - 1_000).toISOString() })
      .eq("id", failedRows[0].id), "durable reminder retry release");
    const retryStartedAt = Date.now();
    const retryWorker = await invokeReminderWorker(config, fetchImpl);
    assert(workerMatches(retryWorker, 1, 1), "durable reminder retry");
    const retriedRows = await deliveryRows(admin, ownerUser.id, [retryId]);
    assert(
      retriedRows.length === 1
        && retriedRows[0].status === "sent"
        && retriedRows[0].attempt_count === 2
        && typeof retriedRows[0].provider_message_id === "string",
      "durable reminder retry",
    );
    completed.push("durable reminder retry");

    const retryMessage = await waitForResendDelivery({
      resendKey: config.resendKey,
      recipient: ownerEmail,
      subjectIncludes: "Retry reminder acceptance",
      providerId: retriedRows[0].provider_message_id,
      startedAt: retryStartedAt,
      fetchImpl,
      sleepImpl,
    });
    assert(safeMessageContent(
      retryMessage,
      ["Retry reminder acceptance", "$34.56", formattedAcceptanceDate(billingDate), fixture.ledgerName],
      [retryId, ownerUser.id],
    ), "retry provider delivery");
    completed.push("retry provider delivery");

    const replayedProviderId = await replayResendDelivery({
      resendKey: config.resendKey,
      message: activeMessage,
      deliveryId: activeDelivery.id,
      fetchImpl,
    });
    assert(replayedProviderId === activeDelivery.provider_message_id, "reminder idempotent replay");
    const replayWorker = await invokeReminderWorker(config, fetchImpl);
    assert(workerMatches(replayWorker, 0, 0), "reminder idempotent replay");
    const replayRows = await deliveryRows(admin, ownerUser.id, [fixture.activeId, retryId]);
    assert(replayRows.length === 2 && replayRows.every((row) => row.status === "sent"), "reminder idempotent replay");
    completed.push("reminder idempotent replay");

    await savePreferences(owner.client, true, true);
    const pausedStartedAt = Date.now();
    const pausedWorker = await invokeReminderWorker(config, fetchImpl);
    assert(workerMatches(pausedWorker, 1, 1), "paused reminder opt-in");
    const pausedRows = await deliveryRows(admin, ownerUser.id, [fixture.pausedId]);
    assert(pausedRows.length === 1 && pausedRows[0].status === "sent" && pausedRows[0].attempt_count === 1, "paused reminder opt-in");
    await waitForResendDelivery({
      resendKey: config.resendKey,
      recipient: ownerEmail,
      subjectIncludes: "Paused reminder acceptance",
      providerId: pausedRows[0].provider_message_id,
      startedAt: pausedStartedAt,
      fetchImpl,
      sleepImpl,
    });
    completed.push("paused reminder opt-in");

    await savePreferences(bounced.client, true, false);
    const bounceStartedAt = Date.now();
    const bounceWorker = await invokeReminderWorker(config, fetchImpl);
    assert(workerMatches(bounceWorker, 1, 1), "provider bounce event");
    const bounceRows = await deliveryRows(admin, bouncedUser.id, [bouncedFixture.activeId, bouncedFixture.pausedId]);
    const bouncedDelivery = bounceRows.find((row) => row.subscription_id === bouncedFixture.activeId);
    assert(
      bounceRows.length === 1
        && bouncedDelivery?.status === "sent"
        && bouncedDelivery?.provider_status === "accepted"
        && typeof bouncedDelivery?.provider_message_id === "string",
      "provider bounce event",
    );
    await waitForResendEvent({
      resendKey: config.resendKey,
      recipient: bouncedEmail,
      subjectIncludes: "Active reminder acceptance",
      providerId: bouncedDelivery.provider_message_id,
      expectedEvent: "bounced",
      startedAt: bounceStartedAt,
      fetchImpl,
      sleepImpl,
    });
    completed.push("provider bounce event");

    await waitForProviderSuppression({
      admin,
      userId: bouncedUser.id,
      deliveryId: bouncedDelivery.id,
      expectedReason: "bounced",
      sleepImpl,
    });
    const providerEvents = remoteResult(await admin.from("notification_provider_events")
      .select("event_type")
      .eq("delivery_id", bouncedDelivery.id), "provider suppression event ledger");
    assert(providerEvents?.some((event) => event.event_type === "email.bounced"), "provider suppression");
    completed.push("provider suppression");

    const resumed = remoteResult(await bounced.client.rpc("resume_email_notifications"), "provider suppression recovery");
    assert(
      resumed?.emailEnabled === true
        && resumed?.emailSuppressedAt === null
        && resumed?.emailSuppressionReason === null,
      "suppression recovery",
    );
    completed.push("suppression recovery");

    await savePreferences(complained.client, true, false);
    const complaintStartedAt = Date.now();
    const complaintWorker = await invokeReminderWorker(config, fetchImpl);
    assert(workerMatches(complaintWorker, 1, 1), "provider complaint event");
    const complaintRows = await deliveryRows(admin, complainedUser.id, [complainedFixture.activeId, complainedFixture.pausedId]);
    const complainedDelivery = complaintRows.find((row) => row.subscription_id === complainedFixture.activeId);
    assert(
      complaintRows.length === 1
        && complainedDelivery?.status === "sent"
        && complainedDelivery?.provider_status === "accepted"
        && typeof complainedDelivery?.provider_message_id === "string",
      "provider complaint event",
    );
    await waitForResendEvent({
      resendKey: config.resendKey,
      recipient: complainedEmail,
      subjectIncludes: "Active reminder acceptance",
      providerId: complainedDelivery.provider_message_id,
      expectedEvent: "complained",
      startedAt: complaintStartedAt,
      fetchImpl,
      sleepImpl,
    });
    completed.push("provider complaint event");

    await waitForProviderSuppression({
      admin,
      userId: complainedUser.id,
      deliveryId: complainedDelivery.id,
      expectedReason: "complained",
      sleepImpl,
    });
    const complaintEvents = remoteResult(await admin.from("notification_provider_events")
      .select("event_type")
      .eq("delivery_id", complainedDelivery.id), "provider complaint event ledger");
    assert(complaintEvents?.some((event) => event.event_type === "email.complained"), "complaint suppression");
    completed.push("complaint suppression");

    await savePreferences(owner.client, false, false);
    const optOutId = `accept-message-optout-${suffix}`;
    await insertDueSubscription(admin, fixture.ledgerId, ownerUser.id, optOutId, "Opt-out reminder acceptance", 45.67, billingDate);
    const optOutWorker = await invokeReminderWorker(config, fetchImpl);
    const optOutRows = await deliveryRows(admin, ownerUser.id, [optOutId]);
    assert(workerMatches(optOutWorker, 0, 0) && optOutRows.length === 0, "email opt-out suspension");
    completed.push("email opt-out suspension");

    await savePreferences(owner.client, true, false);
    remoteResult(await admin.from("entitlements").update({
      status: "refunded",
      revoked_at: new Date().toISOString(),
    }).eq("user_id", ownerUser.id).eq("product", PRODUCT), "messaging refund setup");
    const refundId = `accept-message-refund-${suffix}`;
    await insertDueSubscription(admin, fixture.ledgerId, ownerUser.id, refundId, "Refund reminder acceptance", 56.78, billingDate);
    const refundWorker = await invokeReminderWorker(config, fetchImpl);
    const refundRows = await deliveryRows(admin, ownerUser.id, [refundId]);
    assert(workerMatches(refundWorker, 0, 0) && refundRows.length === 0, "refund suspension");
    completed.push("refund suspension");
  } finally {
    await cleanupMessagingAcceptance(admin, resources);
  }

  completed.push("synthetic messaging cleanup");
  assert(JSON.stringify(completed) === JSON.stringify(expectedCheckNames), "messaging acceptance check inventory");
  return completed;
}

export function buildMessagingPlaneReport({ checks, projectRef, appOrigin, commitSha, actor, runId, completedAt }) {
  assert(JSON.stringify(checks) === JSON.stringify(expectedCheckNames), "complete messaging acceptance inventory");
  assert(/^[a-z0-9]{20}$/.test(projectRef), "messaging report project");
  assert(exactHttpsOrigin(appOrigin), "messaging report app origin");
  const safeCommit = /^[a-f0-9]{7,40}$/i.test(String(commitSha || "")) ? commitSha : "local";
  const safeActor = /^[A-Za-z0-9_-]{1,80}$/.test(String(actor || "")) ? actor : "local";
  const safeRun = /^[A-Za-z0-9_-]{1,80}$/.test(String(runId || "")) ? runId : "local";
  const safeTime = Number.isFinite(Date.parse(completedAt)) ? new Date(completedAt).toISOString() : new Date().toISOString();
  return [
    "## Outflow staging messaging plane",
    "",
    `- Commit: \`${safeCommit}\``,
    `- Actor: \`${safeActor}\``,
    `- Run: \`${safeRun}\``,
    `- Supabase project: \`${projectRef}\``,
    `- Application origin: \`${appOrigin}\``,
    `- Completed: \`${safeTime}\``,
    "- Provider mode: `Resend delivery test addresses`",
    "",
    ...checks.map((check) => `- PASS / ${check}`),
    "",
    "This run required the exact hourly Supabase Cron job, named Vault configuration, a successful scheduler run within two hours, and HTTP 200 from its correlated pg_net request before using Resend's synthetic delivered-, bounced-, and complained-address contracts. Provider-originated signed bounce and complaint events must reach the deployed webhook, update isolated durable event rows, and suppress only the matching synthetic accounts; bounce recovery must also succeed explicitly.",
    "The first retry failure was injected at Outflow's durable completion boundary, then the deployed worker performed the provider retry. Scheduler evidence contains only fixed configuration checks, timestamps, and the correlated HTTP status; it does not expose a command, URL, request, response body, or secret. This does not prove delivery to a human inbox, actual provider API failure, or provider diversity.",
    "The report excludes identities, credentials, invitation links, message content, provider identifiers, database rows, and response bodies.",
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
  const config = resolveMessagingAcceptanceConfig({ ...fileEnvironment, ...process.env });
  if (config.errors.length) {
    for (const error of config.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  try {
    const checks = await runMessagingPlaneAcceptance(config);
    const report = buildMessagingPlaneReport({
      checks,
      projectRef: config.projectRef,
      appOrigin: config.appOrigin,
      commitSha: process.env.GITHUB_SHA,
      actor: process.env.GITHUB_ACTOR,
      runId: process.env.GITHUB_RUN_ID,
      completedAt: new Date().toISOString(),
    });
    if (summaryFile) await appendFile(resolve(summaryFile), report, "utf8");
    console.log(report);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Staging messaging plane failed.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
