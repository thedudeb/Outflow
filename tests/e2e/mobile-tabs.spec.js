import { expect, test } from "@playwright/test";
import { showTrackerView } from "./helpers";

test("mobile tracker uses focused section views and preserves editor state", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile workspace behavior");

  await page.goto("/#app");

  const navigation = page.getByRole("navigation", { name: "Tracker sections", exact: true });
  const overview = navigation.getByRole("button", { name: "Overview", exact: true });
  const subscriptions = navigation.getByRole("button", { name: "Subscriptions", exact: true });
  const calendar = navigation.getByRole("button", { name: "Calendar", exact: true });

  await expect(navigation).toBeVisible();
  await expect(overview).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Alerts", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active subscriptions", exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Billing calendar", exact: true })).toBeHidden();

  await showTrackerView(page, "Subscriptions");
  await expect(page.getByRole("heading", { name: "Active subscriptions", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alerts", exact: true })).toBeHidden();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Draft stays put");

  await showTrackerView(page, "Calendar");
  await expect(calendar).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Billing calendar", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upcoming 30 days", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active subscriptions", exact: true })).toBeHidden();

  await showTrackerView(page, "Subscriptions");
  await expect(subscriptions).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Draft stays put");

  const geometry = await navigation.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      bottom: Math.round(bounds.bottom),
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(geometry.bottom).toBe(geometry.viewportHeight);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
});

test("desktop tracker keeps the complete workspace visible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop workspace behavior");

  await page.goto("/#app");

  await expect(page.getByRole("navigation", { name: "Tracker sections", exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Alerts", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active subscriptions", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Billing calendar", exact: true })).toBeVisible();
});
