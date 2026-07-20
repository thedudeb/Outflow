import { expect } from "@playwright/test";

export async function showTrackerView(page, name) {
  const navigation = page.getByRole("navigation", { name: "Tracker sections", exact: true });
  if (!await navigation.isVisible()) return;
  const button = navigation.getByRole("button", { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

export async function openTracker(page, view = "Subscriptions") {
  await page.goto("/");
  await page.getByRole("button", { name: "Open tracker", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Outflow", level: 1 })).toBeVisible();
  await showTrackerView(page, view);
  if (view === "Subscriptions") {
    await expect(page.getByRole("heading", { name: "Active subscriptions" })).toBeVisible();
  }
}
