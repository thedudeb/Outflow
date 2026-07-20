import { expect, test } from "@playwright/test";
import { webContentSecurityPolicy } from "../../vite.config.js";

const deploymentUrl = new URL(process.env.OUTFLOW_DEPLOYMENT_URL || "https://thedudeb.github.io/Outflow/");
const trackerUrl = new URL("#app", deploymentUrl);
const privacyUrl = new URL("?view=privacy", deploymentUrl);
const manifestUrl = new URL("manifest.webmanifest", deploymentUrl);
const workerUrl = new URL("sw.js", deploymentUrl);

function collectBrowserFailures(page) {
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  return failures;
}

async function layoutState(page) {
  return page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
}

test("the published landing page and install assets use one repository-path scope", async ({ page, request }) => {
  const failures = collectBrowserFailures(page);
  await page.goto(deploymentUrl.href, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Outflow", exact: true })).toBeVisible();
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", webContentSecurityPolicy());
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  const landingLayout = await layoutState(page);
  expect(landingLayout.documentWidth).toBeLessThanOrEqual(landingLayout.viewportWidth);

  const manifestResponse = await request.get(manifestUrl.href);
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = await manifestResponse.json();
  expect(new URL(manifest.id, manifestUrl).href).toBe(trackerUrl.href);
  expect(new URL(manifest.start_url, manifestUrl).href).toBe(trackerUrl.href);
  expect(new URL(manifest.scope, manifestUrl).href).toBe(deploymentUrl.href);

  const workerResponse = await request.get(workerUrl.href);
  expect(workerResponse.status()).toBe(200);
  expect(workerResponse.headers()["content-type"]).toContain("application/javascript");
  const workerSource = await workerResponse.text();
  expect(workerSource).toContain(`const INDEX_URL = ${JSON.stringify(`${deploymentUrl.pathname}index.html`)}`);
  expect(workerSource).toContain(JSON.stringify(`${deploymentUrl.pathname}manifest.webmanifest`));
  expect(failures).toEqual([]);
});

test("the published privacy policy is direct, responsive, and matches the guest release", async ({ page }) => {
  const failures = collectBrowserFailures(page);
  await page.goto(privacyUrl.href, { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle("Privacy and data controls | Outflow");
  await expect(page.getByRole("heading", { name: "Privacy and data controls", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Current release status" })).toContainText("Guest-only");
  await expect(page.getByText("No bank connections", { exact: true })).toBeVisible();
  await expect(page.getByText("No ads or tracking", { exact: true })).toBeVisible();
  await expect(page.getByText("No sale of personal data", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Outflow repository", exact: true })).toHaveAttribute("href", "https://github.com/thedudeb/Outflow/issues");

  const layout = await layoutState(page);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(failures).toEqual([]);
});

test("the published guest tracker identifies its boundary and persists a local edit", async ({ page }) => {
  const failures = collectBrowserFailures(page);
  await page.goto(trackerUrl.href, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Active subscriptions", exact: true })).toBeVisible();
  const ledgerControl = page.getByRole("button", { name: "Open Personal ledger controls", exact: true });
    await expect(ledgerControl).toContainText("Personal");
    await expect(ledgerControl).toContainText("Personal / Local");
  await expect(page.getByRole("button", { name: "Open optional account controls", exact: true })).toContainText("Account / Guest");
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 15_000 });

  const workerScope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(workerScope).toBe(deploymentUrl.href);
  const trackerLayout = await layoutState(page);
  expect(trackerLayout.documentWidth).toBeLessThanOrEqual(trackerLayout.viewportWidth);

  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Hosted Local Check");
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill("12.34");
  await page.getByRole("button", { name: "Add subscription", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: "Hosted Local Check" })).toHaveCount(1);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("article").filter({ hasText: "Hosted Local Check" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Open optional account controls", exact: true })).toContainText("Account / Guest");
  expect(failures).toEqual([]);
});
