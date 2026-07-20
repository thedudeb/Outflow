import { expect, test } from "@playwright/test";
import { openTracker, showTrackerView } from "./helpers";

async function expectPanelAndBackdropBehavior(page, openButton, dialogName) {
  await openButton.click();
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();

  await dialog.click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeVisible();

  await dialog.locator("xpath=..").click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
}

test("every guest dialog closes from its backdrop but not from its panel", async ({ page }) => {
  await openTracker(page);

  await expectPanelAndBackdropBehavior(
    page,
    page.getByRole("button", { name: "Open optional account controls", exact: true }),
    "Account / Pro",
  );
  await expectPanelAndBackdropBehavior(
    page,
    page.getByRole("button", { name: "Manage Personal subscriptions", exact: true }),
    "Subscription lists",
  );
  await expectPanelAndBackdropBehavior(
    page,
    page.getByRole("button", { name: "Alert rules / Off", exact: true }),
    "Alert controls",
  );
  await showTrackerView(page, "Calendar");
  await expectPanelAndBackdropBehavior(
    page,
    page.getByRole("button", { name: "Export calendar", exact: true }),
    "Calendar export",
  );
});
