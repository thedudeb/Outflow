import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openTracker, showTrackerView } from "./helpers";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

const dialogs = [
  {
    name: "account",
    trigger: "Open optional account controls",
    title: "Account / Pro",
    close: "Close account controls",
  },
  {
    name: "starter packs",
    view: "Subscriptions",
    trigger: "Starter packs",
    title: "Starter packs",
    close: "Close starter packs",
  },
  {
    name: "calendar",
    view: "Calendar",
    trigger: "Export calendar",
    title: "Calendar export",
    close: "Close calendar export",
  },
  {
    name: "ledger",
    trigger: "Manage Personal subscriptions",
    title: "Subscription lists",
    close: "Close subscription lists",
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

async function expectPointerTargets(page, scope = "main") {
  const undersized = await page.locator(scope).evaluate((root) => [...root.querySelectorAll("button, input, select, textarea")]
    .flatMap((control) => {
      if (!(control instanceof HTMLElement) || control.matches(":disabled, [type='hidden']") || !control.getClientRects().length) return [];
      const label = control.closest("label");
      const target = label && label.contains(control) ? label : control;
      const bounds = target.getBoundingClientRect();
      if (bounds.width >= 24 && bounds.height >= 24) return [];
      return [{
        height: Math.round(bounds.height * 10) / 10,
        label: control.getAttribute("aria-label") || control.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) || control.getAttribute("name") || control.tagName,
        tagName: control.tagName,
        width: Math.round(bounds.width * 10) / 10,
      }];
    }));

  expect(undersized, JSON.stringify(undersized, null, 2)).toEqual([]);
}

async function applyWcagTextSpacing(page) {
  await page.addStyleTag({
    content: `
      :where(p, li, dd, dt, label, button, a, input, select, textarea, span) {
        letter-spacing: 0.12em !important;
        line-height: 1.5 !important;
        word-spacing: 0.16em !important;
      }
      p { margin-block-end: 2em !important; }
    `,
  });
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

async function expectKeyboardBypass(page, headingName) {
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content", exact: true });
  await expect(skipLink).toBeVisible();
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: headingName, level: 1 })).toBeFocused();
}

test("landing page meets the automated WCAG A and AA gate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Outflow", level: 1 })).toBeVisible();
  await expectNoWcagViolations(page);
  await expectKeyboardBypass(page, "Outflow");
});

test("privacy and data controls meet the automated WCAG A and AA gate", async ({ page }) => {
  await page.goto("/?view=privacy");
  await expect(page.getByRole("heading", { name: "Privacy and data controls", level: 1 })).toBeVisible();
  await expectNoWcagViolations(page);
  await expectKeyboardBypass(page, "Privacy and data controls");
});

test("admin console meets the automated WCAG A and AA gate", async ({ page }) => {
  await page.goto("/?view=admin");
  await expect(page.getByRole("heading", { name: "Admin console", level: 1 })).toBeVisible();
  await expectNoWcagViolations(page);
  await expectKeyboardBypass(page, "Admin console");
});

test("tracker dashboard meets the automated WCAG A and AA gate", async ({ page }) => {
  await page.goto("/#app");
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
  await expectNoWcagViolations(page);
  await expectKeyboardBypass(page, "Outflow");
});

test("primary pointer controls meet the WCAG 2.2 minimum target size", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Outflow", level: 1 })).toBeVisible();
  await expectPointerTargets(page);

  await page.goto("/#app");
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
  await expectPointerTargets(page);

  for (const dialogCase of dialogs) {
    if (dialogCase.view) await showTrackerView(page, dialogCase.view);
    await page.getByRole("button", { name: dialogCase.trigger, exact: true }).click();
    await expect(page.getByRole("dialog", { name: dialogCase.title })).toBeVisible();
    await expectPointerTargets(page, '[role="dialog"]');
    await page.getByRole("button", { name: dialogCase.close, exact: true }).click();
  }
});

test("user text spacing does not clip or horizontally overflow primary workflows", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });

  await page.goto("/");
  await applyWcagTextSpacing(page);
  await expect(page.getByRole("heading", { name: "Outflow", level: 1 })).toBeVisible();
  await expectDocumentToReflow(page);

  await page.goto("/#app");
  await applyWcagTextSpacing(page);
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
  await expectDocumentToReflow(page);

  await page.getByRole("button", { name: "Open optional account controls", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Account / Pro" })).toBeVisible();
  await expectDocumentToReflow(page);
});

for (const dialogCase of dialogs) {
  test(`${dialogCase.name} dialog meets the automated WCAG A and AA gate`, async ({ page }) => {
    await openTracker(page);
    if (dialogCase.view) await showTrackerView(page, dialogCase.view);
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

  await page.goto("/?view=admin");
  await expect(page.getByRole("heading", { name: "Admin console", level: 1 })).toBeVisible();
  await expectDocumentToReflow(page);

  await page.goto("/#app");
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
  await expectDocumentToReflow(page);

  await showTrackerView(page, "Subscriptions");
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
    if (dialogCase.view) await showTrackerView(page, dialogCase.view);
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
