import assert from "node:assert/strict";
import test from "node:test";
import {
  MACOS_UPDATE_TARGET,
  checkForMacosUpdate,
  installMacosUpdate,
  isMacosNativeRuntime,
} from "../src/appUpdates.js";

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
