import { expect, test } from "@playwright/test";
import { openTracker } from "../e2e/helpers";

const authStorageKey = "sb-127-auth-token";
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

async function seedStoredSession(page, session = storedSession()) {
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: authStorageKey, value: session });
}

async function installCloudFixture(page, { verifiedUser = null } = {}) {
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
    if (url.pathname.endsWith("/auth/v1/logout")) return reply({ message: "Invalid JWT" }, 401);
    if (url.pathname.endsWith("/rest/v1/rpc/migrate_guest_workspace")) {
      migrations.push(entry.body);
      const subscriptions = entry.body?.workspace_payload?.ledgers?.flatMap((ledger) => ledger.subscriptions || []) || [];
      return reply({
        ledgerCount: entry.body?.workspace_payload?.ledgers?.length || 0,
        subscriptionCount: subscriptions.length,
      });
    }
    if (
      url.pathname.endsWith("/rest/v1/entitlements")
      || url.pathname.endsWith("/rest/v1/notification_preferences")
      || url.pathname.endsWith("/rest/v1/ledgers")
    ) {
      return reply([], 200, { "Content-Range": "0-0/0" });
    }
    if (url.pathname.endsWith("/functions/v1/create-pro-checkout")) {
      return reply({ message: "Checkout unavailable in account fixture" }, 503);
    }

    return reply({ message: `Unhandled account fixture endpoint: ${request.method()} ${url.pathname}` }, 501);
  });

  return { traffic, migrations };
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
