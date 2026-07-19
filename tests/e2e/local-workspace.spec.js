import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

function monthlyOutflowCard(page) {
  return page.getByText("Monthly outflow", { exact: true }).locator("..").locator("..");
}

async function openLedgerControls(page, ledgerName) {
  await page.getByRole("button", { name: `Open ${ledgerName} ledger controls`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ledger controls" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function createLedger(dialog, name, kind) {
  await dialog.getByLabel("New ledger", { exact: true }).fill(name);
  await dialog.locator("form select").selectOption(kind);
  await dialog.getByRole("button", { name: "Create local", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function addSubscription(page, { name, amount, currency = "USD", category }) {
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill(String(amount));
  await page.getByRole("combobox", { name: "Currency", exact: true }).selectOption(currency);
  await page.getByRole("textbox", { name: "Category", exact: true }).fill(category);
  await page.getByRole("button", { name: "Add subscription", exact: true }).click();
}

test("household ledgers isolate totals, records, attribution, and active state", async ({ page }) => {
  await openTracker(page);
  await expect(monthlyOutflowCard(page)).toContainText("$39.47");
  await expect(page.getByRole("article")).toHaveCount(5);

  let dialog = await openLedgerControls(page, "Personal");
  await createLedger(dialog, "Home", "household");
  await expect(page.getByRole("button", { name: "Open Home ledger controls", exact: true })).toBeVisible();
  await expect(monthlyOutflowCard(page)).toContainText("$0.00");
  await expect(page.getByRole("article")).toHaveCount(0);

  await addSubscription(page, {
    name: "Utilities Bundle",
    amount: 120,
    category: "Household",
  });
  await expect(monthlyOutflowCard(page)).toContainText("$120.00");
  const sharedCard = page.getByRole("article").filter({ hasText: "Utilities Bundle" });
  await expect(sharedCard).toHaveCount(1);
  await expect(sharedCard.getByText(/Updated by Local guest/)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Open Home ledger controls", exact: true })).toBeVisible();
  await expect(sharedCard).toHaveCount(1);
  await expect(monthlyOutflowCard(page)).toContainText("$120.00");

  dialog = await openLedgerControls(page, "Home");
  await expect(dialog.getByRole("button", { name: /Personal.*5 records.*local only/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Home.*1 records.*local only/ })).toBeVisible();
  await dialog.getByRole("button", { name: /Personal.*5 records.*local only/ }).click();

  await expect(page.getByRole("button", { name: "Open Personal ledger controls", exact: true })).toBeVisible();
  await expect(monthlyOutflowCard(page)).toContainText("$39.47");
  await expect(page.getByRole("article")).toHaveCount(5);
  await expect(page.getByText("Utilities Bundle", { exact: true })).toHaveCount(0);

  dialog = await openLedgerControls(page, "Personal");
  await dialog.getByRole("button", { name: /Home.*1 records.*local only/ }).click();
  await expect(monthlyOutflowCard(page)).toContainText("$120.00");
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("team deletion is confirmed while the personal ledger remains protected", async ({ page }) => {
  await openTracker(page);
  let dialog = await openLedgerControls(page, "Personal");
  await createLedger(dialog, "Studio", "team");
  await addSubscription(page, {
    name: "Team SaaS",
    amount: 25,
    category: "Operations",
  });

  dialog = await openLedgerControls(page, "Studio");
  await expect(dialog.getByRole("button", { name: /Studio.*Team.*1 records.*local only/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toHaveCount(1);
  await dialog.getByRole("button", { name: /Personal.*5 records.*local only/ }).click();

  dialog = await openLedgerControls(page, "Personal");
  const studioSwitch = dialog.getByRole("button", { name: /Studio.*Team.*1 records.*local only/ });
  const studioRow = studioSwitch.locator("..");
  await studioRow.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(studioRow.getByRole("button", { name: "Confirm 1", exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await studioRow.getByRole("button", { name: "Confirm 1", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("button", { name: "Open Personal ledger controls", exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(5);
  await expect(page.getByText("Team SaaS", { exact: true })).toHaveCount(0);
  dialog = await openLedgerControls(page, "Personal");
  await expect(dialog.getByRole("button", { name: /Studio/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "Open Personal ledger controls", exact: true })).toBeVisible();
  await expect(monthlyOutflowCard(page)).toContainText("$39.47");
});
