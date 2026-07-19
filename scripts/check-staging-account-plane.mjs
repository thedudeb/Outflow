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

export async function runAccountDataPlaneAcceptance(config, { fetchImpl = fetch } = {}) {
  const completed = [];
  const admin = clientFor(config.projectUrl, config.secretKey);
  const suffix = randomBytes(8).toString("hex");
  const password = `${randomBytes(24).toString("base64url")}aA1!`;
  const ownerEmail = `outflow-owner-${suffix}@example.com`;
  const memberEmail = `outflow-member-${suffix}@example.com`;
  const createdUserIds = [];

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
    const editorSnapshot = [subscription(`accept-editor-${suffix}`, "Editor Acceptance", 33)];
    const applied = remoteResult(await member.client.rpc("replace_ledger_snapshot", {
      target_ledger_id: fixture.teamId,
      expected_revision: 0,
      client_operation_id: operationId,
      subscriptions_payload: editorSnapshot,
    }), "editor revision write");
    assert(applied?.status === "applied" && applied?.currentRevision === 1 && applied?.subscriptionCount === 1, "editor revision write");
    completed.push("editor revision write");

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
    await deleteSyntheticUsers(admin, createdUserIds);
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
    "> Scope: Supabase identity, RLS, migration, invitation acceptance, revision writes, revocation, and account deletion. Provider email, Realtime transport, hosted calendar clients, reminders, and Stripe still require their separate staging matrices.",
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
