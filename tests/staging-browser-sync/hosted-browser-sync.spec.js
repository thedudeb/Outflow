import { appendFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  browserAuthStorageKey,
  browserSyncCheckNames,
  buildBrowserSyncReport,
  provisionBrowserSyncFixture,
  resolveBrowserSyncAcceptanceConfig,
} from "../../scripts/staging-browser-sync.mjs";

function installBrowserAcceptanceControl({ storageKey, session }) {
  localStorage.setItem(storageKey, JSON.stringify(session));

  const NativeWebSocket = window.WebSocket;
  const nativeOnMessage = Object.getOwnPropertyDescriptor(NativeWebSocket.prototype, "onmessage");
  const realtimeSockets = new Set();
  const state = { dropChanges: false, holdConnections: false };

  class AcceptanceWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      const realtime = String(url).includes("/realtime/v1/websocket");
      if (!realtime) return;

      realtimeSockets.add(this);
      this.addEventListener("open", () => {
        if (state.holdConnections && this.readyState === NativeWebSocket.OPEN) {
          this.close(4001, "Staging acceptance disconnect");
        }
      });
      this.addEventListener("close", () => realtimeSockets.delete(this));

      if (!nativeOnMessage?.set) return;
      let assignedHandler = null;
      Object.defineProperty(this, "onmessage", {
        configurable: true,
        enumerable: true,
        get() {
          return assignedHandler;
        },
        set(handler) {
          assignedHandler = handler;
          const controlledHandler = typeof handler === "function"
            ? (event) => {
                if (state.dropChanges && typeof event.data === "string") {
                  try {
                    if (JSON.parse(event.data)?.event === "postgres_changes") return;
                  } catch {
                    // Non-JSON transport messages remain visible to the client.
                  }
                }
                handler.call(this, event);
              }
            : handler;
          nativeOnMessage.set.call(this, controlledHandler);
        },
      });
    }
  }

  window.WebSocket = AcceptanceWebSocket;
  Object.defineProperty(window, "__OUTFLOW_STAGING_SYNC__", {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
      dropChanges(value) {
        state.dropChanges = value === true;
      },
      disconnect() {
        state.holdConnections = true;
        realtimeSockets.forEach((socket) => {
          if (socket.readyState < NativeWebSocket.CLOSING) socket.close(4001, "Staging acceptance disconnect");
        });
      },
      reconnect() {
        state.holdConnections = false;
      },
    }),
  });
}

function browserContextOptions(projectUse) {
  const options = { acceptDownloads: false, serviceWorkers: "block" };
  for (const key of ["viewport", "userAgent", "deviceScaleFactor", "isMobile", "hasTouch"]) {
    if (projectUse[key] !== undefined) options[key] = projectUse[key];
  }
  return options;
}

async function createAuthenticatedContext(browser, projectUse, storageKey, session) {
  const context = await browser.newContext(browserContextOptions(projectUse));
  await context.addInitScript(installBrowserAcceptanceControl, { storageKey, session });
  return context;
}

async function openHostedLedger(
  page,
  appOrigin,
  ledgerName,
  { navigate = true, waitForSynced = true } = {},
) {
  if (navigate) {
    await page.goto(`${appOrigin}/#app`, { waitUntil: "domcontentloaded" });
  }
  const accountButton = page.getByRole("button", { name: /^Open account controls for / });
  await expect(accountButton).toBeVisible({ timeout: 30_000 });
  await accountButton.click();

  const dialog = page.getByRole("dialog", { name: "Account / Pro" });
  const ledgerTitle = dialog.getByText(ledgerName, { exact: true });
  await expect(ledgerTitle).toBeVisible({ timeout: 20_000 });
  const ledgerRow = ledgerTitle.locator("..").locator("..");
  await ledgerRow.getByRole("button", { name: "Open", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: `Manage ${ledgerName} subscriptions`, exact: true })).toBeVisible();
  if (waitForSynced) {
    await expect(page.getByText("synced", { exact: true })).toBeVisible();
  }
}

function subscriptionCard(page, subscriptionName) {
  return page.getByRole("article").filter({ has: page.getByText(subscriptionName, { exact: true }) });
}

async function beginAmountEdit(page, subscriptionName, amount) {
  const card = subscriptionCard(page, subscriptionName);
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill(String(amount));
}

async function commitAmount(page, subscriptionName, amount, revision) {
  await beginAmountEdit(page, subscriptionName, amount);
  await page.getByRole("button", { name: "Commit changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `Synchronized revision ${revision}.` })).toBeVisible();
}

async function expectCardAmount(page, subscriptionName, amount) {
  await expect(subscriptionCard(page, subscriptionName)).toContainText(`$${Number(amount).toFixed(2)}`);
}

test("deployed UI recovers durable writes, rejects conflicts, and catches up after Realtime reconnect", async ({ browser }, testInfo) => {
  const config = resolveBrowserSyncAcceptanceConfig(process.env);
  if (config.errors.length) throw new Error(`Staging browser-sync configuration failed:\n${config.errors.map((error) => `- ${error}`).join("\n")}`);

  const fixture = await provisionBrowserSyncFixture(config);
  const storageKey = browserAuthStorageKey(config.projectUrl);
  const completed = [];
  let ownerContext;
  let editorContext;

  try {
    ownerContext = await createAuthenticatedContext(browser, testInfo.project.use, storageKey, fixture.ownerSession);
    editorContext = await createAuthenticatedContext(browser, testInfo.project.use, storageKey, fixture.editorSession);
    const ownerPage = await ownerContext.newPage();
    const editorPage = await editorContext.newPage();
    let captureOwnerWrites = false;
    let failNextOwnerWrite = false;
    const ownerWriteAttempts = [];

    await ownerPage.route("**/rest/v1/rpc/replace_ledger_snapshot", async (route) => {
      if (!captureOwnerWrites) {
        await route.continue();
        return;
      }

      ownerWriteAttempts.push(route.request().postDataJSON());
      if (failNextOwnerWrite) {
        failNextOwnerWrite = false;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await openHostedLedger(ownerPage, config.appOrigin, fixture.teamName);
    await openHostedLedger(editorPage, config.appOrigin, fixture.teamName);
    completed.push("verified browser sessions", "isolated shared ledger open");
    await expectCardAmount(ownerPage, fixture.subscriptionName, 33);
    await expectCardAmount(editorPage, fixture.subscriptionName, 33);

    captureOwnerWrites = true;
    failNextOwnerWrite = true;
    await beginAmountEdit(ownerPage, fixture.subscriptionName, 34);
    await ownerPage.getByRole("button", { name: "Commit changes", exact: true }).click();
    await expect(ownerPage.getByRole("alert")).toContainText("Cloud change saved on this device / attempt 1");
    await expectCardAmount(ownerPage, fixture.subscriptionName, 34);

    const queuedWrite = await ownerPage.evaluate(() => {
      const raw = localStorage.getItem("outflow:cloud-write-outbox:v1");
      return raw ? JSON.parse(raw) : null;
    });
    expect(ownerWriteAttempts).toHaveLength(1);
    expect(queuedWrite?.operations).toHaveLength(1);
    expect(queuedWrite.operations[0]).toMatchObject({
      accountId: fixture.ownerSession.user.id,
      ledgerId: fixture.teamId,
      expectedRevision: 0,
      attemptCount: 1,
      operationId: ownerWriteAttempts[0].client_operation_id,
    });
    expect(queuedWrite.operations[0].subscriptions).toEqual(ownerWriteAttempts[0].subscriptions_payload);
    expect(queuedWrite.operations[0].subscriptions[0].amount).toBe(34);
    const serializedQueuedWrite = JSON.stringify(queuedWrite);
    expect(Buffer.byteLength(serializedQueuedWrite, "utf8")).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(serializedQueuedWrite).not.toContain(fixture.ownerSession.access_token);
    expect(serializedQueuedWrite).not.toContain(fixture.ownerSession.refresh_token);
    expect(serializedQueuedWrite).not.toContain(fixture.ownerSession.user.email);
    completed.push("durable write persistence");

    await ownerPage.reload({ waitUntil: "domcontentloaded" });
    await openHostedLedger(ownerPage, config.appOrigin, fixture.teamName, {
      navigate: false,
      waitForSynced: false,
    });
    await expect(ownerPage.getByRole("status")).toContainText("Synchronized revision 1.");
    expect(ownerWriteAttempts).toHaveLength(2);
    expect(ownerWriteAttempts[1]).toEqual(ownerWriteAttempts[0]);
    await expectCardAmount(ownerPage, fixture.subscriptionName, 34);
    const recoveredOutbox = await ownerPage.evaluate(() => {
      const raw = localStorage.getItem("outflow:cloud-write-outbox:v1");
      return raw ? JSON.parse(raw) : null;
    });
    expect(recoveredOutbox?.operations ?? []).toEqual([]);
    captureOwnerWrites = false;
    completed.push("exact operation reload replay", "durable write cleanup");

    await expect(editorPage.getByRole("status").filter({ hasText: "Remote changes applied." })).toBeVisible({ timeout: 20_000 });
    await expectCardAmount(editorPage, fixture.subscriptionName, 34);
    completed.push("hosted Realtime refresh");

    await beginAmountEdit(ownerPage, fixture.subscriptionName, 36);
    await ownerPage.waitForTimeout(500);
    await commitAmount(editorPage, fixture.subscriptionName, 37, 2);
    const staleAlert = ownerPage.getByRole("alert").filter({
      hasText: "Another cloud revision is available. Finish or cancel the current edit, then refresh.",
    });
    await expect(staleAlert).toBeVisible({ timeout: 20_000 });
    await expect(ownerPage.getByRole("spinbutton", { name: "Amount", exact: true })).toHaveValue("36");
    await expect(ownerPage.getByRole("button", { name: "Commit changes", exact: true })).toBeDisabled();
    completed.push("stale edit preservation");

    await ownerPage.getByRole("button", { name: "Clear", exact: true }).click();
    await ownerPage.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(ownerPage.getByRole("status").filter({ hasText: "Synced list refreshed." })).toBeVisible();
    await expectCardAmount(ownerPage, fixture.subscriptionName, 37);
    completed.push("stale refresh recovery");

    await ownerPage.evaluate(() => window.__OUTFLOW_STAGING_SYNC__.dropChanges(true));
    await commitAmount(editorPage, fixture.subscriptionName, 38, 3);
    await expectCardAmount(ownerPage, fixture.subscriptionName, 37);
    await beginAmountEdit(ownerPage, fixture.subscriptionName, 39);
    await ownerPage.getByRole("button", { name: "Commit changes", exact: true }).click();
    const conflictAlert = ownerPage.getByRole("alert").filter({
      hasText: "Cloud changed at revision 3. Your stale write was rejected",
    });
    await expect(conflictAlert).toBeVisible({ timeout: 20_000 });
    await expectCardAmount(ownerPage, fixture.subscriptionName, 38);
    await expect(ownerPage.getByText("$39.00", { exact: true })).toHaveCount(0);
    completed.push("browser conflict rejection");

    await ownerPage.evaluate(() => window.__OUTFLOW_STAGING_SYNC__.dropChanges(false));
    await ownerPage.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(ownerPage.getByRole("status").filter({ hasText: "Synced list refreshed." })).toBeVisible();
    await expect(ownerPage.getByText("synced", { exact: true })).toBeVisible();
    completed.push("conflict refresh recovery");

    await ownerPage.evaluate(() => window.__OUTFLOW_STAGING_SYNC__.disconnect());
    const offlineAlert = ownerPage.getByRole("alert").filter({
      hasText: "Realtime connection interrupted. Outflow will refresh after it reconnects.",
    });
    await expect(offlineAlert).toBeVisible({ timeout: 20_000 });
    completed.push("Realtime disconnect visibility");

    await commitAmount(editorPage, fixture.subscriptionName, 41, 4);
    await expectCardAmount(ownerPage, fixture.subscriptionName, 38);
    await ownerPage.evaluate(() => window.__OUTFLOW_STAGING_SYNC__.reconnect());
    await expect(ownerPage.getByRole("status").filter({ hasText: "Remote changes applied." })).toBeVisible({ timeout: 30_000 });
    await expectCardAmount(ownerPage, fixture.subscriptionName, 41);
    completed.push("authoritative reconnect catch-up");
    await expect(ownerPage.getByText("synced", { exact: true })).toBeVisible();
    completed.push("synchronized final state");

    expect(completed).toEqual(browserSyncCheckNames);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : "";
      await appendFile(process.env.GITHUB_STEP_SUMMARY, buildBrowserSyncReport({
        projectUrl: config.projectUrl,
        appOrigin: config.appOrigin,
        completed,
        viewport: testInfo.project.name,
        commit: process.env.GITHUB_SHA,
        actor: process.env.GITHUB_ACTOR,
        runUrl,
      }), "utf8");
    }
  } finally {
    await Promise.allSettled([ownerContext?.close(), editorContext?.close()].filter(Boolean));
    await fixture.cleanup();
  }
});
