import assert from "node:assert/strict";
import test from "node:test";
import {
  MAINTENANCE_CACHE_KEY,
  MAINTENANCE_MESSAGE,
  readCachedServiceStatus,
  sanitizeServiceStatus,
  startServiceStatusChecks,
  writeCachedServiceStatus,
} from "../src/serviceStatus.js";

const enabledStatus = {
  schemaVersion: 1,
  maintenanceEnabled: true,
  updatedAt: "2026-07-20T14:00:00.000Z",
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    visibilityState: "visible",
    addEventListener(type, listener) {
      const current = listeners.get(type) || new Set();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      listeners.get(type)?.forEach((listener) => listener());
    },
    count(type) {
      return listeners.get(type)?.size || 0;
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("service status accepts only the bounded public response", () => {
  assert.deepEqual(sanitizeServiceStatus(enabledStatus), enabledStatus);
  assert.equal(MAINTENANCE_MESSAGE, "app in maintenance mode thank you for understanding");
  assert.throws(() => sanitizeServiceStatus({ ...enabledStatus, administratorEmail: "admin@example.com" }));
  assert.throws(() => sanitizeServiceStatus({ ...enabledStatus, schemaVersion: 2 }));
  assert.throws(() => sanitizeServiceStatus({ ...enabledStatus, maintenanceEnabled: "true" }));
  assert.throws(() => sanitizeServiceStatus({ ...enabledStatus, updatedAt: "not-a-date" }));
});

test("last known maintenance state is cached without operator data", () => {
  const storage = memoryStorage();
  writeCachedServiceStatus(enabledStatus, storage);
  assert.deepEqual(readCachedServiceStatus(storage), enabledStatus);
  const stored = JSON.parse(storage.getItem(MAINTENANCE_CACHE_KEY));
  assert.deepEqual(Object.keys(stored).sort(), ["maintenanceEnabled", "schemaVersion", "updatedAt"]);
});

test("service status checks launch, reconnect, focus, visibility resume, and interval", async () => {
  const windowObject = eventTarget();
  const documentObject = eventTarget();
  const intervals = [];
  let reads = 0;
  const received = [];
  const stop = startServiceStatusChecks({
    readStatus: async () => {
      reads += 1;
      return enabledStatus;
    },
    onStatus: (status) => received.push(status),
    windowObject,
    documentObject,
    navigatorObject: { onLine: true },
    setIntervalFn: (callback) => {
      intervals.push(callback);
      return 17;
    },
    clearIntervalFn: (id) => assert.equal(id, 17),
  });

  await flush();
  assert.equal(reads, 1);
  windowObject.dispatch("online");
  await flush();
  windowObject.dispatch("focus");
  await flush();
  documentObject.dispatch("visibilitychange");
  await flush();
  intervals[0]();
  await flush();
  assert.equal(reads, 5);
  assert.equal(received.length, 5);

  stop();
  assert.equal(windowObject.count("online"), 0);
  assert.equal(windowObject.count("focus"), 0);
  assert.equal(documentObject.count("visibilitychange"), 0);
});

test("offline and failed checks retain cached status and report unavailability", async () => {
  let unavailable = 0;
  const stopOffline = startServiceStatusChecks({
    readStatus: async () => enabledStatus,
    onStatus: () => assert.fail("offline check returned a status"),
    onUnavailable: () => { unavailable += 1; },
    windowObject: eventTarget(),
    documentObject: eventTarget(),
    navigatorObject: { onLine: false },
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  await flush();
  assert.equal(unavailable, 1);
  stopOffline();

  const stopFailed = startServiceStatusChecks({
    readStatus: async () => { throw new Error("unavailable"); },
    onStatus: () => assert.fail("failed check returned a status"),
    onUnavailable: () => { unavailable += 1; },
    windowObject: eventTarget(),
    documentObject: eventTarget(),
    navigatorObject: { onLine: true },
    setIntervalFn: () => 2,
    clearIntervalFn: () => {},
  });
  await flush();
  assert.equal(unavailable, 2);
  stopFailed();
});
