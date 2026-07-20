import assert from "node:assert/strict";
import test from "node:test";
import {
  MACOS_UPDATE_TARGET,
  checkForMacosUpdate,
  installMacosUpdate,
  isMacosNativeRuntime,
  PWA_UPDATE_CHECK_INTERVAL_MS,
  startPwaUpdateChecks,
} from "../src/appUpdates.js";

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      listeners.get(type)?.forEach((listener) => listener());
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
  };
}

test("installed PWAs recheck safely across long-running browser sessions", async () => {
  const windowEvents = eventTarget();
  const documentEvents = eventTarget();
  let online = true;
  let intervalCallback;
  let clearedInterval = null;
  let updates = 0;
  const windowObject = {
    ...windowEvents,
    navigator: { get onLine() { return online; } },
    setInterval(callback, delay) {
      assert.equal(delay, PWA_UPDATE_CHECK_INTERVAL_MS);
      intervalCallback = callback;
      return 42;
    },
    clearInterval(id) { clearedInterval = id; },
  };
  const documentObject = { ...documentEvents, visibilityState: "visible" };
  const stop = startPwaUpdateChecks({ update: async () => { updates += 1; } }, {
    windowObject,
    documentObject,
  });

  await Promise.resolve();
  assert.equal(updates, 1);
  windowObject.dispatch("focus");
  windowObject.dispatch("online");
  documentObject.dispatch("visibilitychange");
  intervalCallback();
  await Promise.resolve();
  assert.equal(updates, 5);

  online = false;
  windowObject.dispatch("focus");
  intervalCallback();
  await Promise.resolve();
  assert.equal(updates, 5);

  documentObject.visibilityState = "hidden";
  documentObject.dispatch("visibilitychange");
  await Promise.resolve();
  assert.equal(updates, 5);

  stop();
  assert.equal(clearedInterval, 42);
  assert.equal(windowObject.listenerCount("focus"), 0);
  assert.equal(windowObject.listenerCount("online"), 0);
  assert.equal(documentObject.listenerCount("visibilitychange"), 0);
});

test("failed PWA update checks are contained and invalid registrations are rejected", async () => {
  const windowEvents = eventTarget();
  const documentEvents = eventTarget();
  const windowObject = {
    ...windowEvents,
    navigator: { onLine: true },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  const documentObject = { ...documentEvents, visibilityState: "visible" };
  const stop = startPwaUpdateChecks({ update: async () => { throw new Error("offline"); } }, {
    windowObject,
    documentObject,
  });
  await Promise.resolve();
  await Promise.resolve();
  stop();
  assert.throws(() => startPwaUpdateChecks(null, { windowObject, documentObject }), /registration/);
});

test("only the native macOS client checks the universal signed update channel", async () => {
  assert.equal(isMacosNativeRuntime({ TAURI_ENV_PLATFORM: "macos" }), true);
  assert.equal(isMacosNativeRuntime({ TAURI_ENV_PLATFORM: "darwin" }), true);
  assert.equal(isMacosNativeRuntime({ TAURI_ENV_PLATFORM: "ios" }), false);
  assert.equal(isMacosNativeRuntime({}), false);
  assert.equal(await checkForMacosUpdate({ native: false }), null);

  const update = { version: "0.2.0" };
  const calls = [];
  assert.equal(await checkForMacosUpdate({
    native: true,
    updaterAdapter: {
      check: async (options) => {
        calls.push(options);
        return update;
      },
    },
  }), update);
  assert.deepEqual(calls, [{ target: MACOS_UPDATE_TARGET, timeout: 15_000 }]);
});

test("a verified update reports bounded progress and relaunches only after installation", async () => {
  const progress = [];
  const calls = [];
  await installMacosUpdate({
    downloadAndInstall: async (onEvent) => {
      calls.push("install");
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      onEvent({ event: "Progress", data: { chunkLength: 60 } });
      onEvent({ event: "Finished" });
    },
  }, {
    processAdapter: { relaunch: async () => calls.push("relaunch") },
    onProgress: (event) => progress.push(event),
  });

  assert.deepEqual(calls, ["install", "relaunch"]);
  assert.deepEqual(progress, [
    { phase: "downloading", downloaded: 0, contentLength: 100 },
    { phase: "downloading", downloaded: 40, contentLength: 100 },
    { phase: "downloading", downloaded: 100, contentLength: 100 },
    { phase: "installed", downloaded: 100, contentLength: 100 },
  ]);
});

test("a failed install never relaunches the client", async () => {
  let relaunched = false;
  await assert.rejects(() => installMacosUpdate({
    downloadAndInstall: async () => {
      throw new Error("signature rejected");
    },
  }, {
    processAdapter: { relaunch: async () => { relaunched = true; } },
  }), /signature rejected/);
  assert.equal(relaunched, false);
  await assert.rejects(() => installMacosUpdate(null), /verified macOS update/);
});
