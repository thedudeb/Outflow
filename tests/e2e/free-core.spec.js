import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

const fixedNow = new Date("2026-07-19T12:00:00-03:00");

function panel(page, name) {
  return page.getByRole("heading", { name, exact: true }).locator("xpath=ancestor::section[1]");
}

function monthlyOutflowCard(page) {
  return page.getByText("Monthly outflow", { exact: true }).locator("xpath=ancestor::section[1]");
}

function forecastMetric(forecast, label) {
  return forecast.getByText(label, { exact: true }).locator("..");
}

async function createEmptyHouseholdLedger(page) {
  await page.getByRole("button", { name: "Open Personal ledger controls", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ledger controls" });
  await dialog.getByLabel("New ledger", { exact: true }).fill("Forecast Lab");
  await dialog.locator("form select").selectOption("household");
  await dialog.getByRole("button", { name: "Create local", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("article")).toHaveCount(0);
}

async function addSubscription(page, { name, amount, cycle, date, category }) {
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill(String(amount));
  await page.getByRole("button", { name: cycle, exact: true }).click();
  await page.getByLabel("Next billing date", { exact: true }).fill(date);
  await page.getByRole("textbox", { name: "Category", exact: true }).fill(category);
  await page.getByRole("button", { name: "Add subscription", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(fixedNow);
});

test("free-core subscription CRUD preserves metadata and rolls overdue billing forward", async ({ page }) => {
  await openTracker(page);

  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Gym Membership");
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill("18.50");
  await page.getByRole("combobox", { name: "Currency", exact: true }).selectOption("CAD");
  await page.getByRole("button", { name: "Weekly", exact: true }).click();
  await page.getByLabel("Next billing date", { exact: true }).fill("2026-07-01");
  await page.getByRole("textbox", { name: "Category", exact: true }).fill("Wellness");
  await page.getByRole("textbox", { name: "Tags", exact: true }).fill("health, recurring");
  await page.getByLabel("Trial ends", { exact: true }).fill("2026-07-26");
  await page.getByRole("button", { name: "Add subscription", exact: true }).click();

  let card = page.getByRole("article").filter({ hasText: "Gym Membership" });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("CA$18.50");
  await expect(card).toContainText("Wellness");
  await expect(card).toContainText("health");
  await expect(card).toContainText("recurring");
  await expect(card).toContainText("Wed, Jul 22");
  await expect(card).toContainText("Trial ends Sun, Jul 26");
  await expect(panel(page, "Alerts")).toContainText("Gym Membership");
  await expect(panel(page, "Alerts")).toContainText("Trial ends Sun, Jul 26");

  await page.reload();
  card = page.getByRole("article").filter({ hasText: "Gym Membership" });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Wed, Jul 22");

  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit subscription", exact: true })).toBeVisible();
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill("24");
  await page.getByRole("combobox", { name: "Currency", exact: true }).selectOption("USD");
  await page.getByRole("button", { name: "Yearly", exact: true }).click();
  await page.getByLabel("Next billing date", { exact: true }).fill("2026-08-17");
  await page.getByRole("textbox", { name: "Category", exact: true }).fill("Fitness");
  await page.getByRole("button", { name: "Commit changes", exact: true }).click();

  await expect(card).toContainText("$24.00");
  await expect(card).toContainText("Fitness");
  await expect(card).toContainText("yearly billing");
  await expect(card).toContainText("Mon, Aug 17");

  await card.getByRole("button", { name: "Active", exact: true }).click();
  await expect(card.getByRole("button", { name: "Paused", exact: true })).toBeVisible();
  await expect(card).toContainText("paused schedule");
  await expect(monthlyOutflowCard(page)).toContainText("$39.47");
  await expect(panel(page, "Alerts")).not.toContainText("Gym Membership");

  await card.getByRole("button", { name: "Paused", exact: true }).click();
  await expect(card.getByRole("button", { name: "Active", exact: true })).toBeVisible();
  await expect(monthlyOutflowCard(page)).toContainText("$41.47");
  await expect(panel(page, "Alerts")).toContainText("Gym Membership");

  await card.getByRole("button", { name: "Del", exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(5);
  await page.reload();
  await expect(page.getByText("Gym Membership", { exact: true })).toHaveCount(0);
});

test("weekly, monthly, and yearly schedules produce exact 30, 60, and 90 day forecasts", async ({ page }) => {
  await openTracker(page);
  await createEmptyHouseholdLedger(page);

  await addSubscription(page, {
    name: "Weekly Service",
    amount: 10,
    cycle: "Weekly",
    date: "2026-07-19",
    category: "Operations",
  });
  await addSubscription(page, {
    name: "Monthly Service",
    amount: 30,
    cycle: "Monthly",
    date: "2026-07-19",
    category: "Operations",
  });
  await addSubscription(page, {
    name: "Yearly Service",
    amount: 120,
    cycle: "Yearly",
    date: "2026-07-19",
    category: "Infrastructure",
  });

  const forecast = panel(page, "Cash-out forecast");
  await expect(forecastMetric(forecast, "Scheduled")).toContainText("$200.00");
  await expect(forecastMetric(forecast, "Debits")).toContainText("7");

  await forecast.getByRole("button", { name: "60D", exact: true }).click();
  await expect(forecastMetric(forecast, "Scheduled")).toContainText("$270.00");
  await expect(forecastMetric(forecast, "Debits")).toContainText("12");

  await forecast.getByRole("button", { name: "90D", exact: true }).click();
  await expect(forecastMetric(forecast, "Scheduled")).toContainText("$340.00");
  await expect(forecastMetric(forecast, "Debits")).toContainText("17");

  await page.reload();
  await expect(page.getByRole("button", { name: "Open Forecast Lab ledger controls", exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(forecastMetric(panel(page, "Cash-out forecast"), "Scheduled")).toContainText("$200.00");
});

test("month-end subscriptions clamp to the last valid day instead of skipping a month", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-01-31T12:00:00-04:00"));
  await openTracker(page);
  await createEmptyHouseholdLedger(page);

  await addSubscription(page, {
    name: "Month End Service",
    amount: 31,
    cycle: "Monthly",
    date: "2026-01-31",
    category: "Operations",
  });

  let forecast = panel(page, "Cash-out forecast");
  await expect(forecastMetric(forecast, "Scheduled")).toContainText("$62.00");
  await expect(forecastMetric(forecast, "Debits")).toContainText("2");

  await page.clock.setFixedTime(new Date("2026-02-01T12:00:00-04:00"));
  await page.reload();
  const card = page.getByRole("article").filter({ hasText: "Month End Service" });
  await expect(card).toContainText("Sat, Feb 28");
  forecast = panel(page, "Cash-out forecast");
  await expect(forecastMetric(forecast, "Scheduled")).toContainText("$31.00");
});

test("yearly leap-day subscriptions clamp to February 28 in non-leap years", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2025-02-01T12:00:00-04:00"));
  await openTracker(page);
  await createEmptyHouseholdLedger(page);

  await addSubscription(page, {
    name: "Leap Day Service",
    amount: 29,
    cycle: "Yearly",
    date: "2024-02-29",
    category: "Infrastructure",
  });

  const card = page.getByRole("article").filter({ hasText: "Leap Day Service" });
  await expect(card).toContainText("Fri, Feb 28");
  await page.reload();
  await expect(card).toContainText("Fri, Feb 28");
});
