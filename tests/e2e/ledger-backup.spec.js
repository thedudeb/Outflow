import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

const timestamp = "2026-07-19T12:00:00.000Z";

function backupSubscription(overrides = {}) {
  return {
    id: "backup-linear",
    name: "Linear",
    amount: 8,
    currency: "USD",
    cycle: "monthly",
    nextBillingDate: "2030-08-10",
    category: "Dev Tools",
    tags: ["work", "development"],
    color: "#22d3ee",
    trialEndDate: "",
    reminderLeadDays: [45, 1],
    paused: false,
    revision: 2,
    updatedAt: timestamp,
    createdBy: "Backup owner",
    updatedBy: "Backup editor",
    ...overrides,
  };
}

function backupEnvelope(overrides = {}) {
  return {
    product: "Outflow",
    schemaVersion: 1,
    exportedAt: timestamp,
    ledger: {
      id: "backup-ledger",
      name: "Backup ledger",
      kind: "household",
      storage: "cloud",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    alertSettings: {
      deviceEnabled: true,
      includePausedSchedules: false,
    },
    subscriptions: [],
    ...overrides,
  };
}

function backupCustomPack(overrides = {}) {
  return {
    id: "backup-pack",
    name: "Backup stack",
    createdAt: timestamp,
    updatedAt: timestamp,
    items: [{
      id: "backup-pack-linear",
      catalogId: "",
      name: "Linear",
      amount: 8,
      currency: "USD",
      cycle: "monthly",
      category: "Dev Tools",
      tags: ["work", "development"],
      color: "#22d3ee",
    }],
    ...overrides,
  };
}

async function openLedgerControls(page, ledgerName = "Personal") {
  await page.getByRole("button", { name: `Manage ${ledgerName} subscriptions`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Subscription lists" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function downloadBackup(page, dialog, expectedSlug) {
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export full list", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(download.suggestedFilename()).toMatch(new RegExp(`^outflow-${expectedSlug}-backup-\\d{4}-\\d{2}-\\d{2}\\.json$`));
  expect(downloadPath).not.toBeNull();
  return JSON.parse(await readFile(downloadPath, "utf8"));
}

async function uploadBackup(dialog, value, name = "outflow-test-backup.json") {
  await dialog.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
}

test("full-ledger backup exports the complete versioned active ledger envelope", async ({ page }) => {
  await openTracker(page);
  const dialog = await openLedgerControls(page);
  const backup = await downloadBackup(page, dialog, "personal");

  expect(backup).toMatchObject({
    product: "Outflow",
    schemaVersion: 1,
    ledger: {
      name: "Personal",
      kind: "personal",
      storage: "local",
    },
    alertSettings: {
      deviceEnabled: false,
      includePausedSchedules: false,
    },
  });
  expect(backup.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(backup.subscriptions).toHaveLength(5);
  expect(backup.customPacks).toEqual([]);
  expect(new Set(backup.subscriptions.map((subscription) => subscription.id)).size).toBe(5);
  expect(backup.subscriptions.find((subscription) => subscription.name === "Netflix")).toMatchObject({
    amount: 15.49,
    currency: "USD",
    cycle: "monthly",
    category: "Streaming",
    tags: ["personal", "video"],
    reminderLeadDays: [7],
    paused: false,
  });
  expect(backup).not.toHaveProperty("notificationPermission");
  expect(backup).not.toHaveProperty("notifiedAlerts");
});

test("custom packs merge from backups, persist, and export with portable settings only", async ({ page }) => {
  await openTracker(page);
  let dialog = await openLedgerControls(page);
  await uploadBackup(dialog, backupEnvelope({ customPacks: [backupCustomPack()] }), "packs-backup.json");

  await expect(dialog.getByText("Custom packs 1 / 1 new / 0 existing", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Merge 1", exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Starter packs", exact: true }).click();
  let packsDialog = page.getByRole("dialog", { name: "Starter packs", exact: true });
  await packsDialog.getByRole("button", { name: "Mine", exact: true }).click();
  await expect(packsDialog.getByText("Backup stack pack", { exact: true })).toBeVisible();
  await expect(packsDialog.getByLabel("Linear next billing date", { exact: true })).toHaveValue("");
  await packsDialog.getByRole("button", { name: "Close starter packs", exact: true }).click();

  await page.reload();
  dialog = await openLedgerControls(page);
  const exported = await downloadBackup(page, dialog, "personal");
  expect(exported.customPacks).toHaveLength(1);
  expect(exported.customPacks[0]).toMatchObject({
    id: "backup-pack",
    name: "Backup stack",
    items: [{
      name: "Linear",
      amount: 8,
      currency: "USD",
      cycle: "monthly",
    }],
  });
  expect(exported.customPacks[0].items[0]).not.toHaveProperty("nextBillingDate");
  expect(exported.customPacks[0].items[0]).not.toHaveProperty("reminderLeadDays");
  expect(exported.customPacks[0].items[0]).not.toHaveProperty("paused");
});

test("backup merge skips ID and content duplicates while preserving active settings", async ({ page }) => {
  await openTracker(page);
  await page.getByRole("button", { name: "Alert rules / Off", exact: true }).click();
  const alertDialog = page.getByRole("dialog", { name: "Alert controls" });
  await alertDialog.getByRole("checkbox", { name: /Paused schedule alerts/ }).check();
  await alertDialog.getByRole("button", { name: "Close alert controls", exact: true }).click();

  const dialog = await openLedgerControls(page);
  const backup = backupEnvelope({
    alertSettings: { deviceEnabled: false, includePausedSchedules: false },
    subscriptions: [
      backupSubscription({ id: "netflix", name: "Changed Netflix", amount: 20 }),
      backupSubscription({ id: "backup-netflix-copy", name: "Netflix", amount: 15.49, reminderLeadDays: [30] }),
      backupSubscription(),
    ],
  });
  await uploadBackup(dialog, backup, "merge-backup.json");

  await expect(dialog.getByText(/Records\s+3/)).toBeVisible();
  await expect(dialog.getByText(/New\s+1/)).toBeVisible();
  await expect(dialog.getByText(/Existing\s+2/)).toBeVisible();
  await dialog.getByRole("button", { name: "Merge 1", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("article").filter({ hasText: "Linear" })).toContainText("Alert 45d / 1d");
  await expect(page.getByRole("article")).toHaveCount(6);

  await page.getByRole("button", { name: "Alert rules / Off", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Alert controls" }).getByRole("checkbox", { name: /Paused schedule alerts/ })).toBeChecked();
  await page.reload();
  await expect(page.getByRole("article").filter({ hasText: "Linear" })).toContainText("Alert 45d / 1d");
});

test("backup replacement restores data and settings without replacing the local slot or permission", async ({ page, context }) => {
  await context.clearPermissions();
  await openTracker(page);
  await page.getByRole("button", { name: "Starter packs", exact: true }).click();
  let packsDialog = page.getByRole("dialog", { name: "Starter packs", exact: true });
  await packsDialog.getByRole("button", { name: "Mine", exact: true }).click();
  await packsDialog.getByRole("button", { name: "Save current list as pack", exact: true }).click();
  await packsDialog.getByLabel("Pack name", { exact: true }).fill("Keep on legacy restore");
  await packsDialog.getByRole("button", { name: "Save pack", exact: true }).click();
  await packsDialog.getByRole("button", { name: "Close starter packs", exact: true }).click();

  let dialog = await openLedgerControls(page);
  const before = await downloadBackup(page, dialog, "personal");

  const replacement = backupEnvelope({
    ledger: {
      id: "foreign-team-ledger",
      name: "Restored Home",
      kind: "team",
      storage: "cloud",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    alertSettings: { deviceEnabled: true, includePausedSchedules: true },
    subscriptions: [backupSubscription({ id: "restored-only", name: "Restored Service", amount: 42, currency: "CAD" })],
  });
  await uploadBackup(dialog, replacement, "replacement-backup.json");
  await expect(dialog.getByText(/Records\s+1/)).toBeVisible();
  await dialog.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article").filter({ hasText: "Restored Service" })).toHaveCount(1);
  dialog = await openLedgerControls(page, "Restored Home");
  const restored = await downloadBackup(page, dialog, "restored-home");
  expect(restored.ledger).toMatchObject({
    id: before.ledger.id,
    name: "Restored Home",
    kind: "personal",
    storage: "local",
  });
  expect(restored.alertSettings).toEqual({
    deviceEnabled: false,
    includePausedSchedules: true,
  });
  expect(restored.subscriptions).toHaveLength(1);
  expect(restored.subscriptions[0]).toMatchObject({
    id: "restored-only",
    name: "Restored Service",
    amount: 42,
    currency: "CAD",
    reminderLeadDays: [45, 1],
  });

  await page.reload();
  await expect(page.getByRole("article").filter({ hasText: "Restored Service" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Manage Restored Home subscriptions", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Starter packs", exact: true }).click();
  packsDialog = page.getByRole("dialog", { name: "Starter packs", exact: true });
  await packsDialog.getByRole("button", { name: "Mine", exact: true }).click();
  await expect(packsDialog.getByText("Keep on legacy restore pack", { exact: true })).toBeVisible();
});

test("invalid and unsupported backups are rejected without changing the ledger", async ({ page }) => {
  await openTracker(page);
  const dialog = await openLedgerControls(page);
  const duplicate = backupSubscription({ id: "duplicate-id" });
  await uploadBackup(dialog, backupEnvelope({ subscriptions: [duplicate, { ...duplicate }] }), "duplicate-ids.json");

  const input = dialog.locator('input[type="file"]');
  const error = dialog.getByRole("alert");
  await expect(error).toHaveText("Backup subscription identifiers must be unique.");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAttribute("aria-describedby", "backup-error");

  await uploadBackup(dialog, backupEnvelope({ schemaVersion: 99 }), "unsupported-version.json");
  await expect(error).toHaveText("This backup version is not supported.");

  await uploadBackup(dialog, backupEnvelope({ subscriptions: [backupSubscription({
    nextBillingDate: "2030-08-10",
    trialEndDate: "2030-08-11",
  })] }), "invalid-trial-order.json");
  await expect(error).toHaveText("A backup first paid charge cannot precede its trial end date.");

  const duplicateItem = backupCustomPack().items[0];
  await uploadBackup(dialog, backupEnvelope({
    customPacks: [backupCustomPack({ items: [duplicateItem, { ...duplicateItem }] })],
  }), "duplicate-pack-item-ids.json");
  await expect(error).toHaveText("One or more backup custom packs are invalid.");
  await expect(dialog.getByRole("button", { name: "Replace all", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close subscription lists", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(5);
});
