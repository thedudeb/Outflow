import assert from "node:assert/strict";
import test from "node:test";
import {
  claimDeviceNotification,
  initialDeviceNotificationPermission,
  isNativeDesktopRuntime,
  readDeviceNotificationPermission,
  releaseDeviceNotification,
  requestDeviceNotificationPermission,
  sendDeviceNotification,
} from "../src/deviceNotifications.js";

test("runtime and initial permission detection preserve native settings while permission loads", () => {
  assert.equal(isNativeDesktopRuntime({ TAURI_ENV_PLATFORM: "darwin" }), true);
  assert.equal(isNativeDesktopRuntime({}), false);
  assert.equal(initialDeviceNotificationPermission({ native: true }), "checking");
  assert.equal(initialDeviceNotificationPermission({
    native: false,
    browser: { Notification: { permission: "granted" } },
  }), "granted");
  assert.equal(initialDeviceNotificationPermission({ native: false, browser: {} }), "unsupported");
});

test("native permission checks and requests use only the notification adapter", async () => {
  const calls = [];
  const grantedAdapter = {
    isPermissionGranted: async () => {
      calls.push("read");
      return true;
    },
    requestPermission: async () => {
      calls.push("request");
      return "denied";
    },
  };
  assert.equal(await readDeviceNotificationPermission({ native: true, nativeAdapter: grantedAdapter }), "granted");
  assert.equal(await requestDeviceNotificationPermission({ native: true, nativeAdapter: grantedAdapter }), "granted");
  assert.deepEqual(calls, ["read", "read"]);

  const promptAdapter = {
    isPermissionGranted: async () => false,
    requestPermission: async () => "denied",
  };
  assert.equal(await readDeviceNotificationPermission({ native: true, nativeAdapter: promptAdapter }), "default");
  assert.equal(await requestDeviceNotificationPermission({ native: true, nativeAdapter: promptAdapter }), "denied");
});

test("native delivery strips internal identifiers while browser delivery retains its dedupe tag", async () => {
  const nativePayloads = [];
  await sendDeviceNotification({
    title: "Outflow / Storage bills today",
    body: "$2.99 will leave today / Personal / personal local ledger.",
    deliveryId: "private-ledger-id:charge-storage",
  }, {
    native: true,
    nativeAdapter: { sendNotification: (payload) => nativePayloads.push(payload) },
  });
  assert.deepEqual(nativePayloads, [{
    title: "Outflow / Storage bills today",
    body: "$2.99 will leave today / Personal / personal local ledger.",
  }]);

  const browserPayloads = [];
  class BrowserNotification {
    constructor(title, options) {
      browserPayloads.push({ title, options });
    }
  }
  await sendDeviceNotification({
    title: "Outflow / Storage bills today",
    body: "$2.99 will leave today / Personal / personal local ledger.",
    deliveryId: "local-tag",
  }, { native: false, browser: { Notification: BrowserNotification } });
  assert.deepEqual(browserPayloads, [{
    title: "Outflow / Storage bills today",
    options: {
      body: "$2.99 will leave today / Personal / personal local ledger.",
      tag: "local-tag",
    },
  }]);
});

test("an in-flight notification cannot be claimed twice", () => {
  const id = "ledger:charge-service-date";
  assert.equal(claimDeviceNotification(id), true);
  assert.equal(claimDeviceNotification(id), false);
  releaseDeviceNotification(id);
  assert.equal(claimDeviceNotification(id), true);
  releaseDeviceNotification(id);
  assert.equal(claimDeviceNotification(""), false);
});
