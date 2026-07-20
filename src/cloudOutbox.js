export const CLOUD_WRITE_OUTBOX_KEY = "outflow:cloud-write-outbox:v1";

const SCHEMA_VERSION = 1;
const OPERATION_KIND = "replace-ledger-snapshot";
const MAX_OPERATIONS = 8;
const MAX_SUBSCRIPTIONS = 500;
const MAX_STORED_BYTES = 2 * 1024 * 1024;
const MAX_ATTEMPTS = 10000;
const allowedSubscriptionKeys = new Set([
  "id",
  "name",
  "amount",
  "currency",
  "cycle",
  "nextBillingDate",
  "category",
  "tags",
  "color",
  "trialEndDate",
  "reminderLeadDays",
  "paused",
  "revision",
  "updatedAt",
  "createdBy",
  "updatedBy",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(value);
}

function isOperationId(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function serializedBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validSubscription(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowedSubscriptionKeys.has(key))) return false;
  return isSafeId(value.id)
    && typeof value.name === "string" && value.name.length >= 1 && value.name.length <= 100
    && typeof value.amount === "number" && Number.isFinite(value.amount) && value.amount > 0 && value.amount <= 1000000000
    && typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency)
    && ["weekly", "monthly", "yearly"].includes(value.cycle)
    && isDate(value.nextBillingDate)
    && typeof value.category === "string" && value.category.length >= 1 && value.category.length <= 60
    && Array.isArray(value.tags) && value.tags.length <= 10
    && value.tags.every((tag) => typeof tag === "string" && tag.length >= 1 && tag.length <= 24)
    && typeof value.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color)
    && (value.trialEndDate === "" || isDate(value.trialEndDate))
    && Array.isArray(value.reminderLeadDays) && value.reminderLeadDays.length <= 16
    && value.reminderLeadDays.every((days) => Number.isSafeInteger(days) && days >= 0 && days <= 365)
    && typeof value.paused === "boolean"
    && Number.isSafeInteger(value.revision) && value.revision >= 0
    && isTimestamp(value.updatedAt)
    && typeof value.createdBy === "string" && value.createdBy.length >= 1 && value.createdBy.length <= 60
    && typeof value.updatedBy === "string" && value.updatedBy.length >= 1 && value.updatedBy.length <= 60;
}

function normalizeOperation(value) {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION || value.kind !== OPERATION_KIND) return null;
  if (!isSafeId(value.accountId) || !isSafeId(value.ledgerId) || !isOperationId(value.operationId)) return null;
  if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) return null;
  if (!isTimestamp(value.createdAt) || (value.lastAttemptAt !== "" && !isTimestamp(value.lastAttemptAt))) return null;
  if (!Number.isSafeInteger(value.attemptCount) || value.attemptCount < 0 || value.attemptCount > MAX_ATTEMPTS) return null;
  if (!Array.isArray(value.subscriptions) || value.subscriptions.length > MAX_SUBSCRIPTIONS) return null;
  if (!value.subscriptions.every(validSubscription)) return null;
  if (new Set(value.subscriptions.map((subscription) => subscription.id)).size !== value.subscriptions.length) return null;

  const operation = {
    schemaVersion: SCHEMA_VERSION,
    kind: OPERATION_KIND,
    accountId: value.accountId,
    ledgerId: value.ledgerId,
    operationId: value.operationId.toLowerCase(),
    expectedRevision: value.expectedRevision,
    createdAt: value.createdAt,
    lastAttemptAt: value.lastAttemptAt,
    attemptCount: value.attemptCount,
    subscriptions: value.subscriptions.map((subscription) => ({ ...subscription, tags: [...subscription.tags], reminderLeadDays: [...subscription.reminderLeadDays] })),
  };
  return serializedBytes(operation) <= MAX_STORED_BYTES ? operation : null;
}

function readStore(storage) {
  let parsed;
  try {
    parsed = JSON.parse(storage.getItem(CLOUD_WRITE_OUTBOX_KEY) || "null");
  } catch {
    return [];
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.operations)) return [];

  const operations = [];
  const bindings = new Set();
  for (const candidate of parsed.operations.slice(0, MAX_OPERATIONS)) {
    const operation = normalizeOperation(candidate);
    if (!operation) continue;
    const binding = `${operation.accountId}:${operation.ledgerId}`;
    if (bindings.has(binding)) continue;
    bindings.add(binding);
    operations.push(operation);
  }
  return operations;
}

function writeStore(storage, operations) {
  const store = { schemaVersion: SCHEMA_VERSION, operations };
  if (serializedBytes(store) > MAX_STORED_BYTES) {
    throw new Error("The pending cloud change is too large for durable browser storage.");
  }
  const payload = JSON.stringify(store);
  storage.setItem(CLOUD_WRITE_OUTBOX_KEY, payload);
}

export function createCloudWriteOperation({ accountId, ledgerId, expectedRevision, subscriptions, operationId, now = new Date().toISOString() }) {
  const operation = normalizeOperation({
    schemaVersion: SCHEMA_VERSION,
    kind: OPERATION_KIND,
    accountId,
    ledgerId,
    operationId,
    expectedRevision,
    createdAt: now,
    lastAttemptAt: "",
    attemptCount: 0,
    subscriptions,
  });
  if (!operation) throw new Error("The pending cloud change is invalid and was not stored.");
  return operation;
}

export function markCloudWriteAttempt(operation, now = new Date().toISOString()) {
  const normalized = normalizeOperation(operation);
  if (!normalized || !isTimestamp(now) || normalized.attemptCount >= MAX_ATTEMPTS) {
    throw new Error("The pending cloud change cannot be retried safely.");
  }
  return { ...normalized, lastAttemptAt: now, attemptCount: normalized.attemptCount + 1 };
}

export function saveCloudWriteOperation(storage, operation) {
  const normalized = normalizeOperation(operation);
  if (!normalized) throw new Error("The pending cloud change is invalid and was not stored.");
  const operations = readStore(storage);
  const existingIndex = operations.findIndex((candidate) =>
    candidate.accountId === normalized.accountId && candidate.ledgerId === normalized.ledgerId
  );
  if (existingIndex >= 0 && operations[existingIndex].operationId !== normalized.operationId) {
    throw new Error("This cloud ledger already has a pending change.");
  }
  if (existingIndex >= 0) {
    const existing = operations[existingIndex];
    const immutableExisting = {
      schemaVersion: existing.schemaVersion,
      kind: existing.kind,
      accountId: existing.accountId,
      ledgerId: existing.ledgerId,
      operationId: existing.operationId,
      expectedRevision: existing.expectedRevision,
      createdAt: existing.createdAt,
      subscriptions: existing.subscriptions,
    };
    const immutableNext = {
      schemaVersion: normalized.schemaVersion,
      kind: normalized.kind,
      accountId: normalized.accountId,
      ledgerId: normalized.ledgerId,
      operationId: normalized.operationId,
      expectedRevision: normalized.expectedRevision,
      createdAt: normalized.createdAt,
      subscriptions: normalized.subscriptions,
    };
    if (JSON.stringify(immutableExisting) !== JSON.stringify(immutableNext) || normalized.attemptCount < existing.attemptCount) {
      throw new Error("A pending cloud operation must remain immutable between retries.");
    }
    operations[existingIndex] = normalized;
  } else {
    if (operations.length >= MAX_OPERATIONS) throw new Error("Too many cloud ledgers have pending changes on this browser.");
    operations.push(normalized);
  }
  writeStore(storage, operations);
  return normalized;
}

export function readCloudWriteOperation(storage, accountId, ledgerId) {
  if (!isSafeId(accountId) || !isSafeId(ledgerId)) return null;
  return readStore(storage).find((operation) => operation.accountId === accountId && operation.ledgerId === ledgerId) || null;
}

export function listAccountCloudWriteOperations(storage, accountId) {
  if (!isSafeId(accountId)) return [];
  return readStore(storage).filter((operation) => operation.accountId === accountId);
}

export function removeCloudWriteOperation(storage, accountId, ledgerId, operationId) {
  const operations = readStore(storage);
  const remaining = operations.filter((operation) => !(
    operation.accountId === accountId
    && operation.ledgerId === ledgerId
    && operation.operationId === String(operationId || "").toLowerCase()
  ));
  if (remaining.length === operations.length) return false;
  writeStore(storage, remaining);
  return true;
}

export function removeAccountCloudWriteOperations(storage, accountId) {
  const operations = readStore(storage);
  const remaining = operations.filter((operation) => operation.accountId !== accountId);
  if (remaining.length === operations.length) return 0;
  writeStore(storage, remaining);
  return operations.length - remaining.length;
}
