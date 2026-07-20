const inFlightDeliveryIds = new Set();

export function isNativeDesktopRuntime(environment = import.meta.env) {
  return Boolean(environment?.TAURI_ENV_PLATFORM);
}

export function initialDeviceNotificationPermission({
  native = isNativeDesktopRuntime(),
  browser = globalThis.window,
} = {}) {
  if (native) return "checking";
  return browser && "Notification" in browser ? browser.Notification.permission : "unsupported";
}

async function nativeNotifications(adapter) {
  return adapter || import("@tauri-apps/plugin-notification");
}

export async function readDeviceNotificationPermission({
  native = isNativeDesktopRuntime(),
  browser = globalThis.window,
  nativeAdapter,
} = {}) {
  if (native) {
    const notifications = await nativeNotifications(nativeAdapter);
    return await notifications.isPermissionGranted() ? "granted" : "default";
  }
  return browser && "Notification" in browser ? browser.Notification.permission : "unsupported";
}

export async function requestDeviceNotificationPermission({
  native = isNativeDesktopRuntime(),
  browser = globalThis.window,
  nativeAdapter,
} = {}) {
  if (native) {
    const notifications = await nativeNotifications(nativeAdapter);
    if (await notifications.isPermissionGranted()) return "granted";
    return notifications.requestPermission();
  }
  if (!browser || !("Notification" in browser)) return "unsupported";
  return browser.Notification.requestPermission();
}

export async function sendDeviceNotification({ title, body, deliveryId }, {
  native = isNativeDesktopRuntime(),
  browser = globalThis.window,
  nativeAdapter,
} = {}) {
  if (native) {
    const notifications = await nativeNotifications(nativeAdapter);
    notifications.sendNotification({ title, body });
    return;
  }
  if (!browser || !("Notification" in browser)) throw new Error("Device notifications are unsupported.");
  new browser.Notification(title, { body, tag: deliveryId });
}

export function claimDeviceNotification(deliveryId) {
  if (!deliveryId || inFlightDeliveryIds.has(deliveryId)) return false;
  inFlightDeliveryIds.add(deliveryId);
  return true;
}

export function releaseDeviceNotification(deliveryId) {
  inFlightDeliveryIds.delete(deliveryId);
}
