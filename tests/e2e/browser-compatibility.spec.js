import { expect, test } from "@playwright/test";

function collectBrowserFailures(page) {
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  return failures;
}

async function expectNoHorizontalOverflow(page) {
  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
}

test("public guest surfaces render without browser errors or horizontal overflow", async ({ page }) => {
  const failures = collectBrowserFailures(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Outflow", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/?view=privacy");
  await expect(page.getByRole("heading", { name: "Privacy and data controls", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Current release status" })).toContainText("Guest-only");
  await expectNoHorizontalOverflow(page);

  await page.goto("/#app");
  await expect(page.getByRole("heading", { name: "Active subscriptions", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage Personal subscriptions", exact: true })).toContainText("Personal / On this device");
  await expect(page.getByRole("button", { name: "Open optional account controls", exact: true })).toContainText("Account / Guest");
  await expectNoHorizontalOverflow(page);

  expect(failures).toEqual([]);
});
