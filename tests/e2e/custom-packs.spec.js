import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function openStarterPacks(page) {
  await page.getByRole("button", { name: "Starter packs", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Starter packs", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function createLocalList(page, name) {
  await page.getByRole("button", { name: "Manage Personal subscriptions", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Subscription lists" });
  await dialog.getByLabel("New list", { exact: true }).fill(name);
  await dialog.locator("form select").selectOption("household");
  await dialog.getByRole("button", { name: "Create local", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function expectNoDialogViolations(page) {
  const { violations } = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(wcagTags)
    .analyze();
  expect(violations).toEqual([]);
}

test("custom packs save, persist, apply to another list, and remain manageable", async ({ page }) => {
  await openTracker(page);
  let dialog = await openStarterPacks(page);
  await dialog.getByRole("button", { name: "Mine", exact: true }).click();
  await expect(dialog.getByText("Mine / 0 packs", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Save current list as pack", exact: true }).click();

  await expect(dialog.getByText("Custom pack builder", { exact: true })).toBeVisible();
  await expect(dialog.getByText("This does not add a starter pack.", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Back to packs", exact: true })).toBeVisible();
  await dialog.getByLabel("Pack name", { exact: true }).fill("Media essentials");
  for (const name of ["iCloud+", "GitHub Copilot", "Notion Plus"]) {
    await dialog.getByRole("checkbox", { name: `Save ${name} in pack`, exact: true }).uncheck();
  }
  await expect(dialog.getByText("2 selected / 50 max", { exact: true })).toBeVisible();
  await expectNoDialogViolations(page);
  await dialog.getByRole("button", { name: "Save pack", exact: true }).click();

  await expect(dialog.getByText("Media essentials pack", { exact: true })).toBeVisible();
  await expect(dialog.getByText("2 saved subscriptions / on this device", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close starter packs", exact: true }).click();

  await page.reload();
  dialog = await openStarterPacks(page);
  await dialog.getByRole("button", { name: "Mine", exact: true }).click();
  await expect(dialog.getByLabel("Saved custom pack", { exact: true })).toHaveValue(/.+/);
  await expect(dialog.getByText("Media essentials pack", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close starter packs", exact: true }).click();

  await createLocalList(page, "Home");
  await expect(page.getByRole("article")).toHaveCount(0);
  dialog = await openStarterPacks(page);
  await dialog.getByRole("button", { name: "Mine", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Add selected / 2", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Add selected / 2", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a valid estimated price and next billing date for every selected subscription.");
  await dialog.getByLabel("Netflix next billing date", { exact: true }).fill("2030-08-03");
  await dialog.getByLabel("Spotify next billing date", { exact: true }).fill("2030-08-10");
  await dialog.getByRole("button", { name: "Add selected / 2", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("article").filter({ hasText: "Netflix" })).toContainText("$15.49");
  await expect(page.getByRole("article").filter({ hasText: "Spotify" })).toContainText("$10.99");

  dialog = await openStarterPacks(page);
  await dialog.getByRole("button", { name: "Mine", exact: true }).click();
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByLabel("Pack name", { exact: true }).fill("Shared streaming");
  await dialog.getByRole("checkbox", { name: "Save Spotify in pack", exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByText("Shared streaming pack", { exact: true })).toBeVisible();
  await expect(dialog.getByText("1 saved subscriptions / on this device", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(dialog.getByText("Shared streaming copy pack", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Saved custom pack", { exact: true }).locator("option")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByText("Shared streaming pack", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Saved custom pack", { exact: true }).locator("option")).toHaveCount(1);
  await expectNoDialogViolations(page);
});
