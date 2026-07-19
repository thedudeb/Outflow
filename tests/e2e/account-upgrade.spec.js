import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

function accessTier(dialog, name) {
  return dialog.getByRole("heading", { name, exact: true }).locator("xpath=ancestor::div[contains(@class, 'p-4')][1]");
}

test("guest upgrade comparison keeps the local free core available", async ({ page }) => {
  await openTracker(page);
  await page.getByRole("button", { name: "Open optional account controls", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Account / Pro" });
  const free = accessTier(dialog, "Free core");
  const pro = accessTier(dialog, "Lifetime Pro");

  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Identity Guest");
  await expect(dialog).toContainText("Cloud Not configured");
  await expect(dialog).toContainText("Entitlement Free");
  await expect(dialog).toContainText("One payment / no renewal");

  await expect(free).toContainText("$0");
  await expect(free.getByRole("listitem")).toHaveCount(5);
  await expect(free).toContainText("Local subscription tracking");
  await expect(free).toContainText("CSV, backup, and calendar downloads");

  await expect(pro).toContainText("Paid once");
  await expect(pro.getByRole("listitem")).toHaveCount(5);
  await expect(pro).toContainText("Cross-device cloud sync");
  await expect(pro).toContainText("Household and team invitations");

  await expect(dialog).toContainText("Cloud service setup pending");
  await expect(dialog).toContainText("This build remains guest-only");
  await expect(dialog.getByRole("button", { name: "Email sign-in link", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Review checkout", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Restore access", exact: true })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Close account controls", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Still Local");
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill("5");
  await page.getByRole("button", { name: "Add subscription", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: "Still Local" })).toHaveCount(1);

  await page.reload();
  await expect(page.getByRole("article").filter({ hasText: "Still Local" })).toHaveCount(1);
});

test("cancelled checkout return stays Free and never implies a recurring charge", async ({ page }) => {
  await page.goto("/#app?pro=cancelled");

  const dialog = page.getByRole("dialog", { name: "Account / Pro" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Pro checkout was cancelled. No product subscription or recurring charge was created.");
  await expect(dialog).toContainText("Entitlement Free");
  await expect(accessTier(dialog, "Lifetime Pro")).toContainText("Paid once");
  await expect(dialog).toContainText("One payment / no renewal");
  await expect(dialog.getByRole("button", { name: "Review checkout", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/#app$/);
});
