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

async function expectDocumentToReflow(page) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    offenders: Array.from(document.body.querySelectorAll("*")).flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      if (bounds.left >= -1 && bounds.right <= document.documentElement.clientWidth + 1) return [];
      return [{
        className: typeof element.className === "string" ? element.className.slice(0, 160) : "",
        left: Math.round(bounds.left),
        right: Math.round(bounds.right),
        tagName: element.tagName,
        text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
      }];
    }).slice(0, 8),
    viewportWidth: document.documentElement.clientWidth,
  }));

  expect(dimensions.documentWidth, JSON.stringify(dimensions, null, 2)).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

async function expectDialogInsideViewport(page, dialog) {
  const geometry = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const labelledBy = element.getAttribute("aria-labelledby");
    return {
      bottom: bounds.bottom,
      left: bounds.left,
      name: labelledBy ? document.getElementById(labelledBy)?.textContent?.trim() : element.getAttribute("aria-label"),
      right: bounds.right,
      top: bounds.top,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

  const details = JSON.stringify(geometry, null, 2);
  expect(geometry.left, details).toBeGreaterThanOrEqual(0);
  expect(geometry.top, details).toBeGreaterThanOrEqual(0);
  expect(geometry.right, details).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.bottom, details).toBeLessThanOrEqual(geometry.viewportHeight + 1);
}

test("landing page meets the automated WCAG A and AA gate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Outflow", level: 1 })).toBeVisible();
  await expectNoWcagViolations(page);
});

test("privacy and data controls meet the automated WCAG A and AA gate", async ({ page }) => {
  await page.goto("/?view=privacy");
  await expect(page.getByRole("heading", { name: "Privacy and data controls", level: 1 })).toBeVisible();
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

test("landing page and tracker reflow without document overflow at 320 CSS pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Outflow", level: 1 })).toBeVisible();
  await expectDocumentToReflow(page);

  await page.goto("/?view=privacy");
  await expect(page.getByRole("heading", { name: "Privacy and data controls", level: 1 })).toBeVisible();
  await expectDocumentToReflow(page);

  await page.getByRole("button", { name: "Open tracker", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Active subscriptions" })).toBeVisible();
  await expectDocumentToReflow(page);

  const dateGeometry = await page.getByLabel("Next billing date", { exact: true }).evaluate((element) => ({
    fieldWidth: element.getBoundingClientRect().width,
    labelWidth: element.parentElement?.getBoundingClientRect().width || 0,
  }));
  expect(dateGeometry.fieldWidth, JSON.stringify(dateGeometry)).toBeGreaterThanOrEqual(dateGeometry.labelWidth - 1);
});

test("core dialogs remain contained and reflow at 320 CSS pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openTracker(page);

  for (const dialogCase of dialogs) {
    await page.getByRole("button", { name: dialogCase.trigger, exact: true }).click();

    const dialog = page.getByRole("dialog", { name: dialogCase.title });
    await expect(dialog).toBeVisible();
    await expectDialogInsideViewport(page, dialog);
    await expectDocumentToReflow(page);

    await page.getByRole("button", { name: dialogCase.close, exact: true }).click();
    await expect(dialog).toBeHidden();
  }
});

test("keyboard focus stays visible when forced colors are active", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Outflow", level: 1 })).toBeVisible();
  await page.keyboard.press("Tab");

  const focusIndicator = await page.evaluate(() => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return null;
    const style = window.getComputedStyle(activeElement);
    return {
      forcedColorsActive: window.matchMedia("(forced-colors: active)").matches,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      tagName: activeElement.tagName,
    };
  });

  expect(focusIndicator).not.toBeNull();
  expect(focusIndicator.forcedColorsActive).toBe(true);
  expect(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]).toContain(focusIndicator.tagName);
  expect(focusIndicator.outlineStyle).not.toBe("none");
  expect(focusIndicator.outlineWidth).toBeGreaterThanOrEqual(2);
});
