export const MAINTENANCE_CACHE_KEY = "outflow:service-status";
export const MAINTENANCE_MESSAGE = "app in maintenance mode thank you for understanding";
export const SERVICE_STATUS_CHECK_INTERVAL_MS = 15_000;

export const availableServiceStatus = Object.freeze({
  schemaVersion: 1,
  maintenanceEnabled: false,
  updatedAt: "",
});

export function sanitizeServiceStatus(value) {
  const keys = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || keys.join(",") !== "maintenanceEnabled,schemaVersion,updatedAt"
    || value.schemaVersion !== 1
    || typeof value.maintenanceEnabled !== "boolean"
    || (value.updatedAt !== "" && (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))))
  ) {
    throw new Error("Outflow returned an invalid service status.");
  }
  return {
    schemaVersion: 1,
    maintenanceEnabled: value.maintenanceEnabled,
    updatedAt: value.updatedAt || "",
  };
}

export function readCachedServiceStatus(storage = globalThis.localStorage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(MAINTENANCE_CACHE_KEY);
    return raw ? sanitizeServiceStatus(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeCachedServiceStatus(status, storage = globalThis.localStorage) {
  const sanitized = sanitizeServiceStatus(status);
  storage?.setItem(MAINTENANCE_CACHE_KEY, JSON.stringify(sanitized));
  return sanitized;
}

export function startServiceStatusChecks({
  readStatus,
  onStatus,
  onUnavailable = () => {},
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  navigatorObject = globalThis.navigator,
  intervalMs = SERVICE_STATUS_CHECK_INTERVAL_MS,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
}) {
  let active = true;
  let checking = false;

  const check = async () => {
    if (!active || checking) return;
    if (navigatorObject?.onLine === false) {
      onUnavailable();
      return;
    }
    checking = true;
    try {
      const status = sanitizeServiceStatus(await readStatus());
      if (active) onStatus(status);
    } catch {
      if (active) onUnavailable();
    } finally {
      checking = false;
    }
  };

  const checkWhenVisible = () => {
    if (documentObject?.visibilityState === "visible") void check();
  };
  const interval = setIntervalFn(() => {
    if (documentObject?.visibilityState !== "hidden") void check();
  }, intervalMs);

  windowObject?.addEventListener("online", check);
  windowObject?.addEventListener("focus", check);
  documentObject?.addEventListener("visibilitychange", checkWhenVisible);
  void check();

  return () => {
    active = false;
    clearIntervalFn(interval);
    windowObject?.removeEventListener("online", check);
    windowObject?.removeEventListener("focus", check);
    documentObject?.removeEventListener("visibilitychange", checkWhenVisible);
  };
}
