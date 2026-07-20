const MACOS_UPDATE_TARGET = "darwin-universal";
const PWA_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000;

export function startPwaUpdateChecks(registration, {
  windowObject = window,
  documentObject = document,
  intervalMs = PWA_UPDATE_CHECK_INTERVAL_MS,
} = {}) {
  if (!registration?.update) throw new TypeError("A service worker registration is required.");

  let stopped = false;
  const check = () => {
    if (stopped || !windowObject.navigator.onLine) return;
    Promise.resolve(registration.update()).catch(() => {});
  };
  const checkWhenVisible = () => {
    if (documentObject.visibilityState === "visible") check();
  };

  windowObject.addEventListener("online", check);
  windowObject.addEventListener("focus", check);
  documentObject.addEventListener("visibilitychange", checkWhenVisible);
  const interval = windowObject.setInterval(check, intervalMs);
  check();

  return () => {
    stopped = true;
    windowObject.clearInterval(interval);
    windowObject.removeEventListener("online", check);
    windowObject.removeEventListener("focus", check);
    documentObject.removeEventListener("visibilitychange", checkWhenVisible);
  };
}

export function isMacosNativeRuntime(environment = import.meta.env) {
  return ["darwin", "macos"].includes(environment?.TAURI_ENV_PLATFORM);
}

async function nativeUpdater(adapter) {
  return adapter || import("@tauri-apps/plugin-updater");
}

async function nativeProcess(adapter) {
  return adapter || import("@tauri-apps/plugin-process");
}

export async function checkForMacosUpdate({
  native = isMacosNativeRuntime(),
  updaterAdapter,
} = {}) {
  if (!native) return null;
  const updater = await nativeUpdater(updaterAdapter);
  return updater.check({ target: MACOS_UPDATE_TARGET, timeout: 15_000 });
}

export async function installMacosUpdate(update, {
  processAdapter,
  onProgress = () => {},
} = {}) {
  if (!update?.downloadAndInstall) throw new TypeError("A verified macOS update is required.");

  let downloaded = 0;
  let contentLength = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      contentLength = Number(event.data?.contentLength) || 0;
      onProgress({ phase: "downloading", downloaded, contentLength });
      return;
    }
    if (event.event === "Progress") {
      downloaded += Number(event.data?.chunkLength) || 0;
      onProgress({ phase: "downloading", downloaded, contentLength });
      return;
    }
    if (event.event === "Finished") onProgress({ phase: "installed", downloaded, contentLength });
  });

  const process = await nativeProcess(processAdapter);
  await process.relaunch();
}

export { MACOS_UPDATE_TARGET, PWA_UPDATE_CHECK_INTERVAL_MS };
