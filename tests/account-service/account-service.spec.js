import { expect, test } from "@playwright/test";
import { openTracker } from "../e2e/helpers";

const authStorageKey = "sb-127-auth-token";
const editorUserId = "22222222-2222-4222-8222-222222222222";
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

function createCloudState({ replaceMode = "applied" } = {}) {
  return {
    replaceMode,
    writes: [],
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
    ],
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
    const entry = { method: request.method(), path: url.pathname, body: request.postDataJSON?.() || null };
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
      return cloudState
        ? reply({ status: "active", provider: "stripe", purchased_at: "2026-07-19T12:00:00.000Z" })
        : reply([], 200, { "Content-Range": "0-0/0" });
    }
    if (url.pathname.endsWith("/rest/v1/notification_preferences")) {
      return reply([], 200, { "Content-Range": "0-0/0" });
    }
    if (url.pathname.endsWith("/rest/v1/ledgers")) return reply(cloudState ? [cloudState.ledger] : []);
    if (url.pathname.endsWith("/rest/v1/ledger_members")) return reply(cloudState?.members || []);
    if (url.pathname.endsWith("/rest/v1/profiles")) return reply(cloudState?.profiles || []);
    if (url.pathname.endsWith("/rest/v1/ledger_invitations")) return reply([]);
    if (url.pathname.endsWith("/rest/v1/subscriptions")) return reply(cloudState?.subscriptions || []);
    if (url.pathname.endsWith("/rest/v1/rpc/can_sync_ledger")) return reply(Boolean(cloudState));
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

    return reply({ message: `Unhandled account fixture endpoint: ${request.method()} ${url.pathname}` }, 501);
  });

  return { traffic, migrations };
}

function monthlyOutflow(page) {
  return page.getByText("Monthly outflow", { exact: true }).locator("xpath=ancestor::section[1]");
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
