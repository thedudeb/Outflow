import { expect, test } from "@playwright/test";
import { webContentSecurityPolicy } from "../../vite.config.js";

const publicBase = process.env.OUTFLOW_PWA_BASE || "/";
const publicPath = (path = "") => `${publicBase}${path}`;

async function waitForOfflineControl(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
    if (registration.active && registration.active.state !== "activated") {
      await new Promise((resolve) => {
        const handleStateChange = () => {
          if (registration.active?.state !== "activated") return;
          registration.active.removeEventListener("statechange", handleStateChange);
          resolve();
        };
        registration.active.addEventListener("statechange", handleStateChange);
        handleStateChange();
      });
    }
    return {
      active: registration.active?.state || "",
      scope: registration.scope,
    };
  });
}

async function addSubscription(page, name, amount) {
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill(String(amount));
  await page.getByRole("button", { name: "Add subscription", exact: true }).click();
}

async function expectDownload(page, action, filename) {
  const downloadPromise = page.waitForEvent("download");
  await action();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(filename);
  expect(await download.path()).not.toBeNull();
}

test("production metadata and the generated cache satisfy the installable-web contract", async ({ page }) => {
  await page.goto(`${publicBase}#app`);
  await expect(page.getByRole("heading", { name: "Active subscriptions" })).toBeVisible();
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", webContentSecurityPolicy());
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  const worker = await waitForOfflineControl(page);
  expect(worker).toEqual({ active: "activated", scope: new URL(publicBase, page.url()).href });
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible();

  const manifest = await page.evaluate(async (manifestPath) => (await fetch(manifestPath)).json(), publicPath("manifest.webmanifest"));
  expect(manifest).toMatchObject({
    name: "Outflow Subscription Tracker",
    short_name: "Outflow",
    id: "./#app",
    start_url: "./#app",
    scope: "./",
    display: "standalone",
    background_color: "#08090a",
    theme_color: "#08090a",
  });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "./outflow-icon-192.png", sizes: "192x192", type: "image/png" }),
    expect.objectContaining({ src: "./outflow-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }),
  ]));

  const cacheState = await page.evaluate(async ({ publicBase }) => {
    const names = (await caches.keys()).filter((name) => name.startsWith("outflow-"));
    const requests = names.length === 1 ? await caches.open(names[0]).then((cache) => cache.keys()) : [];
    const workerSource = await fetch(`${publicBase}sw.js`).then((response) => response.text());
    const precacheMatch = workerSource.match(/const PRECACHE = (\[[^;]+\]);/);
    return {
      names,
      precache: precacheMatch ? JSON.parse(precacheMatch[1]) : [],
      urls: requests.map((request) => new URL(request.url).pathname),
    };
  }, { publicBase });
  expect(cacheState.names).toHaveLength(1);
  expect(cacheState.names[0]).toMatch(/^outflow-[a-f0-9]{12}$/);
  expect(cacheState.urls).toEqual(expect.arrayContaining([
    publicBase,
    publicPath("index.html"),
    publicPath("manifest.webmanifest"),
    publicPath("outflow-icon-192.png"),
    publicPath("outflow-icon-512.png"),
  ]));
  expect(cacheState.urls.some((path) => path.startsWith(`${publicBase}assets/index-`) && path.endsWith(".js"))).toBe(true);
  expect(cacheState.urls.some((path) => path.startsWith(`${publicBase}assets/index-`) && path.endsWith(".css"))).toBe(true);
  expect(cacheState.precache.length).toBeGreaterThan(0);
  expect(cacheState.precache.filter((path) => !cacheState.urls.includes(path))).toEqual([]);
});

test("a local ledger can relaunch, mutate, and navigate while fully offline", async ({ page, context }) => {
  await page.goto(`${publicBase}#app`);
  await waitForOfflineControl(page);
  await addSubscription(page, "Offline Workspace", 18);
  await expect(page.getByRole("article").filter({ hasText: "Offline Workspace" })).toHaveCount(1);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Active subscriptions" })).toBeVisible();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Offline Workspace" })).toHaveCount(1);

  await addSubscription(page, "Offline Change", 9);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("article").filter({ hasText: "Offline Workspace" })).toHaveCount(1);
  await expect(page.getByRole("article").filter({ hasText: "Offline Change" })).toHaveCount(1);

  await page.goto(`${publicBase}?view=privacy`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Privacy and data controls", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Current release status" })).toContainText("Guest-only");

  await page.goto(publicBase, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Open tracker", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open tracker", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: "Offline Workspace" })).toHaveCount(1);
  await expect(page.getByRole("article").filter({ hasText: "Offline Change" })).toHaveCount(1);

  await context.setOffline(false);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
});

test("production security policy preserves CSV, calendar, and backup downloads", async ({ page }) => {
  await page.goto(`${publicBase}#app`);
  await expect(page.getByRole("heading", { name: "Active subscriptions" })).toBeVisible();

  await expectDownload(
    page,
    () => page.getByRole("button", { name: "Export CSV", exact: true }).click(),
    /^outflow-subscriptions-\d{4}-\d{2}-\d{2}\.csv$/,
  );

  await page.getByRole("button", { name: "Export calendar", exact: true }).click();
  const calendarDialog = page.getByRole("dialog", { name: "Calendar export" });
  await expectDownload(
    page,
    () => calendarDialog.getByRole("button", { name: "Download .ics", exact: true }).click(),
    /^outflow-personal-calendar\.ics$/,
  );
  await expect(calendarDialog).toBeHidden();

  await page.getByRole("button", { name: "Open Personal ledger controls", exact: true }).click();
  const ledgerDialog = page.getByRole("dialog", { name: "Ledger controls" });
  await expectDownload(
    page,
    () => ledgerDialog.getByRole("button", { name: "Export full ledger", exact: true }).click(),
    /^outflow-personal-backup-\d{4}-\d{2}-\d{2}\.json$/,
  );
});
