import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

const dialogs = [
  {
    name: "account",
    trigger: "Open optional account controls",
    title: "Account / Pro",
    close: "Close account controls",
  },
  {
    name: "calendar",
    trigger: "Export calendar",
    title: "Calendar export",
    close: "Close calendar export",
  },
  {
    name: "ledger",
    trigger: "Open Personal ledger controls",
    title: "Ledger controls",
    close: "Close ledger controls",
  },
  {
    name: "alerts",
    trigger: "Alert rules / Off",
    title: "Alert controls",
    close: "Close alert controls",
  },
  {
    name: "CSV import",
    trigger: "Import CSV",
    title: "Import subscriptions",
    close: "Close import",
  },
];

function violationSummary(violations) {
  return violations
    .map((violation) => {
      const targets = violation.nodes.flatMap((node) => node.target).join(", ");
      return `${violation.id} (${violation.impact || "unknown"}): ${violation.help}\n${targets}`;
    })
    .join("\n\n");
}

async function expectNoWcagViolations(page, scope = null) {
  let scan = new AxeBuilder({ page }).withTags(wcagTags);
  if (scope) scan = scan.include(scope);
  const { violations } = await scan.analyze();
  expect(violations.length, violationSummary(violations)).toBe(0);
}

test("landing page meets the automated WCAG A and AA gate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Outflow", level: 1 })).toBeVisible();
  await expectNoWcagViolations(page);
});

test("tracker dashboard meets the automated WCAG A and AA gate", async ({ page }) => {
  await openTracker(page);
  await expectNoWcagViolations(page);
});

for (const dialogCase of dialogs) {
  test(`${dialogCase.name} dialog meets the automated WCAG A and AA gate`, async ({ page }) => {
    await openTracker(page);
    await page.getByRole("button", { name: dialogCase.trigger, exact: true }).click();

    const dialog = page.getByRole("dialog", { name: dialogCase.title });
    await expect(dialog).toBeVisible();
    await expectNoWcagViolations(page, '[role="dialog"]');

    await page.getByRole("button", { name: dialogCase.close, exact: true }).click();
    await expect(dialog).toBeHidden();
  });
}
