import { readFile } from "node:fs/promises";
import Papa from "papaparse";
import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

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
