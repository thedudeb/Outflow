import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

const fixedNow = new Date("2026-07-19T12:00:00-03:00");
const leadDays = [0, 1, 3, 7, 14, 30];

function panel(page, name) {
  return page.getByRole("heading", { name, exact: true }).locator("xpath=ancestor::section[1]");
}

async function installNotificationMock(page, requestResult = "granted") {
  await page.addInitScript((result) => {
    const permissionKey = "outflow:test-notification-permission";
    window.__outflowNotifications = [];

    class MockNotification {
      static get permission() {
        try {
          return localStorage.getItem(permissionKey) || "default";
        } catch {
          return "default";
        }
      }

      static async requestPermission() {
        localStorage.setItem(permissionKey, result);
        return result;
      }

      constructor(title, options) {
        window.__outflowNotifications.push({ title, options });
      }
    }

    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: MockNotification,
    });
  }, requestResult);
}

async function createEmptyHouseholdLedger(page, name = "Notify Lab") {
  await page.getByRole("button", { name: "Open Personal ledger controls", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ledger controls" });
  await dialog.getByLabel("New ledger", { exact: true }).fill(name);
  await dialog.locator("form select").selectOption("household");
  await dialog.getByRole("button", { name: "Create local", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function setReminderLeadDays(page, selectedDays) {
  const group = page.getByRole("group", { name: "Alert lead times" });
  const checkboxes = group.getByRole("checkbox");
  for (let index = 0; index < leadDays.length; index += 1) {
    if (!selectedDays.includes(leadDays[index]) && await checkboxes.nth(index).isChecked()) {
      await checkboxes.nth(index).uncheck();
    }
  }
  for (let index = 0; index < leadDays.length; index += 1) {
    if (selectedDays.includes(leadDays[index]) && !await checkboxes.nth(index).isChecked()) {
      await checkboxes.nth(index).check();
    }
  }
}

async function seedExistingLeadDays(page, name, reminderLeadDays) {
  await page.evaluate(({ subscriptionName, days }) => {
    const workspace = JSON.parse(localStorage.getItem("outflow:workspace"));
    const active = workspace.ledgers.find((entry) => entry.ledger.id === workspace.activeLedgerId);
    const subscription = active.subscriptions.find((entry) => entry.name === subscriptionName);
    subscription.reminderLeadDays = days;
    localStorage.setItem("outflow:workspace", JSON.stringify(workspace));
  }, { subscriptionName: name, days: reminderLeadDays });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Active subscriptions" })).toBeVisible();
}

async function addSubscription(page, {
  name,
  amount,
  date,
  trialDate = "",
  selectedLeadDays = [7],
  paused = false,
}) {
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill(String(amount));
  await page.getByLabel("Next billing date", { exact: true }).fill(date);
  await page.getByRole("textbox", { name: "Category", exact: true }).fill("Operations");
  if (trialDate) await page.getByLabel("Trial ends", { exact: true }).fill(trialDate);
  await setReminderLeadDays(page, selectedLeadDays);
  if (paused) await page.getByLabel("Paused", { exact: true }).check();
  await page.getByRole("button", { name: "Add subscription", exact: true }).click();
}

async function openAlertControls(page, state = "Off") {
  await page.getByRole("button", { name: `Alert rules / ${state}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Alert controls" });
  await expect(dialog).toBeVisible();
  return dialog;
}

function settingsCheckbox(dialog, label) {
  return dialog.locator("label").filter({ hasText: label }).getByRole("checkbox");
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(fixedNow);
});

test("device alerts recover malformed dedupe state, limit content, and deduplicate reloads", async ({ page }) => {
  await installNotificationMock(page);
  await openTracker(page);
  await createEmptyHouseholdLedger(page);
  await addSubscription(page, {
    name: "Renewal Monitor",
    amount: 12.5,
    date: "2026-07-26",
    trialDate: "2026-07-24",
    selectedLeadDays: [3],
  });
  await seedExistingLeadDays(page, "Renewal Monitor", [5, 7]);
  await page.evaluate(() => localStorage.setItem("outflow:notified-alerts", "{broken"));

  const dialog = await openAlertControls(page);
  await settingsCheckbox(dialog, "Device notifications").check();
  await expect(dialog.getByRole("status")).toContainText("Device notifications enabled");
  await expect(dialog.getByText("Permission / granted", { exact: true })).toBeVisible();

  await expect.poll(() => page.evaluate(() => window.__outflowNotifications.length)).toBe(2);
  const notifications = await page.evaluate(() => window.__outflowNotifications);
  expect(notifications).toEqual(expect.arrayContaining([
    {
      title: "Outflow / Renewal Monitor bills 7 days",
      options: {
        body: "$12.50 will leave on Sun, Jul 26 / Notify Lab / household local ledger.",
        tag: expect.stringContaining(":charge-"),
      },
    },
    {
      title: "Outflow / Renewal Monitor trial ends 5 days",
      options: {
        body: "$12.50 expected after the trial ends on Fri, Jul 24 / Notify Lab / household local ledger.",
        tag: expect.stringContaining(":trial-"),
      },
    },
  ]));
  const deliveredIds = await page.evaluate(() => JSON.parse(localStorage.getItem("outflow:notified-alerts")));
  expect(deliveredIds).toHaveLength(2);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Active subscriptions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Alert rules / On", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__outflowNotifications.length)).toBe(0);
});

test("paused alerts require opt-in and global device disablement stops delivery", async ({ page }) => {
  await installNotificationMock(page);
  await openTracker(page);
  await createEmptyHouseholdLedger(page);

  let dialog = await openAlertControls(page);
  await settingsCheckbox(dialog, "Device notifications").check();
  await dialog.getByRole("button", { name: "Close alert controls", exact: true }).click();
  await addSubscription(page, {
    name: "Paused Reminder",
    amount: 8,
    date: "2026-07-26",
    paused: true,
  });
  await expect.poll(() => page.evaluate(() => window.__outflowNotifications.length)).toBe(0);
  await expect(panel(page, "Alerts")).not.toContainText("Paused Reminder");

  dialog = await openAlertControls(page, "On");
  await settingsCheckbox(dialog, "Paused schedule alerts").check();
  await expect.poll(() => page.evaluate(() => window.__outflowNotifications.length)).toBe(1);
  let notifications = await page.evaluate(() => window.__outflowNotifications);
  expect(notifications[0].options.body).toContain("Paused schedule / Notify Lab / household local ledger.");

  await settingsCheckbox(dialog, "Device notifications").uncheck();
  await expect(dialog.getByRole("status")).toContainText("Device notifications disabled");
  await dialog.getByRole("button", { name: "Close alert controls", exact: true }).click();
  await addSubscription(page, {
    name: "Active Reminder",
    amount: 16,
    date: "2026-07-26",
  });
  await expect.poll(() => page.evaluate(() => window.__outflowNotifications.length)).toBe(1);
  await expect(panel(page, "Alerts")).toContainText("Paused Reminder");
  await expect(panel(page, "Alerts")).toContainText("Active Reminder");

  await page.reload();
  await expect(page.getByRole("button", { name: "Alert rules / Off", exact: true })).toBeVisible();
  dialog = await openAlertControls(page);
  await expect(settingsCheckbox(dialog, "Paused schedule alerts")).toBeChecked();
});

test("multiple per-subscription lead times can be reduced to one or disabled", async ({ page }) => {
  await openTracker(page);
  await createEmptyHouseholdLedger(page, "Timing Lab");
  await addSubscription(page, {
    name: "Reminder Matrix",
    amount: 21,
    date: "2026-07-26",
    trialDate: "2026-07-22",
    selectedLeadDays: [3],
  });
  await seedExistingLeadDays(page, "Reminder Matrix", [3, 7]);

  let alerts = panel(page, "Alerts");
  let card = page.getByRole("article").filter({ hasText: "Reminder Matrix" });
  await expect(alerts.getByText("Reminder Matrix", { exact: true })).toHaveCount(2);
  await expect(card).toContainText("Alert 7d / 3d");

  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await setReminderLeadDays(page, [3]);
  await page.getByRole("button", { name: "Commit changes", exact: true }).click();
  alerts = panel(page, "Alerts");
  await expect(alerts.getByText("Reminder Matrix", { exact: true })).toHaveCount(1);
  await expect(alerts.getByText("trial", { exact: true })).toBeVisible();
  await expect(alerts.getByText("charge", { exact: true })).toHaveCount(0);
  await expect(card).toContainText("Alert 3d");

  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await setReminderLeadDays(page, []);
  await page.getByRole("button", { name: "Commit changes", exact: true }).click();
  await expect(alerts).not.toContainText("Reminder Matrix");
  await expect(card).toContainText("Alert off");

  await page.reload();
  card = page.getByRole("article").filter({ hasText: "Reminder Matrix" });
  await expect(card).toContainText("Alert off");
});

test("denied notification permission remains disabled and is announced", async ({ page }) => {
  await installNotificationMock(page, "denied");
  await openTracker(page);
  const dialog = await openAlertControls(page);
  await settingsCheckbox(dialog, "Device notifications").click();

  await expect(dialog.getByRole("alert")).toContainText("permission was not granted");
  await expect(dialog.getByText("Permission / denied", { exact: true })).toBeVisible();
  await expect(settingsCheckbox(dialog, "Device notifications")).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__outflowNotifications.length)).toBe(0);
});
