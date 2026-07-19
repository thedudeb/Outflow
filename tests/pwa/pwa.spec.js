import { expect, test } from "@playwright/test";

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

test("production metadata and the generated cache satisfy the installable-web contract", async ({ page }) => {
  await page.goto("/#app");
  await expect(page.getByRole("heading", { name: "Active subscriptions" })).toBeVisible();
  const worker = await waitForOfflineControl(page);
  expect(worker).toEqual({ active: "activated", scope: "http://127.0.0.1:4174/" });
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible();

  const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).json());
  expect(manifest).toMatchObject({
    name: "Outflow Subscription Tracker",
    short_name: "Outflow",
    id: "/#app",
    start_url: "/#app",
    scope: "/",
    display: "standalone",
    background_color: "#08090a",
    theme_color: "#08090a",
  });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "/outflow-icon-192.png", sizes: "192x192", type: "image/png" }),
    expect.objectContaining({ src: "/outflow-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }),
  ]));

  const cacheState = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("outflow-"));
    const requests = names.length === 1 ? await caches.open(names[0]).then((cache) => cache.keys()) : [];
    const workerSource = await fetch("/sw.js").then((response) => response.text());
    const precacheMatch = workerSource.match(/const PRECACHE = (\[[^;]+\]);/);
    return {
      names,
      precache: precacheMatch ? JSON.parse(precacheMatch[1]) : [],
      urls: requests.map((request) => new URL(request.url).pathname),
    };
  });
  expect(cacheState.names).toHaveLength(1);
  expect(cacheState.names[0]).toMatch(/^outflow-[a-f0-9]{12}$/);
  expect(cacheState.urls).toEqual(expect.arrayContaining([
    "/",
    "/index.html",
    "/manifest.webmanifest",
    "/outflow-icon-192.png",
    "/outflow-icon-512.png",
  ]));
  expect(cacheState.urls.some((path) => /^\/assets\/index-.+\.js$/.test(path))).toBe(true);
  expect(cacheState.urls.some((path) => /^\/assets\/index-.+\.css$/.test(path))).toBe(true);
  expect(cacheState.precache.length).toBeGreaterThan(0);
  expect(cacheState.precache.filter((path) => !cacheState.urls.includes(path))).toEqual([]);
});

test("a local ledger can relaunch, mutate, and navigate while fully offline", async ({ page, context }) => {
  await page.goto("/#app");
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

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Open tracker", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open tracker", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: "Offline Workspace" })).toHaveCount(1);
  await expect(page.getByRole("article").filter({ hasText: "Offline Change" })).toHaveCount(1);

  await context.setOffline(false);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
});
