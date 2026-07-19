import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

const fixedNow = new Date("2026-07-19T12:00:00-03:00");

function panel(page, name) {
  return page.getByRole("heading", { name, exact: true }).locator("xpath=ancestor::section[1]");
}

function selectedDayPane(calendar) {
  return calendar.getByText("Selected day", { exact: true }).locator("../..");
}

async function createEmptyHouseholdLedger(page, name) {
  await page.getByRole("button", { name: "Open Personal ledger controls", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ledger controls" });
  await dialog.getByLabel("New ledger", { exact: true }).fill(name);
  await dialog.locator("form select").selectOption("household");
  await dialog.getByRole("button", { name: "Create local", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function addSubscription(page, { name, amount, cycle, date, paused = false }) {
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill(String(amount));
  await page.getByRole("button", { name: cycle, exact: true }).click();
  await page.getByLabel("Next billing date", { exact: true }).fill(date);
  await page.getByRole("textbox", { name: "Category", exact: true }).fill("Operations");
  if (paused) await page.getByLabel("Paused", { exact: true }).check();
  await page.getByRole("button", { name: "Add subscription", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(fixedNow);
});

test("calendar navigation, selected days, and the 30-day timeline share one active schedule", async ({ page }) => {
  await openTracker(page);
  await createEmptyHouseholdLedger(page, "Calendar Lab");

  let calendar = panel(page, "Billing calendar");
  let upcoming = panel(page, "Upcoming 30 days");
  await expect(calendar).toContainText("$0.00 / 0");
  await expect(selectedDayPane(calendar)).toContainText("No withdrawals scheduled for this day.");
  await expect(upcoming.getByRole("listitem")).toHaveCount(1);
  await expect(upcoming).toContainText("No active charges inside the next 30 days.");

  await addSubscription(page, {
    name: "Weekly Service",
    amount: 10,
    cycle: "Weekly",
    date: "2026-07-19",
  });
  await addSubscription(page, {
    name: "Monthly Service",
    amount: 30,
    cycle: "Monthly",
    date: "2026-07-31",
  });
  await addSubscription(page, {
    name: "Yearly Service",
    amount: 120,
    cycle: "Yearly",
    date: "2026-08-15",
  });
  await addSubscription(page, {
    name: "Paused Service",
    amount: 99,
    cycle: "Monthly",
    date: "2026-07-20",
    paused: true,
  });

  calendar = panel(page, "Billing calendar");
  upcoming = panel(page, "Upcoming 30 days");
  await expect(calendar).toContainText("July 2026");
  await expect(calendar.locator(":scope > header")).toContainText("$50.00 / 3");

  await calendar.getByRole("button", { name: "Sun, Jul 19, 1 charge totaling $10.00", exact: true }).click();
  await expect(selectedDayPane(calendar)).toContainText("Sun, Jul 19");
  await expect(selectedDayPane(calendar)).toContainText("$10.00 / 1 debit");
  await expect(selectedDayPane(calendar)).toContainText("Weekly Service");

  await calendar.getByRole("button", { name: "Mon, Jul 20, no charges", exact: true }).click();
  await expect(selectedDayPane(calendar)).toContainText("$0.00 / 0 debits");
  await expect(selectedDayPane(calendar)).not.toContainText("Paused Service");

  const timelineItems = upcoming.getByRole("listitem");
  await expect(timelineItems).toHaveCount(7);
  await expect(timelineItems.nth(0)).toContainText("Jul 19");
  await expect(timelineItems.nth(0)).toContainText("Weekly Service");
  await expect(timelineItems.nth(1)).toContainText("Jul 26");
  await expect(timelineItems.nth(2)).toContainText("Jul 31");
  await expect(timelineItems.nth(2)).toContainText("Monthly Service");
  await expect(timelineItems.nth(5)).toContainText("Aug 15");
  await expect(timelineItems.nth(5)).toContainText("Yearly Service");
  await expect(upcoming).not.toContainText("Paused Service");

  await calendar.getByRole("button", { name: "Next", exact: true }).click();
  await expect(calendar).toContainText("August 2026");
  await expect(calendar.locator(":scope > header")).toContainText("$200.00 / 7");
  await calendar.getByRole("button", { name: "Sat, Aug 15, 1 charge totaling $120.00", exact: true }).click();
  await expect(selectedDayPane(calendar)).toContainText("Yearly Service");
  await expect(selectedDayPane(calendar)).toContainText("$120.00 / 1 debit");

  await calendar.getByRole("button", { name: "Today", exact: true }).click();
  await expect(calendar).toContainText("July 2026");
  await expect(selectedDayPane(calendar)).toContainText("Sun, Jul 19");
  await expect(selectedDayPane(calendar)).toContainText("Weekly Service");
});

test("calendar dates provide one tab stop and predictable keyboard navigation", async ({ page }) => {
  await openTracker(page);
  await createEmptyHouseholdLedger(page, "Keyboard Calendar");

  const calendar = panel(page, "Billing calendar");
  const dateGroup = calendar.getByRole("group", { name: "Billing calendar dates", exact: true });
  const july19 = dateGroup.getByRole("button", { name: "Sun, Jul 19, no charges", exact: true });

  await expect(dateGroup.locator('button[tabindex="0"]')).toHaveCount(1);
  await expect(july19).toHaveAttribute("aria-current", "date");
  await expect(july19).toHaveAttribute("aria-pressed", "true");
  await july19.focus();

  await july19.press("ArrowRight");
  const july20 = dateGroup.getByRole("button", { name: "Mon, Jul 20, no charges", exact: true });
  await expect(july20).toBeFocused();
  await expect(july20).toHaveAttribute("aria-pressed", "true");
  await expect(july19).toHaveAttribute("tabindex", "-1");
  await expect(selectedDayPane(calendar)).toContainText("Mon, Jul 20");

  await july20.press("ArrowDown");
  const july27 = dateGroup.getByRole("button", { name: "Mon, Jul 27, no charges", exact: true });
  await expect(july27).toBeFocused();

  await july27.press("Home");
  const july26 = dateGroup.getByRole("button", { name: "Sun, Jul 26, no charges", exact: true });
  await expect(july26).toBeFocused();

  await july26.press("End");
  const august1 = dateGroup.getByRole("button", { name: "Sat, Aug 01, no charges", exact: true });
  await expect(august1).toBeFocused();
  await expect(calendar).toContainText("August 2026");

  await august1.press("PageDown");
  const september1 = dateGroup.getByRole("button", { name: "Tue, Sep 01, no charges", exact: true });
  await expect(september1).toBeFocused();
  await expect(calendar).toContainText("September 2026");

  await september1.press("PageUp");
  await expect(august1).toBeFocused();
  await august1.press("ArrowLeft");
  const july31 = dateGroup.getByRole("button", { name: "Fri, Jul 31, no charges", exact: true });
  await expect(july31).toBeFocused();
  await expect(calendar).toContainText("July 2026");
  await expect(dateGroup.locator('button[tabindex="0"]')).toHaveCount(1);
});

test("month-end recurrences remain visible in the internal calendar and timeline", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-01-31T12:00:00-04:00"));
  await openTracker(page);
  await createEmptyHouseholdLedger(page, "Month End Calendar");
  await addSubscription(page, {
    name: "Month End Service",
    amount: 31,
    cycle: "Monthly",
    date: "2026-01-31",
  });

  const calendar = panel(page, "Billing calendar");
  const upcoming = panel(page, "Upcoming 30 days");
  await expect(calendar).toContainText("January 2026");
  await expect(calendar.locator(":scope > header")).toContainText("$31.00 / 1");
  await expect(upcoming.getByRole("listitem")).toHaveCount(2);
  await expect(upcoming.getByRole("listitem").nth(0)).toContainText("Jan 31");
  await expect(upcoming.getByRole("listitem").nth(1)).toContainText("Feb 28");

  const january31 = calendar.getByRole("button", { name: "Sat, Jan 31, 1 charge totaling $31.00", exact: true });
  await january31.focus();
  await january31.press("PageDown");
  await expect(calendar).toContainText("February 2026");
  await expect(calendar.locator(":scope > header")).toContainText("$31.00 / 1");
  const february28 = calendar.getByRole("button", { name: "Sat, Feb 28, 1 charge totaling $31.00", exact: true });
  await expect(february28).toBeFocused();
  await expect(selectedDayPane(calendar)).toContainText("Month End Service");

  await calendar.getByRole("button", { name: "Next", exact: true }).click();
  await expect(calendar).toContainText("March 2026");
  await expect(calendar.locator(":scope > header")).toContainText("$31.00 / 1");
  await calendar.getByRole("button", { name: "Tue, Mar 31, 1 charge totaling $31.00", exact: true }).click();
  await expect(selectedDayPane(calendar)).toContainText("Month End Service");
});
