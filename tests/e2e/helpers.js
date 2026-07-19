import { expect } from "@playwright/test";

export async function openTracker(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open tracker", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Active subscriptions" })).toBeVisible();
}
