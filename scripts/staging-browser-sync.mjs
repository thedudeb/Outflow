import { randomBytes } from "node:crypto";
import { createAcceptanceClient } from "./staging-acceptance-client.mjs";
import { resolveAccountAcceptanceConfig } from "./check-staging-account-plane.mjs";

export const browserSyncCheckNames = Object.freeze([
  "verified browser sessions",
  "isolated shared ledger open",
  "hosted Realtime refresh",
  "stale edit preservation",
  "stale refresh recovery",
  "browser conflict rejection",
  "conflict refresh recovery",
  "Realtime disconnect visibility",
  "authoritative reconnect catch-up",
  "synchronized final state",
]);

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

function subscription(id, name, amount) {
  return {
    id,
    name,
    amount,
    currency: "USD",
    cycle: "monthly",
    nextBillingDate: "2099-08-19",
    category: "Acceptance",
    tags: ["synthetic"],
    color: "#f59e0b",
    trialEndDate: "",
    reminderLeadDays: [7],
    paused: false,
    revision: 0,
    createdBy: "Staging browser acceptance",
    updatedBy: "Staging browser acceptance",
    updatedAt: new Date().toISOString(),
  };
}

function workspaceFixture(suffix) {
  const personalId = `browser-personal-${suffix}`;
  const teamId = `browser-team-${suffix}`;
  const subscriptionId = `browser-charge-${suffix}`;
  const teamName = "Hosted Sync Acceptance";
  const subscriptionName = "Hosted Sync Charge";
  return {
    workspace: {
      schemaVersion: 1,
      activeLedgerId: personalId,
      ledgers: [
        {
          ledger: { id: personalId, name: "Browser Acceptance Personal", kind: "personal" },
          subscriptions: [],
        },
        {
          ledger: { id: teamId, name: teamName, kind: "team" },
          subscriptions: [subscription(subscriptionId, subscriptionName, 33)],
        },
      ],
    },
    teamId,
    teamName,
    subscriptionId,
    subscriptionName,
  };
}

async function signIn(projectUrl, publishableKey, email, password, createClient) {
  const client = createClient(projectUrl, publishableKey);
  const data = remoteResult(await client.auth.signInWithPassword({ email, password }), "synthetic browser sign-in");
  assert(data?.session?.access_token && data?.session?.refresh_token && data?.user?.id, "synthetic browser sign-in");
  return { client, session: data.session, user: data.user };
}

async function deleteSyntheticUsers(admin, userIds) {
  let failed = false;
  for (const userId of [...userIds].reverse()) {
    const result = await admin.auth.admin.deleteUser(userId, false);
    if (result.error && !["user_not_found", "not_found"].includes(result.error.code)) failed = true;
  }
  if (failed) throw new Error("synthetic browser cleanup: one or more identities could not be removed.");
}

export function resolveBrowserSyncAcceptanceConfig(env) {
  return resolveAccountAcceptanceConfig(env);
}

export function browserAuthStorageKey(projectUrl) {
  const url = new URL(projectUrl);
  const projectRef = url.hostname.split(".")[0];
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("Browser auth storage requires a hosted Supabase project URL.");
  return `sb-${projectRef}-auth-token`;
}

export async function provisionBrowserSyncFixture(
  config,
  { createClient = createAcceptanceClient } = {},
) {
  const admin = createClient(config.projectUrl, config.secretKey);
  const suffix = randomBytes(8).toString("hex");
  const password = `${randomBytes(24).toString("base64url")}aA1!`;
  const ownerEmail = `outflow-browser-owner-${suffix}@example.com`;
  const editorEmail = `outflow-browser-editor-${suffix}@example.com`;
  const createdUserIds = [];

  try {
    const ownerUser = remoteResult(await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Outflow browser owner" },
    }), "browser owner setup")?.user;
    if (ownerUser?.id) createdUserIds.push(ownerUser.id);

    const editorUser = remoteResult(await admin.auth.admin.createUser({
      email: editorEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Outflow browser editor" },
    }), "browser editor setup")?.user;
    if (editorUser?.id) createdUserIds.push(editorUser.id);
    assert(ownerUser?.id && editorUser?.id, "synthetic browser accounts");

    const owner = await signIn(config.projectUrl, config.publishableKey, ownerEmail, password, createClient);
    const editor = await signIn(config.projectUrl, config.publishableKey, editorEmail, password, createClient);
    assert(owner.user.id === ownerUser.id && editor.user.id === editorUser.id, "synthetic browser accounts");

    remoteResult(await admin.from("entitlements").upsert({
      user_id: ownerUser.id,
      product: "outflow_pro_lifetime",
      status: "active",
      provider: "manual",
      provider_reference: `staging-browser-${suffix}`,
      purchased_at: new Date().toISOString(),
    }, { onConflict: "user_id,product" }), "browser entitlement setup");

    const fixture = workspaceFixture(suffix);
    const migrated = remoteResult(await owner.client.rpc("migrate_guest_workspace", {
      workspace_payload: fixture.workspace,
    }), "browser workspace migration");
    assert(migrated?.ledgerCount === 2 && migrated?.subscriptionCount === 1, "browser workspace migration");

    const membership = remoteResult(await admin.from("ledger_members").insert({
      ledger_id: fixture.teamId,
      user_id: editorUser.id,
      role: "editor",
    }).select("ledger_id, user_id, role"), "browser editor membership");
    assert(
      membership?.length === 1
        && membership[0].ledger_id === fixture.teamId
        && membership[0].user_id === editorUser.id
        && membership[0].role === "editor",
      "browser editor membership",
    );

    return {
      ...fixture,
      ownerSession: owner.session,
      editorSession: editor.session,
      async cleanup() {
        await deleteSyntheticUsers(admin, createdUserIds);
      },
    };
  } catch (error) {
    try {
      await deleteSyntheticUsers(admin, createdUserIds);
    } catch {
      throw new AggregateError([error], "Browser acceptance setup failed and synthetic cleanup was incomplete.");
    }
    throw error;
  }
}

function safeMetadata(value, pattern, fallback = "not recorded") {
  const normalized = String(value || "").trim();
  return pattern.test(normalized) ? normalized : fallback;
}

export function buildBrowserSyncReport({
  projectUrl,
  appOrigin,
  completed,
  viewport,
  commit,
  actor,
  runUrl,
  recordedAt = new Date().toISOString(),
}) {
  assert(
    completed.length === browserSyncCheckNames.length
      && completed.every((name, index) => name === browserSyncCheckNames[index]),
    "complete ordered browser-sync inventory",
  );
  const projectHost = new URL(projectUrl).hostname;
  const safeViewport = safeMetadata(viewport, /^(desktop|mobile)-chromium$/);
  const safeCommit = safeMetadata(commit, /^[a-f0-9]{7,40}$/i);
  const safeActor = safeMetadata(actor, /^[A-Za-z0-9_.-]{1,80}$/);
  const safeRunUrl = safeMetadata(runUrl, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[0-9]+$/);
  const checks = completed.map((name) => `- PASS / ${name}`).join("\n");

  return [
    `## Staging Browser Sync / ${safeViewport}`,
    "",
    `**PASS** (${completed.length} browser-visible checks)`,
    "",
    `- Project: \`${projectHost}\``,
    `- App: \`${appOrigin}\``,
    `- Commit: \`${safeCommit}\``,
    `- Actor: \`${safeActor}\``,
    `- Recorded: \`${safeMetadata(recordedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)}\``,
    `- Run: ${safeRunUrl === "not recorded" ? safeRunUrl : `[GitHub Actions](${safeRunUrl})`}`,
    "",
    checks,
    "",
    "Scope: two isolated Chromium contexts used real deployed UI, authenticated hosted data, and hosted Realtime. The harness suppressed one incoming database event to exercise server conflict rejection, and closed only the tested browser's Realtime WebSocket to exercise visible disconnect and authoritative reconnect catch-up.",
    "",
    "Excluded: session credentials, identities, row identifiers, operation identifiers, database payloads, Realtime frames, screenshots, traces, and videos. This pass does not prove general network outage recovery, non-Chromium behavior, or production availability.",
    "",
  ].join("\n");
}
