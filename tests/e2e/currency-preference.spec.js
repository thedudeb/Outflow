import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

test("preferred currency is free, local, persistent, and never rewrites existing records", async ({ page }) => {
  await openTracker(page);

  const startupHeading = page.getByRole("heading", { name: "Choose your preferred currency", exact: true });
  const startupCurrency = page.getByRole("combobox", { name: "Startup preferred currency", exact: true });
  await expect(startupHeading).toBeVisible();
  await startupCurrency.selectOption("CAD");
  await expect(page.getByRole("button", { name: "Use CAD", exact: true })).toBeVisible();

  const { violations } = await new AxeBuilder({ page })
    .withTags(wcagTags)
    .analyze();
  expect(violations).toEqual([]);

  await page.getByRole("button", { name: "Use CAD", exact: true }).click();
  await expect(startupHeading).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Preferred currency", exact: true })).toHaveValue("CAD");

  const entryCurrency = page.getByRole("combobox", { name: "Currency", exact: true });
  await expect(entryCurrency).toHaveValue("CAD");
  await expect(entryCurrency.locator('option[value="EUR"]')).toBeEnabled();
  await page.getByRole("combobox", { name: "Name", exact: true }).fill("Local Test");
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill("12.50");
  await page.getByRole("button", { name: "Add subscription", exact: true }).click();

  await expect(page.getByRole("article").filter({ hasText: "Local Test" })).toContainText("CA$12.50");
  await expect(page.getByRole("article").filter({ hasText: "Netflix" })).toContainText("$15.49");
  await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toHaveValue("CAD");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("outflow:preferred-currency"))).toBe("CAD");

  await page.reload();
  await expect(startupHeading).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Preferred currency", exact: true })).toHaveValue("CAD");
  await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toHaveValue("CAD");

  await page.getByRole("combobox", { name: "Preferred currency", exact: true }).selectOption("GBP");
  await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toHaveValue("GBP");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Preferred currency", exact: true })).toHaveValue("GBP");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("outflow:preferred-currency"))).toBe("GBP");
});

test("the startup currency question can be deferred without blocking local use", async ({ page }) => {
  await openTracker(page);
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose your preferred currency", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Add subscription", exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("outflow:preferred-currency"))).toBe(null);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Choose your preferred currency", exact: true })).toBeVisible();
});
