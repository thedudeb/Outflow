import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openTracker } from "../e2e/helpers";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const authStorageKey = "sb-127-auth-token";
const editorUserId = "22222222-2222-4222-8222-222222222222";
const invitedUserId = "33333333-3333-4333-8333-333333333333";
const invitationToken = "outflow-private-invitation-token-12345678901234567890";
const calendarTokens = [
  "abcdefghijklmnopqrstuvwxyzABCDEFGH012345678",
  "ZYXWVUTSRQPONMLKJIHGFEDCBAabcdefgh012345678",
];
const fixtureUser = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "owner@example.com",
  email_confirmed_at: "2026-07-19T12:00:00.000Z",
  phone: "",
  confirmed_at: "2026-07-19T12:00:00.000Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-07-19T12:00:00.000Z",
  updated_at: "2026-07-19T12:00:00.000Z",
  is_anonymous: false,
};
const invitedUser = {
  ...fixtureUser,
  id: invitedUserId,
  email: "invited@example.com",
};

function storedSession(user = fixtureUser) {
  return {
    access_token: "fixture-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "fixture-refresh-token",
    user,
  };
}

function createCloudState({
  replaceMode = "applied",
  entitlementStatus = "active",
  accessGranted = true,
  canSync = true,
  inviteToken = invitationToken,
} = {}) {
  return {
    replaceMode,
    entitlementStatus,
    accessGranted,
    canSync,
    inviteToken,
    writes: [],
    sentInvitations: [],
    roleChanges: [],
    removedMembers: [],
    revokedInvitations: [],
    acceptedInvitations: [],
    notificationPreferences: null,
    notificationPreferenceWrites: [],
    calendarFeed: null,
    calendarFeedToken: "",
    calendarFeedTokens: [],
    calendarOperations: [],
    ledger: {
      id: "studio-cloud",
      name: "Studio Cloud",
      kind: "team",
      owner_id: fixtureUser.id,
      revision: 2,
      created_at: "2026-07-19T12:00:00.000Z",
      updated_at: "2026-07-19T12:00:00.000Z",
    },
    members: [
      {
        ledger_id: "studio-cloud",
        user_id: fixtureUser.id,
        role: "owner",
        joined_at: "2026-07-19T12:00:00.000Z",
      },
      {
        ledger_id: "studio-cloud",
        user_id: editorUserId,
        role: "editor",
        joined_at: "2026-07-19T12:30:00.000Z",
      },
    ],
    profiles: [
      { id: fixtureUser.id, display_name: "Avery Owner" },
      { id: editorUserId, display_name: "Morgan Editor" },
      { id: invitedUserId, display_name: "Riley Invitee" },
    ],
    invitations: [],
    subscriptions: [{
      ledger_id: "studio-cloud",
      id: "figma-cloud",
      name: "Figma Cloud",
      amount: 25,
      currency: "USD",
      cycle: "monthly",
      next_billing_date: "2026-08-19",
      category: "Design",
      tags: ["team", "design"],
      color: "#8b5cf6",
      trial_end_date: null,
      reminder_lead_days: [7],
      paused: false,
      revision: 1,
      created_by: editorUserId,
      updated_by: fixtureUser.id,
      source_created_by: "Avery Owner",
      source_updated_by: "Avery Owner",
      client_updated_at: "2026-07-19T12:00:00.000Z",
      created_at: "2026-07-19T12:00:00.000Z",
      updated_at: "2026-07-19T12:00:00.000Z",
    }],
  };
}

function cloudRowFromPayload(subscription, existingRow = null) {
  return {
    ledger_id: "studio-cloud",
    id: subscription.id,
    name: subscription.name,
    amount: subscription.amount,
    currency: subscription.currency,
    cycle: subscription.cycle,
    next_billing_date: subscription.nextBillingDate,
    category: subscription.category,
    tags: subscription.tags,
    color: subscription.color,
    trial_end_date: subscription.trialEndDate || null,
    reminder_lead_days: subscription.reminderLeadDays,
    paused: subscription.paused,
    revision: subscription.revision,
    created_by: existingRow?.created_by || fixtureUser.id,
    updated_by: fixtureUser.id,
    source_created_by: existingRow?.source_created_by || subscription.createdBy,
    source_updated_by: subscription.updatedBy,
    client_updated_at: subscription.updatedAt,
    created_at: "2026-07-19T12:00:00.000Z",
    updated_at: subscription.updatedAt,
  };
}

async function seedStoredSession(page, session = storedSession()) {
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: authStorageKey, value: session });
}

async function installCloudFixture(page, { verifiedUser = null, cloudState = null } = {}) {
  const traffic = [];
  const migrations = [];

  await page.route("**/supabase/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const entry = {
      method: request.method(),
      path: url.pathname,
      search: url.search,
      body: request.postDataJSON?.() || null,
    };
    traffic.push(entry);

    const reply = (body, status = 200, headers = {}) => route.fulfill({
      status,
      contentType: "application/json",
      headers,
      body: JSON.stringify(body),
    });

    if (url.pathname.endsWith("/auth/v1/otp")) return reply({});
    if (url.pathname.endsWith("/auth/v1/user")) {
      return verifiedUser
        ? reply(verifiedUser)
        : reply({ message: "Invalid JWT" }, 401);
    }
    if (url.pathname.endsWith("/auth/v1/logout")) return reply({});
    if (url.pathname.endsWith("/rest/v1/rpc/migrate_guest_workspace")) {
      migrations.push(entry.body);
      const subscriptions = entry.body?.workspace_payload?.ledgers?.flatMap((ledger) => ledger.subscriptions || []) || [];
      return reply({
        ledgerCount: entry.body?.workspace_payload?.ledgers?.length || 0,
        subscriptionCount: subscriptions.length,
      });
    }
    if (url.pathname.endsWith("/rest/v1/entitlements")) {
      return cloudState?.entitlementStatus
        ? reply({ status: cloudState.entitlementStatus, provider: "stripe", purchased_at: "2026-07-19T12:00:00.000Z" })
        : reply([], 200, { "Content-Range": "0-0/0" });
    }
    if (url.pathname.endsWith("/rest/v1/notification_preferences")) {
      return cloudState?.notificationPreferences
        ? reply(cloudState.notificationPreferences)
        : reply([], 200, { "Content-Range": "0-0/0" });
    }
    if (url.pathname.endsWith("/rest/v1/ledgers")) {
      return reply(cloudState?.accessGranted ? [cloudState.ledger] : []);
    }
    if (url.pathname.endsWith("/rest/v1/ledger_members")) {
      if (entry.method === "PATCH" && cloudState) {
        const targetUserId = (url.searchParams.get("user_id") || "").replace(/^eq\./, "");
        const member = cloudState.members.find((candidate) => candidate.user_id === targetUserId);
        if (member && ["editor", "viewer"].includes(entry.body?.role)) member.role = entry.body.role;
        cloudState.roleChanges.push({ userId: targetUserId, role: entry.body?.role });
        return reply([]);
      }
      if (entry.method === "DELETE" && cloudState) {
        const targetUserId = (url.searchParams.get("user_id") || "").replace(/^eq\./, "");
        cloudState.members = cloudState.members.filter((member) => member.user_id !== targetUserId);
        cloudState.removedMembers.push(targetUserId);
        return reply([]);
      }
      return reply(cloudState?.accessGranted ? cloudState.members : []);
    }
    if (url.pathname.endsWith("/rest/v1/profiles")) return reply(cloudState?.accessGranted ? cloudState.profiles : []);
    if (url.pathname.endsWith("/rest/v1/ledger_invitations")) {
      if (entry.method === "DELETE" && cloudState) {
        const invitationId = (url.searchParams.get("id") || "").replace(/^eq\./, "");
        cloudState.invitations = cloudState.invitations.filter((invitation) => invitation.id !== invitationId);
        cloudState.revokedInvitations.push(invitationId);
        return reply([]);
      }
      return reply(cloudState?.accessGranted ? cloudState.invitations : []);
    }
    if (url.pathname.endsWith("/rest/v1/subscriptions")) {
      return reply(cloudState?.accessGranted ? cloudState.subscriptions : []);
    }
    if (url.pathname.endsWith("/rest/v1/rpc/can_sync_ledger")) {
      return reply(Boolean(cloudState?.accessGranted && cloudState.canSync));
    }
    if (url.pathname.endsWith("/rest/v1/rpc/save_notification_preferences") && cloudState) {
      if (entry.body?.requested_email_enabled && cloudState.entitlementStatus !== "active") {
        return reply({ message: "Outflow Pro is required for email automation." }, 403);
      }
      const updatedAt = new Date().toISOString();
      cloudState.notificationPreferences = {
        email_enabled: entry.body?.requested_email_enabled === true,
        paused_schedule_enabled: entry.body?.requested_paused_schedule_enabled === true,
        timezone: entry.body?.requested_timezone,
        updated_at: updatedAt,
      };
      cloudState.notificationPreferenceWrites.push(entry.body);
      return reply({
        emailEnabled: cloudState.notificationPreferences.email_enabled,
        pausedScheduleEnabled: cloudState.notificationPreferences.paused_schedule_enabled,
        timezone: cloudState.notificationPreferences.timezone,
        updatedAt,
      });
    }
    if (url.pathname.endsWith("/rest/v1/rpc/get_calendar_feed") && cloudState) {
      return reply(cloudState.calendarFeed);
    }
    if (url.pathname.endsWith("/rest/v1/rpc/create_or_rotate_calendar_feed") && cloudState) {
      if (cloudState.entitlementStatus !== "active" || !cloudState.accessGranted) {
        return reply({ message: "Outflow Pro is required for hosted calendars." }, 403);
      }
      const token = calendarTokens[cloudState.calendarFeedTokens.length % calendarTokens.length];
      const now = new Date().toISOString();
      const createdAt = cloudState.calendarFeed?.createdAt || now;
      cloudState.calendarFeed = {
        id: "44444444-4444-4444-8444-444444444444",
        ledgerId: cloudState.ledger.id,
        ledgerName: cloudState.ledger.name,
        includePaused: entry.body?.requested_include_paused === true,
        createdAt,
        updatedAt: now,
        rotatedAt: now,
        lastAccessAt: null,
      };
      cloudState.calendarFeedToken = token;
      cloudState.calendarFeedTokens.push(token);
      cloudState.calendarOperations.push({ type: "publish", body: entry.body, token });
      return reply({ ...cloudState.calendarFeed, token });
    }
    if (url.pathname.endsWith("/rest/v1/rpc/set_calendar_feed_options") && cloudState) {
      if (!cloudState.calendarFeed || cloudState.entitlementStatus !== "active") {
        return reply({ message: "An active Pro ledger membership is required." }, 403);
      }
      cloudState.calendarFeed = {
        ...cloudState.calendarFeed,
        includePaused: entry.body?.requested_include_paused === true,
        updatedAt: new Date().toISOString(),
      };
      cloudState.calendarOperations.push({ type: "scope", body: entry.body });
      return reply(cloudState.calendarFeed);
    }
    if (url.pathname.endsWith("/rest/v1/rpc/revoke_calendar_feed") && cloudState) {
      const revoked = Boolean(cloudState.calendarFeed);
      cloudState.calendarOperations.push({
        type: "revoke",
        body: entry.body,
        token: cloudState.calendarFeedToken,
      });
      cloudState.calendarFeed = null;
      cloudState.calendarFeedToken = "";
      return reply(revoked);
    }
    if (url.pathname.endsWith("/rest/v1/rpc/accept_ledger_invitation") && cloudState) {
      if (entry.body?.invitation_token !== cloudState.inviteToken || !verifiedUser) {
        return reply({ message: "This invitation is invalid or expired." }, 400);
      }
      cloudState.accessGranted = true;
      if (!cloudState.members.some((member) => member.user_id === verifiedUser.id)) {
        cloudState.members.push({
          ledger_id: cloudState.ledger.id,
          user_id: verifiedUser.id,
          role: "viewer",
          joined_at: new Date().toISOString(),
        });
      }
      cloudState.acceptedInvitations.push(entry.body.invitation_token);
      return reply({
        ledgerId: cloudState.ledger.id,
        ledgerName: cloudState.ledger.name,
        ledgerKind: cloudState.ledger.kind,
        role: "viewer",
      });
    }
    if (url.pathname.endsWith("/rest/v1/rpc/replace_ledger_snapshot") && cloudState) {
      cloudState.writes.push(entry.body);
      if (cloudState.replaceMode === "conflict") {
        cloudState.ledger.revision = 3;
        cloudState.ledger.updated_at = "2026-07-19T13:00:00.000Z";
        cloudState.subscriptions = [{
          ...cloudState.subscriptions[0],
          name: "Remote Winner",
          amount: 42,
          revision: 2,
          client_updated_at: "2026-07-19T13:00:00.000Z",
          updated_at: "2026-07-19T13:00:00.000Z",
        }];
        return reply({
          status: "conflict",
          ledgerId: cloudState.ledger.id,
          baseRevision: entry.body?.expected_revision,
          currentRevision: 3,
        });
      }
      cloudState.ledger.revision += 1;
      cloudState.ledger.updated_at = "2026-07-19T13:00:00.000Z";
      const existingRows = new Map(cloudState.subscriptions.map((subscription) => [subscription.id, subscription]));
      cloudState.subscriptions = (entry.body?.subscriptions_payload || []).map((subscription) =>
        cloudRowFromPayload(subscription, existingRows.get(subscription.id)),
      );
      return reply({
        status: "applied",
        ledgerId: cloudState.ledger.id,
        baseRevision: entry.body?.expected_revision,
        currentRevision: cloudState.ledger.revision,
      });
    }
    if (url.pathname.endsWith("/functions/v1/create-pro-checkout")) {
      return reply({ message: "Checkout unavailable in account fixture" }, 503);
    }
    if (url.pathname.endsWith("/functions/v1/send-ledger-invite") && cloudState) {
      const id = `fixture-invite-${cloudState.sentInvitations.length + 1}`;
      const invitation = {
        id,
        ledger_id: cloudState.ledger.id,
        email: entry.body?.email,
        role: entry.body?.role,
        invited_by: verifiedUser?.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        accepted_at: null,
        created_at: new Date().toISOString(),
      };
      cloudState.invitations.push(invitation);
      cloudState.sentInvitations.push({
        ledgerId: entry.body?.ledgerId,
        email: entry.body?.email,
        role: entry.body?.role,
      });
      return reply({ id, email: invitation.email, role: invitation.role, expiresAt: invitation.expires_at }, 201);
    }

    return reply({ message: `Unhandled account fixture endpoint: ${request.method()} ${url.pathname}` }, 501);
  });

  return { traffic, migrations };
}

function monthlyOutflow(page) {
  return page.getByText("Monthly outflow", { exact: true }).locator("xpath=ancestor::section[1]");
}

function violationSummary(violations) {
  return violations
    .map((violation) => `${violation.id}: ${violation.help}\n${violation.nodes.flatMap((node) => node.target).join(", ")}`)
    .join("\n\n");
}

async function openStudioCloud(page) {
  await page.getByRole("button", { name: "Open account controls for owner@example.com", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Account / Pro" });
  await expect(dialog).toContainText("Studio Cloud");
  await dialog.getByRole("button", { name: "Open", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Open Studio Cloud ledger controls", exact: true })).toBeVisible();
}

test("configured guest requests an optional sign-in link without uploading local data", async ({ page }) => {
  const fixture = await installCloudFixture(page);
  await openTracker(page);
  await expect(page.getByRole("article").filter({ hasText: "Netflix" })).toHaveCount(1);
  await page.getByRole("button", { name: "Open optional account controls", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Account / Pro" });
  await expect(dialog).toContainText("Identity Guest");
  await expect(dialog).toContainText("Cloud Ready");
  await dialog.getByRole("textbox", { name: "Email address", exact: true }).fill("OWNER@EXAMPLE.COM");
  await dialog.getByRole("button", { name: "Email sign-in link", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Sign-in link sent. Your local workspace has not been uploaded.");

  const otp = fixture.traffic.find((request) => request.path.endsWith("/auth/v1/otp"));
  expect(otp?.body).toMatchObject({ email: "owner@example.com", create_user: true });
  expect(otp?.body?.code_challenge).toBeTruthy();
  expect(fixture.migrations).toHaveLength(0);
  await dialog.getByRole("button", { name: "Close account controls", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: "Netflix" })).toHaveCount(1);
});

test("verified sign-in preserves local data until Create cloud copy is selected", async ({ page }) => {
  const fixture = await installCloudFixture(page, { verifiedUser: fixtureUser });
  await seedStoredSession(page);
  await openTracker(page);
  await expect(page.getByRole("button", { name: "Open account controls for owner@example.com", exact: true })).toBeVisible();

  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Local Boundary");
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill("9");
  await page.getByRole("button", { name: "Add subscription", exact: true }).click();
  const localCard = page.getByRole("article").filter({ hasText: "Local Boundary" });
  await expect(localCard).toHaveCount(1);

  await page.getByRole("button", { name: "Open account controls for owner@example.com", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Account / Pro" });
  await expect(dialog).toContainText("Identity Signed in");
  await expect(dialog).toContainText("Local workspace active");
  await expect(dialog).toContainText("No cloud ledgers yet");
  expect(fixture.migrations).toHaveLength(0);

  const workspaceBefore = await page.evaluate(() => localStorage.getItem("outflow:workspace"));
  await dialog.getByRole("button", { name: "Create cloud copy", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Cloud copy confirmed / 1 ledgers / 6 records. Local data remains available.");
  expect(fixture.migrations).toHaveLength(1);
  expect(fixture.migrations[0]?.workspace_payload?.ledgers).toHaveLength(1);
  expect(fixture.migrations[0]?.workspace_payload?.ledgers[0]?.subscriptions).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "Local Boundary", amount: 9 })]),
  );
  expect(await page.evaluate(() => localStorage.getItem("outflow:workspace"))).toBe(workspaceBefore);

  await dialog.getByRole("button", { name: "Close account controls", exact: true }).click();
  await expect(localCard).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("article").filter({ hasText: "Local Boundary" })).toHaveCount(1);
  expect(fixture.migrations).toHaveLength(1);
});

test("forged stored session is rejected and cleared without touching the local ledger", async ({ page }) => {
  const fixture = await installCloudFixture(page);
  await seedStoredSession(page, storedSession({ ...fixtureUser, email: "forged@example.com" }));
  await openTracker(page);

  await expect(page.getByRole("button", { name: "Open optional account controls", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), authStorageKey)).toBeNull();
  await expect(page.getByRole("article").filter({ hasText: "Netflix" })).toHaveCount(1);
  await page.getByRole("button", { name: "Open optional account controls", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Account / Pro" });
  await expect(dialog.getByRole("alert")).toContainText("Your account session could not be verified. Sign in again; local ledgers were not changed.");
  await expect(dialog).toContainText("Identity Guest");
  expect(fixture.migrations).toHaveLength(0);
  expect(fixture.traffic.filter((request) => request.path.includes("/rest/v1/"))).toHaveLength(0);
});

test("cloud ledger stays isolated, synchronizes one revision, and sign-out restores local totals", async ({ page }) => {
  const cloudState = createCloudState();
  await installCloudFixture(page, { verifiedUser: fixtureUser, cloudState });
  await seedStoredSession(page);
  await openTracker(page);

  await expect(monthlyOutflow(page)).toContainText("$39.47");
  const localWorkspace = await page.evaluate(() => localStorage.getItem("outflow:workspace"));
  await openStudioCloud(page);

  await expect(page.getByRole("status")).toContainText("Cloud ledger loaded. Changes use optimistic revision checks.");
  await expect(monthlyOutflow(page)).toContainText("$25.00");
  await expect(monthlyOutflow(page)).not.toContainText("$39.47");
  let cloudCard = page.getByRole("article").filter({ hasText: "Figma Cloud" });
  await expect(cloudCard).toContainText("Added by Morgan Editor / Updated by You");
  expect(await page.evaluate(() => localStorage.getItem("outflow:workspace"))).toBe(localWorkspace);

  await cloudCard.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill("30");
  await page.getByRole("button", { name: "Commit changes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Synchronized revision 3.");
  await expect(monthlyOutflow(page)).toContainText("$30.00");
  expect(cloudState.writes).toHaveLength(1);
  expect(cloudState.writes[0]).toMatchObject({
    target_ledger_id: "studio-cloud",
    expected_revision: 2,
    subscriptions_payload: [expect.objectContaining({ name: "Figma Cloud", amount: 30 })],
  });
  expect(cloudState.writes[0]?.client_operation_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(await page.evaluate(() => localStorage.getItem("outflow:workspace"))).toBe(localWorkspace);

  await page.getByRole("button", { name: "Open account controls for owner@example.com", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Account / Pro" });
  await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Signed out. Local ledgers remain on this browser.");
  await dialog.getByRole("button", { name: "Close account controls", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: "Netflix" })).toHaveCount(1);
  await expect(monthlyOutflow(page)).toContainText("$39.47");
  await expect(page.getByText("Figma Cloud", { exact: true })).toHaveCount(0);
});

test("stale cloud write is rejected and replaced by the authoritative server revision", async ({ page }) => {
  const cloudState = createCloudState({ replaceMode: "conflict" });
  await installCloudFixture(page, { verifiedUser: fixtureUser, cloudState });
  await seedStoredSession(page);
  await openTracker(page);
  const localWorkspace = await page.evaluate(() => localStorage.getItem("outflow:workspace"));
  await openStudioCloud(page);

  const cloudCard = page.getByRole("article").filter({ hasText: "Figma Cloud" });
  await cloudCard.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill("31");
  await page.getByRole("button", { name: "Commit changes", exact: true }).click();

  const conflict = page.getByRole("alert");
  await expect(conflict).toContainText("Cloud changed at revision 3. Your stale write was rejected");
  const authoritativeCard = page.getByRole("article").filter({ hasText: "Remote Winner" });
  await expect(authoritativeCard).toContainText("$42.00");
  await expect(page.getByText("$31.00", { exact: true })).toHaveCount(0);
  await expect(authoritativeCard.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
  expect(cloudState.writes).toHaveLength(1);
  expect(cloudState.writes[0]?.expected_revision).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem("outflow:workspace"))).toBe(localWorkspace);
});

test("Pro owner manages shared roles, invitations, and removals through authoritative refreshes", async ({ page }) => {
  const cloudState = createCloudState();
  await installCloudFixture(page, { verifiedUser: fixtureUser, cloudState });
  await seedStoredSession(page);
  await openTracker(page);

  await page.getByRole("button", { name: "Open account controls for owner@example.com", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Account / Pro" });
  await expect(dialog).toContainText("Studio Cloud");
  await dialog.getByRole("button", { name: "Members", exact: true }).click();

  const access = dialog.getByRole("combobox", { name: "Access level for Morgan Editor", exact: true });
  await expect(access).toHaveValue("editor");
  await access.selectOption("viewer");
  await expect(dialog.getByText("Member access changed to viewer.", { exact: true })).toBeVisible();
  await expect(access).toHaveValue("viewer");
  expect(cloudState.roleChanges).toEqual([{ userId: editorUserId, role: "viewer" }]);

  await dialog.getByRole("textbox", { name: "Invite by email", exact: true }).fill("COLLABORATOR@EXAMPLE.COM");
  await dialog.getByRole("combobox", { name: "Access", exact: true }).selectOption("editor");
  await dialog.getByRole("button", { name: "Send invite", exact: true }).click();
  await expect(dialog.getByText("Invitation sent to collaborator@example.com.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("collaborator@example.com", { exact: true })).toBeVisible();
  expect(cloudState.sentInvitations).toEqual([{
    ledgerId: "studio-cloud",
    email: "collaborator@example.com",
    role: "editor",
  }]);

  await dialog.getByRole("button", { name: "Revoke", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByText("Pending invitation revoked.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("collaborator@example.com", { exact: true })).toHaveCount(0);
  expect(cloudState.revokedInvitations).toEqual(["fixture-invite-1"]);

  const memberRow = dialog.getByRole("combobox", { name: "Access level for Morgan Editor", exact: true }).locator("xpath=ancestor::div[1]");
  await memberRow.getByRole("button", { name: "Remove", exact: true }).click();
  await memberRow.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByText("Member removed from the cloud ledger.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Morgan Editor", { exact: true })).toHaveCount(0);
  expect(cloudState.removedMembers).toEqual([editorUserId]);
});

test("configured shared collaboration controls meet the automated WCAG A and AA gate", async ({ page }) => {
  const cloudState = createCloudState();
  await installCloudFixture(page, { verifiedUser: fixtureUser, cloudState });
  await seedStoredSession(page);
  await openTracker(page);

  await page.getByRole("button", { name: "Open account controls for owner@example.com", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Account / Pro" });
  await expect(dialog).toContainText("Studio Cloud");
  await dialog.getByRole("button", { name: "Members", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Invite by email", exact: true })).toBeVisible();

  const { violations } = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(wcagTags)
    .analyze();
  expect(violations.length, violationSummary(violations)).toBe(0);
});

test("refunded owner keeps data-control removal while Pro collaboration actions stay locked", async ({ page }) => {
  const cloudState = createCloudState({ entitlementStatus: "refunded", canSync: false });
  await installCloudFixture(page, { verifiedUser: fixtureUser, cloudState });
  await seedStoredSession(page);
  await openTracker(page);

  await page.getByRole("button", { name: "Open account controls for owner@example.com", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Account / Pro" });
  await expect(dialog).toContainText("Entitlement Free");
  await dialog.getByRole("button", { name: "Members", exact: true }).click();
  await expect(dialog).toContainText("Pro is required for new invitations and role changes.");
  await expect(dialog.getByRole("textbox", { name: "Invite by email", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("combobox", { name: "Access level for Morgan Editor", exact: true })).toBeDisabled();

  const memberRow = dialog.getByRole("combobox", { name: "Access level for Morgan Editor", exact: true }).locator("xpath=ancestor::div[1]");
  const remove = memberRow.getByRole("button", { name: "Remove", exact: true });
  await expect(remove).toBeEnabled();
  await remove.click();
  await memberRow.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByText("Member removed from the cloud ledger.", { exact: true })).toBeVisible();
  expect(cloudState.removedMembers).toEqual([editorUserId]);
  expect(cloudState.roleChanges).toHaveLength(0);
  expect(cloudState.sentInvitations).toHaveLength(0);
});

test("invited account accepts the private token without changing its local workspace", async ({ page }) => {
  const cloudState = createCloudState({ entitlementStatus: null, accessGranted: false, canSync: false });
  await installCloudFixture(page, { verifiedUser: invitedUser, cloudState });
  await seedStoredSession(page, storedSession(invitedUser));
  await page.goto(`/#app?invite=${invitationToken}`);

  const dialog = page.getByRole("dialog", { name: "Account / Pro" });
  await expect(dialog).toBeVisible();
  const localWorkspace = await page.evaluate(() => localStorage.getItem("outflow:workspace"));
  await expect(dialog).toContainText("Private ledger invitation");
  await expect(dialog).toContainText("No cloud ledgers yet");
  await dialog.getByRole("button", { name: "Accept invitation", exact: true }).click();

  await expect(dialog.getByText("Joined Studio Cloud as viewer.", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("Studio Cloud");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#app");
  expect(cloudState.acceptedInvitations).toEqual([invitationToken]);
  expect(cloudState.members).toEqual(expect.arrayContaining([
    expect.objectContaining({ user_id: invitedUserId, role: "viewer" }),
  ]));
  expect(await page.evaluate(() => localStorage.getItem("outflow:workspace"))).toBe(localWorkspace);
});

test("email reminders persist independently and remain disableable after Pro is refunded", async ({ page }) => {
  const cloudState = createCloudState();
  await installCloudFixture(page, { verifiedUser: fixtureUser, cloudState });
  await seedStoredSession(page);
  await openTracker(page);
  const localAlertSettings = await page.evaluate(() => localStorage.getItem("outflow:alert-settings"));

  await page.getByRole("button", { name: "Open account controls for owner@example.com", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Account / Pro" });
  const emailEnabled = dialog.getByRole("checkbox", { name: /Email reminders/ });
  const pausedSchedules = dialog.getByRole("checkbox", { name: /Paused schedules/ });
  await expect(emailEnabled).not.toBeChecked();
  await emailEnabled.check();
  await pausedSchedules.check();
  await dialog.getByRole("combobox", { name: "Reminder timezone", exact: true }).selectOption("UTC");
  await dialog.getByRole("button", { name: "Save email rules", exact: true }).click();
  await expect(dialog.getByText("Email reminders enabled. Subscription lead times control each delivery.", { exact: true })).toBeVisible();
  expect(cloudState.notificationPreferenceWrites).toEqual([{
    requested_email_enabled: true,
    requested_paused_schedule_enabled: true,
    requested_timezone: "UTC",
  }]);
  expect(await page.evaluate(() => localStorage.getItem("outflow:alert-settings"))).toBe(localAlertSettings);

  await dialog.getByRole("button", { name: "Close account controls", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Active subscriptions" })).toBeVisible();
  await page.getByRole("button", { name: "Open account controls for owner@example.com", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Account / Pro" });
  await expect(dialog.getByRole("checkbox", { name: /Email reminders/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Paused schedules/ })).toBeChecked();
  await expect(dialog.getByRole("combobox", { name: "Reminder timezone", exact: true })).toHaveValue("UTC");

  await dialog.getByRole("button", { name: "Close account controls", exact: true }).click();
  cloudState.entitlementStatus = "refunded";
  await page.reload();
  await expect(page.getByRole("heading", { name: "Active subscriptions" })).toBeVisible();
  await page.getByRole("button", { name: "Open account controls for owner@example.com", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Account / Pro" });
  const refundableEmailToggle = dialog.getByRole("checkbox", { name: /Email reminders/ });
  await expect(refundableEmailToggle).toBeChecked();
  await expect(refundableEmailToggle).toBeEnabled();
  await expect(dialog.getByText("Suspended", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /Paused schedules/ })).toBeDisabled();
  await refundableEmailToggle.uncheck();
  await dialog.getByRole("button", { name: "Save email rules", exact: true }).click();
  await expect(dialog.getByText("Email reminders disabled. Device alert settings were not changed.", { exact: true })).toBeVisible();
  expect(cloudState.notificationPreferenceWrites[1]).toEqual({
    requested_email_enabled: false,
    requested_paused_schedule_enabled: true,
    requested_timezone: "UTC",
  });
  expect(await page.evaluate(() => localStorage.getItem("outflow:alert-settings"))).toBe(localAlertSettings);
});

test("hosted calendar feed keeps its token one-time, rotates, suspends, and revokes cleanly", async ({ page }) => {
  const cloudState = createCloudState();
  const fixture = await installCloudFixture(page, { verifiedUser: fixtureUser, cloudState });
  await seedStoredSession(page);
  await openTracker(page);
  const localWorkspace = await page.evaluate(() => localStorage.getItem("outflow:workspace"));
  await openStudioCloud(page);

  await page.getByRole("button", { name: "Export calendar", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Calendar export" });
  await expect(dialog.getByText("Not published", { exact: true })).toBeVisible();
  const pausedScope = dialog.getByRole("checkbox", { name: /Feed paused schedules/ });
  await expect(pausedScope).not.toBeChecked();
  await dialog.getByRole("button", { name: "Publish feed", exact: true }).click();
  await expect(dialog.getByText("Hosted feed published. This secret URL is shown once.", { exact: true })).toBeVisible();

  const secretUrl = dialog.getByRole("textbox", { name: "Secret hosted calendar feed URL", exact: true });
  const firstUrl = new URL(await secretUrl.inputValue());
  const firstToken = firstUrl.searchParams.get("token");
  expect(firstUrl.pathname).toBe("/supabase/functions/v1/calendar-feed");
  expect([...firstUrl.searchParams.keys()]).toEqual(["token"]);
  expect(firstToken).toBe(calendarTokens[0]);
  expect(cloudState.calendarOperations[0]).toEqual({
    type: "publish",
    body: { target_ledger_id: "studio-cloud", requested_include_paused: false },
    token: calendarTokens[0],
  });
  expect(cloudState.calendarFeed).not.toHaveProperty("token");

  const { violations } = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(wcagTags)
    .analyze();
  expect(violations.length, violationSummary(violations)).toBe(0);

  await pausedScope.check();
  await dialog.getByRole("button", { name: "Save scope", exact: true }).click();
  await expect(dialog.getByText("Hosted feed scope updated.", { exact: true })).toBeVisible();
  await expect(secretUrl).toHaveValue(firstUrl.toString());
  expect(cloudState.calendarFeedToken).toBe(firstToken);
  expect(cloudState.calendarOperations[1]).toEqual({
    type: "scope",
    body: { target_ledger_id: "studio-cloud", requested_include_paused: true },
  });

  await dialog.getByRole("button", { name: "Rotate URL", exact: true }).click();
  await expect(dialog.getByText("Feed URL rotated. The previous URL is inactive.", { exact: true })).toBeVisible();
  const secondUrl = new URL(await secretUrl.inputValue());
  const secondToken = secondUrl.searchParams.get("token");
  expect(secondToken).toBe(calendarTokens[1]);
  expect(secondToken).not.toBe(firstToken);
  expect(cloudState.calendarFeedTokens).toEqual([firstToken, secondToken]);

  await dialog.getByRole("button", { name: "Close calendar export", exact: true }).click();
  await page.getByRole("button", { name: "Export calendar", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Calendar export" });
  await expect(dialog.getByText("Published", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Secret hosted calendar feed URL", exact: true })).toHaveCount(0);
  const metadataReads = fixture.traffic.filter((request) => request.path.endsWith("/rest/v1/rpc/get_calendar_feed"));
  expect(metadataReads.length).toBeGreaterThanOrEqual(2);
  expect(metadataReads.every((request) => !JSON.stringify(request).includes(firstToken) && !JSON.stringify(request).includes(secondToken))).toBe(true);

  await dialog.getByRole("button", { name: "Close calendar export", exact: true }).click();
  cloudState.entitlementStatus = "refunded";
  cloudState.canSync = false;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Active subscriptions" })).toBeVisible();
  await openStudioCloud(page);
  await page.getByRole("button", { name: "Export calendar", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Calendar export" });
  await expect(dialog.getByText("Suspended", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /Feed paused schedules/ })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Rotate URL", exact: true })).toHaveCount(0);
  const revoke = dialog.getByRole("button", { name: "Revoke", exact: true });
  await expect(revoke).toBeEnabled();
  await revoke.click();
  await expect(dialog.getByText("Confirm revocation to disable the hosted URL.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm revoke", exact: true }).click();
  await expect(dialog.getByText("Hosted calendar feed revoked.", { exact: true })).toBeVisible();
  expect(cloudState.calendarFeed).toBeNull();
  expect(cloudState.calendarFeedToken).toBe("");
  expect(cloudState.calendarOperations.at(-1)).toEqual({
    type: "revoke",
    body: { target_ledger_id: "studio-cloud" },
    token: secondToken,
  });
  expect(await page.evaluate(() => localStorage.getItem("outflow:workspace"))).toBe(localWorkspace);
});
