import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function expectNoDialogViolations(page) {
  const { violations } = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(wcagTags)
    .analyze();
  expect(violations).toEqual([]);
}

test("starter packs review estimates, avoid duplicates, and batch-add selected services", async ({ page }) => {
  await openTracker(page);
  await page.getByRole("button", { name: "Starter packs", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Starter packs", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Tech pack", { exact: true })).toBeVisible();
  await expect(dialog.locator('[data-subscription-mark="claude"] svg')).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Include Claude Pro", exact: true })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "iCloud+ is already tracked", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Add selected / 3", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Add selected / 3", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a valid estimated price and next billing date for every selected subscription.");
  await expectNoDialogViolations(page);

  for (const packName of ["Entertainment", "Creative", "Work", "Apple"]) {
    await dialog.getByRole("button", { name: packName, exact: true }).click();
    await expect(dialog.getByText(`${packName} pack`, { exact: true })).toBeVisible();
    await expectNoDialogViolations(page);
  }
  await expect(dialog.getByRole("checkbox", { name: "Include Apple Music", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Tech", exact: true }).click();

  await dialog.getByRole("checkbox", { name: "Include ChatGPT Plus", exact: true }).uncheck();
  await dialog.getByRole("spinbutton", { name: "Claude Pro estimated price", exact: true }).fill("21.50");
  await dialog.getByLabel("Claude Pro next billing date", { exact: true }).fill("2026-08-03");
  await dialog.getByLabel("Google One next billing date", { exact: true }).fill("2026-08-10");

  await dialog.getByRole("button", { name: "Add selected / 2", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("article").filter({ hasText: "Claude Pro" })).toContainText("$21.50");
  await expect(page.getByRole("article").filter({ hasText: "Google One" })).toHaveCount(1);
  await expect(page.getByRole("article").filter({ hasText: "iCloud+" })).toHaveCount(1);
});
