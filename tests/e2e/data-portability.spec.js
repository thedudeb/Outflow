import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

const importFixture = fileURLToPath(new URL("../fixtures/subscriptions-import.csv", import.meta.url));
const canonicalColumns = [
  "name",
  "amount",
  "currency",
  "cycle",
  "nextBillingDate",
  "category",
  "tags",
  "color",
  "trialEndDate",
  "reminderLeadDays",
  "paused",
  "createdBy",
  "updatedBy",
  "updatedAt",
];

test("CSV import previews mapping, validation, duplicates, and persists confirmation", async ({ page }) => {
  await openTracker(page);
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Import subscriptions" });
  await dialog.locator('input[type="file"]').setInputFiles(importFixture);

  await expect(dialog.getByText(/Ready\s+2/)).toBeVisible();
  await expect(dialog.getByText(/Duplicate\s+2/)).toBeVisible();
  await expect(dialog.getByText(/Invalid\s+1/)).toBeVisible();
  await expect(dialog.getByText("Invalid amount", { exact: true })).toBeVisible();

  const nameMapping = dialog.locator("label").filter({ hasText: "Name *" }).locator("select");
  await expect(nameMapping).toHaveValue("Service");
  await nameMapping.selectOption("");
  await expect(dialog.getByText(/Ready\s+0/)).toBeVisible();
  await expect(dialog.getByText(/Invalid\s+5/)).toBeVisible();
  await nameMapping.selectOption("Service");

  const confirm = dialog.getByRole("button", { name: "Import 2 subscriptions", exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("article").filter({ hasText: "Linear" })).toHaveCount(1);
  await expect(page.getByRole("article").filter({ hasText: "Figma" })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("article").filter({ hasText: "Linear" })).toHaveCount(1);
  const figmaCard = page.getByRole("article").filter({ hasText: "Figma" });
  await expect(figmaCard).toHaveCount(1);
  await expect(figmaCard.getByText("Trial ends Tue, Aug 18", { exact: true })).toBeVisible();
});

test("CSV export is canonical, complete, and spreadsheet-formula safe", async ({ page }) => {
  await openTracker(page);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("=RISK(A1)");
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill("1.25");
  await page.getByRole("button", { name: "Add subscription", exact: true }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(download.suggestedFilename()).toMatch(/^outflow-subscriptions-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(downloadPath).not.toBeNull();

  const csv = await readFile(downloadPath, "utf8");
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  expect(parsed.errors).toEqual([]);
  expect(parsed.meta.fields).toEqual(canonicalColumns);
  expect(parsed.data).toHaveLength(6);

  const netflix = parsed.data.find((row) => row.name === "Netflix");
  expect(netflix).toMatchObject({
    amount: "15.49",
    currency: "USD",
    cycle: "monthly",
    category: "Streaming",
    tags: "personal|video",
    paused: "false",
    createdBy: "Local guest",
    updatedBy: "Outflow",
  });
  expect(netflix.nextBillingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(netflix.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  const escapedFormula = parsed.data.find((row) => row.name.includes("RISK"));
  expect(escapedFormula.name).toBe("'=RISK(A1)");
});
