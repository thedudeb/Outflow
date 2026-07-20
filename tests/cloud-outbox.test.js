import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_WRITE_OUTBOX_KEY,
  createCloudWriteOperation,
  listAccountCloudWriteOperations,
  markCloudWriteAttempt,
  readCloudWriteOperation,
  removeAccountCloudWriteOperations,
  removeCloudWriteOperation,
  saveCloudWriteOperation,
} from "../src/cloudOutbox.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const otherAccountId = "22222222-2222-4222-8222-222222222222";
const ledgerId = "studio-cloud";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function subscription(overrides = {}) {
  return {
    id: "figma-cloud",
    name: "Figma Cloud",
    amount: 25,
    currency: "USD",
    cycle: "monthly",
    nextBillingDate: "2026-08-19",
    category: "Design",
    tags: ["team", "design"],
    color: "#8b5cf6",
    trialEndDate: "",
    reminderLeadDays: [7],
    paused: false,
    revision: 1,
    updatedAt: "2026-07-20T12:00:00.000Z",
    createdBy: "Morgan Editor",
    updatedBy: "You",
    ...overrides,
  };
}

function operation(overrides = {}) {
  return createCloudWriteOperation({
    accountId,
    ledgerId,
    expectedRevision: 2,
    subscriptions: [subscription()],
    operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    now: "2026-07-20T12:00:00.000Z",
    ...overrides,
  });
}

test("persists an immutable bounded snapshot and retries the same operation", () => {
  const storage = memoryStorage();
  const pending = operation();
  saveCloudWriteOperation(storage, pending);

  const attempted = markCloudWriteAttempt(pending, "2026-07-20T12:01:00.000Z");
  saveCloudWriteOperation(storage, attempted);
  const restored = readCloudWriteOperation(storage, accountId, ledgerId);

  assert.equal(restored.operationId, pending.operationId);
  assert.equal(restored.expectedRevision, 2);
  assert.equal(restored.attemptCount, 1);
  assert.equal(restored.lastAttemptAt, "2026-07-20T12:01:00.000Z");
  assert.deepEqual(restored.subscriptions, [subscription()]);
  assert.doesNotMatch(storage.getItem(CLOUD_WRITE_OUTBOX_KEY), /access[_-]?token|refresh[_-]?token|provider.*error/i);
});

test("binds pending writes to the exact account and ledger", () => {
  const storage = memoryStorage();
  saveCloudWriteOperation(storage, operation());
  saveCloudWriteOperation(storage, operation({
    accountId: otherAccountId,
    ledgerId: "home-cloud",
    operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  }));

  assert.equal(readCloudWriteOperation(storage, accountId, "home-cloud"), null);
  assert.equal(readCloudWriteOperation(storage, otherAccountId, ledgerId), null);
  assert.equal(listAccountCloudWriteOperations(storage, accountId).length, 1);
  assert.equal(listAccountCloudWriteOperations(storage, otherAccountId).length, 1);
  assert.throws(() => saveCloudWriteOperation(storage, operation({
    operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  })), /already has a pending change/);
  assert.throws(() => saveCloudWriteOperation(storage, {
    ...operation(),
    subscriptions: [subscription({ amount: 99 })],
  }), /must remain immutable/);
});

test("rejects private, malformed, duplicate, and oversized snapshots", () => {
  assert.throws(() => operation({ subscriptions: [subscription({ accessToken: "secret" })] }), /invalid/);
  assert.throws(() => operation({ subscriptions: [subscription(), subscription()] }), /invalid/);
  assert.throws(() => operation({ subscriptions: [subscription({ amount: -1 })] }), /invalid/);
  assert.throws(() => operation({ subscriptions: [subscription({ name: "x".repeat(2 * 1024 * 1024) })] }), /invalid/);
});

test("ignores corrupted storage and clears only the requested operation", () => {
  const storage = memoryStorage();
  storage.setItem(CLOUD_WRITE_OUTBOX_KEY, "not-json");
  assert.equal(readCloudWriteOperation(storage, accountId, ledgerId), null);

  const first = operation();
  const second = operation({
    accountId: otherAccountId,
    ledgerId: "home-cloud",
    operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  saveCloudWriteOperation(storage, first);
  saveCloudWriteOperation(storage, second);
  assert.equal(removeCloudWriteOperation(storage, accountId, ledgerId, first.operationId), true);
  assert.equal(readCloudWriteOperation(storage, accountId, ledgerId), null);
  assert.equal(readCloudWriteOperation(storage, otherAccountId, "home-cloud").operationId, second.operationId);
  assert.equal(removeAccountCloudWriteOperations(storage, otherAccountId), 1);
  assert.deepEqual(listAccountCloudWriteOperations(storage, otherAccountId), []);
});
