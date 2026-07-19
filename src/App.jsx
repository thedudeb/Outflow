import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { createEvents } from "ics";
import {
  acceptCloudLedgerInvitation,
  cloudConfigured,
  cloudConfigError,
  createProCheckout,
  deleteCloudAccount,
  getCloud,
  hostedCalendarFeedUrl,
  publishHostedCalendarFeed,
  readCloudLedgerAccess,
  readCloudLedgerSnapshot,
  readHostedCalendarFeed,
  readNotificationPreferences,
  readProEntitlement,
  readProOffer,
  renameCloudLedger,
  removeCloudLedgerMember,
  replaceCloudLedgerSnapshot,
  requestAccountLink,
  revokeCloudLedgerInvitation,
  revokeHostedCalendarFeed,
  saveHostedCalendarFeedOptions,
  sendCloudLedgerInvitation,
  saveNotificationPreferences,
  subscribeToCloudLedger,
  uploadGuestWorkspace,
  updateCloudLedgerMemberRole,
  verifyAccountSession,
} from "./cloud";
import {
  ACCOUNT_NUDGE_DISMISS_DAYS,
  ACCOUNT_NUDGE_OPEN_DAYS,
  accountNudgeIsDue,
  accountNudgeIsSnoozed,
  advanceAccountNudge,
  recordAccountNudgeActivity,
  sanitizeAccountNudge,
} from "./accountPrompt";
import {
  canToggleReminderLeadDay,
  canUseCsvImport,
  canUseCurrency,
  hasLifetimePro,
  restrictedDraftFeature,
} from "./featureAccess";

const STORAGE_KEY = "outflow:subscriptions";
const LEGACY_STORAGE_KEY = "drain:subscriptions";
const NOTIFIED_ALERTS_KEY = "outflow:notified-alerts";
const ALERT_SETTINGS_KEY = "outflow:alert-settings";
const LEDGER_META_KEY = "outflow:ledger-meta";
const WORKSPACE_KEY = "outflow:workspace";
const WORKSPACE_SCHEMA_VERSION = 1;
const BACKUP_SCHEMA_VERSION = 1;
const ACCOUNT_NUDGE_KEY = "outflow:account-nudge";

const colorTags = [
  { label: "Amber", value: "#f59e0b" },
  { label: "Red", value: "#ef4444" },
  { label: "Cyan", value: "#22d3ee" },
  { label: "Lime", value: "#84cc16" },
  { label: "Violet", value: "#8b5cf6" },
  { label: "Steel", value: "#94a3b8" },
];

const cycles = [
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "Yearly", value: "yearly" },
];

const validCycles = new Set(cycles.map((cycle) => cycle.value));
const validColors = new Set(colorTags.map((tag) => tag.value));
const ledgerKinds = [
  { label: "Household", value: "household" },
  { label: "Team", value: "team" },
];
const validLedgerKinds = new Set(["personal", ...ledgerKinds.map((kind) => kind.value)]);
const currencies = ["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "JPY", "CHF"];
const validCurrencies = new Set(currencies);
const reminderLeadOptions = [
  { label: "Same day", value: 0 },
  { label: "1 day before", value: 1 },
  { label: "3 days before", value: 3 },
  { label: "7 days before", value: 7 },
  { label: "14 days before", value: 14 },
  { label: "30 days before", value: 30 },
];
const validReminderLeadDays = new Set(reminderLeadOptions.map((option) => option.value));
const csvImportFields = [
  { key: "name", label: "Name", required: true, aliases: ["name", "subscription", "service"] },
  { key: "amount", label: "Amount", required: true, aliases: ["amount", "price", "cost"] },
  { key: "currency", label: "Currency", aliases: ["currency", "currencycode", "iso"] },
  { key: "cycle", label: "Billing cycle", required: true, aliases: ["cycle", "billingcycle", "frequency"] },
  { key: "nextBillingDate", label: "Next billing date", required: true, aliases: ["nextbillingdate", "nextdate", "billingdate"] },
  { key: "category", label: "Category", aliases: ["category", "group"] },
  { key: "tags", label: "Tags", aliases: ["tags", "labels"] },
  { key: "trialEndDate", label: "Trial end date", aliases: ["trialenddate", "trialends", "trialdate"] },
  { key: "reminderLeadDays", label: "Reminder lead days", aliases: ["reminderleaddays", "reminderdays", "alertdays", "reminder"] },
  { key: "paused", label: "Paused", aliases: ["paused", "status"] },
  { key: "color", label: "Color", aliases: ["color", "colour", "tagcolor"] },
];
const MAX_SUBSCRIPTIONS = 500;
const MAX_DATE_ADVANCES = 50000;
const MAX_TAGS = 10;
const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_CSV_ROWS = 1000;
const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const MAX_LEDGERS = 12;

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function preferredScrollBehavior() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function notificationTimezones() {
  const detected = browserTimezone();
  try {
    const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return [...new Set([detected, "UTC", ...supported])];
  } catch {
    return [detected, "UTC"];
  }
}

const availableNotificationTimezones = notificationTimezones();

function isTrackerHash(hash = window.location.hash) {
  return hash === "#app" || hash.startsWith("#app?");
}

function readInviteToken() {
  const hash = window.location.hash;
  const queryIndex = hash.indexOf("?");
  if (!isTrackerHash(hash) || queryIndex < 0) return "";
  const token = new URLSearchParams(hash.slice(queryIndex + 1)).get("invite") || "";
  return /^[a-zA-Z0-9_-]{40,128}$/.test(token) ? token : "";
}

function readProReturn() {
  const hash = window.location.hash;
  const queryIndex = hash.indexOf("?");
  if (!isTrackerHash(hash) || queryIndex < 0) return "";
  const status = new URLSearchParams(hash.slice(queryIndex + 1)).get("pro") || "";
  return ["success", "cancelled"].includes(status) ? status : "";
}

function clearTrackerHashParameter(name) {
  const queryIndex = window.location.hash.indexOf("?");
  if (queryIndex < 0) return;
  const params = new URLSearchParams(window.location.hash.slice(queryIndex + 1));
  params.delete(name);
  const query = params.toString();
  window.history.replaceState(null, "", query ? `#app?${query}` : "#app");
}

const seedSubscriptions = [
  {
    id: "netflix",
    name: "Netflix",
    amount: 15.49,
    currency: "USD",
    cycle: "monthly",
    nextBillingDate: "2026-05-24",
    category: "Streaming",
    tags: ["personal", "video"],
    color: "#ef4444",
    trialEndDate: "",
    reminderLeadDays: [7],
    paused: false,
  },
  {
    id: "spotify",
    name: "Spotify",
    amount: 10.99,
    currency: "USD",
    cycle: "monthly",
    nextBillingDate: "2026-05-29",
    category: "Music",
    tags: ["personal", "audio"],
    color: "#84cc16",
    trialEndDate: "2026-07-26",
    reminderLeadDays: [7, 1],
    paused: false,
  },
  {
    id: "icloud",
    name: "iCloud+",
    amount: 2.99,
    currency: "USD",
    cycle: "monthly",
    nextBillingDate: "2026-06-03",
    category: "Storage",
    tags: ["cloud"],
    color: "#22d3ee",
    trialEndDate: "",
    reminderLeadDays: [7],
    paused: false,
  },
  {
    id: "github",
    name: "GitHub Copilot",
    amount: 10,
    currency: "USD",
    cycle: "monthly",
    nextBillingDate: "2026-06-08",
    category: "Dev Tools",
    tags: ["work", "development"],
    color: "#94a3b8",
    trialEndDate: "",
    reminderLeadDays: [7, 1],
    paused: false,
  },
  {
    id: "notion",
    name: "Notion Plus",
    amount: 96,
    currency: "USD",
    cycle: "yearly",
    nextBillingDate: "2026-08-17",
    category: "Productivity",
    tags: ["work"],
    color: "#f59e0b",
    trialEndDate: "",
    reminderLeadDays: [14, 3],
    paused: true,
  },
];

const blankForm = {
  name: "",
  amount: "",
  currency: "USD",
  cycle: "monthly",
  nextBillingDate: toDateInput(new Date()),
  category: "",
  tags: "",
  color: colorTags[0].value,
  trialEndDate: "",
  reminderLeadDays: [7],
  paused: false,
};

function toDateInput(date) {
  const shifted = new Date(date);
  shifted.setMinutes(shifted.getMinutes() - shifted.getTimezoneOffset());
  return shifted.toISOString().slice(0, 10);
}

function parseDate(value) {
  return new Date(`${value}T00:00:00`);
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseDate(value);
  return Number.isFinite(parsed.getTime()) && toDateInput(parsed) === value;
}

function isValidTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function sanitizeReminderLeadDays(value, legacyValue) {
  const source = Array.isArray(value)
    ? value
    : value === "" || value == null
      ? legacyValue === "" || legacyValue == null
        ? [7]
        : Number(legacyValue) < 0
          ? []
          : [legacyValue]
      : String(value).split(/[|;,]/);

  return [...new Set(
    source
      .map(Number)
      .filter((days) => validReminderLeadDays.has(days)),
  )].sort((a, b) => b - a);
}

function sanitizeAlertSettings(value, permission = "default") {
  const source = value && typeof value === "object" ? value : {};
  const deviceRequested = typeof source.deviceEnabled === "boolean" ? source.deviceEnabled : permission === "granted";
  return {
    deviceEnabled: permission === "granted" && deviceRequested,
    includePausedSchedules: source.includePausedSchedules === true,
  };
}

function sanitizeLedgerMeta(value) {
  const source = value && typeof value === "object" ? value : {};
  const now = new Date().toISOString();
  const kind = validLedgerKinds.has(source.kind) ? source.kind : "personal";
  const fallbackName = kind === "household" ? "Household" : kind === "team" ? "Team" : "Personal";
  return {
    id: typeof source.id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(source.id) ? source.id : crypto.randomUUID(),
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim().slice(0, 60) : fallbackName,
    kind,
    storage: "local",
    createdAt: isValidTimestamp(source.createdAt) ? source.createdAt : now,
    updatedAt: isValidTimestamp(source.updatedAt) ? source.updatedAt : now,
  };
}

function sanitizeSubscription(value) {
  if (!value || typeof value !== "object") return null;

  const name = typeof value.name === "string" ? value.name.trim().slice(0, 100) : "";
  const amount = Number(value.amount);
  const currency = validCurrencies.has(value.currency) ? value.currency : "USD";
  const category = typeof value.category === "string" ? value.category.trim().slice(0, 60) : "Unsorted";
  const rawTags = Array.isArray(value.tags)
    ? value.tags
    : typeof value.tags === "string"
      ? value.tags.split(",")
      : [];
  const tags = [...new Set(
    rawTags
      .filter((tag) => typeof tag === "string")
      .map((tag) => tag.trim().toLowerCase().slice(0, 24))
      .filter(Boolean),
  )].slice(0, MAX_TAGS);
  const trialEndDate = value.trialEndDate === "" || value.trialEndDate == null
    ? ""
    : isValidDate(value.trialEndDate)
      ? value.trialEndDate
      : "";
  const reminderLeadDays = sanitizeReminderLeadDays(value.reminderLeadDays, value.reminderDays);
  const revision = Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0;
  const updatedAt = isValidTimestamp(value.updatedAt) ? value.updatedAt : new Date().toISOString();
  const createdBy = typeof value.createdBy === "string" && value.createdBy.trim()
    ? value.createdBy.trim().slice(0, 60)
    : "Local guest";
  const updatedBy = typeof value.updatedBy === "string" && value.updatedBy.trim()
    ? value.updatedBy.trim().slice(0, 60)
    : createdBy;

  if (
    !name ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 1000000000 ||
    !validCycles.has(value.cycle) ||
    !isValidDate(value.nextBillingDate)
  ) {
    return null;
  }

  return {
    id: typeof value.id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(value.id) ? value.id : crypto.randomUUID(),
    name,
    amount,
    currency,
    cycle: value.cycle,
    nextBillingDate: value.nextBillingDate,
    category: category || "Unsorted",
    tags,
    color: validColors.has(value.color) ? value.color : colorTags[0].value,
    trialEndDate,
    reminderLeadDays,
    paused: value.paused === true,
    revision,
    updatedAt,
    createdBy,
    updatedBy,
  };
}

function sanitizeSubscriptions(value) {
  if (!Array.isArray(value)) throw new TypeError("Stored subscriptions must be an array");
  return value.slice(0, MAX_SUBSCRIPTIONS).map(sanitizeSubscription).filter(Boolean);
}

function sanitizeWorkspace(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Workspace root must be an object.");
  if (value.schemaVersion !== WORKSPACE_SCHEMA_VERSION) throw new TypeError("Workspace version is not supported.");
  if (!Array.isArray(value.ledgers) || value.ledgers.length < 1 || value.ledgers.length > MAX_LEDGERS) {
    throw new TypeError(`A workspace must contain between 1 and ${MAX_LEDGERS} ledgers.`);
  }

  const ledgerIds = new Set();
  let personalLedgerCount = 0;
  const ledgers = value.ledgers.map((entry) => {
    if (!entry || typeof entry !== "object") throw new TypeError("Workspace ledger entries must be objects.");
    if (!entry.ledger || typeof entry.ledger.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(entry.ledger.id)) {
      throw new TypeError("Every workspace ledger must have a valid identifier.");
    }
    if (!validLedgerKinds.has(entry.ledger.kind)) throw new TypeError("Workspace ledger kind is invalid.");
    if (!Array.isArray(entry.subscriptions)) throw new TypeError("Every workspace ledger must have a subscription list.");
    if (entry.subscriptions.length > MAX_SUBSCRIPTIONS) {
      throw new TypeError(`A workspace ledger may contain at most ${MAX_SUBSCRIPTIONS} subscriptions.`);
    }
    if (
      entry.subscriptions.some(
        (subscription) => !subscription || typeof subscription.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(subscription.id),
      )
    ) {
      throw new TypeError("Every workspace subscription must have a valid identifier.");
    }
    if (new Set(entry.subscriptions.map((subscription) => subscription.id)).size !== entry.subscriptions.length) {
      throw new TypeError("Subscription identifiers must be unique within a ledger.");
    }
    const ledger = sanitizeLedgerMeta(entry.ledger);
    const subscriptions = entry.subscriptions.map(sanitizeSubscription);
    if (subscriptions.some((subscription) => !subscription)) {
      throw new TypeError("One or more workspace subscriptions are invalid.");
    }
    if (ledgerIds.has(ledger.id)) throw new TypeError("Workspace ledger identifiers must be unique.");
    ledgerIds.add(ledger.id);
    if (ledger.kind === "personal") personalLedgerCount += 1;
    return {
      ledger,
      subscriptions: subscriptions.map((subscription) => normalizeBillingDate(subscription)),
    };
  });
  if (personalLedgerCount !== 1) throw new TypeError("A workspace must contain exactly one personal ledger.");
  const activeLedgerId = ledgerIds.has(value.activeLedgerId) ? value.activeLedgerId : ledgers[0].ledger.id;

  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    activeLedgerId,
    ledgers,
  };
}

function sanitizeCloudLedgerSnapshot(value) {
  if (!value || typeof value !== "object" || !value.ledger || !Array.isArray(value.subscriptions)) {
    throw new TypeError("Cloud ledger snapshot is invalid.");
  }
  const source = value.ledger;
  if (typeof source.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(source.id)) {
    throw new TypeError("Cloud ledger identifier is invalid.");
  }
  if (!validLedgerKinds.has(source.kind) || typeof source.name !== "string" || !source.name.trim()) {
    throw new TypeError("Cloud ledger metadata is invalid.");
  }
  if (value.subscriptions.length > MAX_SUBSCRIPTIONS) throw new TypeError("Cloud ledger exceeds subscription capacity.");
  const subscriptions = value.subscriptions.map(sanitizeSubscription);
  if (subscriptions.some((subscription) => !subscription)) throw new TypeError("Cloud ledger contains an invalid subscription.");

  return {
    ledger: {
      id: source.id,
      name: source.name.trim().slice(0, 60),
      kind: source.kind,
      storage: "cloud",
      ownerId: source.ownerId,
      currentRole: ["owner", "editor", "viewer"].includes(source.currentRole) ? source.currentRole : "viewer",
      revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
      canSync: source.canSync === true,
      createdAt: isValidTimestamp(source.createdAt) ? source.createdAt : new Date().toISOString(),
      updatedAt: isValidTimestamp(source.updatedAt) ? source.updatedAt : new Date().toISOString(),
    },
    subscriptions: subscriptions.map((subscription) => normalizeBillingDate(subscription)),
  };
}

function loadWorkspace() {
  try {
    const storedWorkspace = localStorage.getItem(WORKSPACE_KEY);
    if (storedWorkspace) return sanitizeWorkspace(JSON.parse(storedWorkspace));
  } catch {
    // Fall through to the legacy single-ledger migration path.
  }

  let subscriptions;
  let ledger;
  try {
    const storedSubscriptions = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    subscriptions = sanitizeSubscriptions(storedSubscriptions ? JSON.parse(storedSubscriptions) : seedSubscriptions)
      .map((subscription) => normalizeBillingDate(subscription));
  } catch {
    subscriptions = sanitizeSubscriptions(seedSubscriptions).map((subscription) => normalizeBillingDate(subscription));
  }
  try {
    ledger = sanitizeLedgerMeta(JSON.parse(localStorage.getItem(LEDGER_META_KEY) || "null"));
  } catch {
    ledger = sanitizeLedgerMeta(null);
  }

  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    activeLedgerId: ledger.id,
    ledgers: [{ ledger, subscriptions }],
  };
}

function createLedgerBackup(ledger, subscriptions, alertSettings) {
  return {
    product: "Outflow",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    ledger: sanitizeLedgerMeta(ledger),
    alertSettings: {
      deviceEnabled: alertSettings.deviceEnabled === true,
      includePausedSchedules: alertSettings.includePausedSchedules === true,
    },
    subscriptions,
  };
}

function parseLedgerBackup(value, permission = "default") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Backup root must be an object.");
  if (value.product !== "Outflow") throw new TypeError("This is not an Outflow backup.");
  if (value.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new TypeError("This backup version is not supported.");
  if (!value.ledger || typeof value.ledger.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(value.ledger.id)) {
    throw new TypeError("The backup ledger identifier is invalid.");
  }
  if (!Array.isArray(value.subscriptions)) throw new TypeError("The backup has no subscription list.");
  if (value.subscriptions.length > MAX_SUBSCRIPTIONS) throw new TypeError(`Backups may contain at most ${MAX_SUBSCRIPTIONS} subscriptions.`);
  if (
    value.subscriptions.some(
      (subscription) => !subscription || typeof subscription.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(subscription.id),
    )
  ) {
    throw new TypeError("Every backup subscription must have an identifier.");
  }
  if (new Set(value.subscriptions.map((subscription) => subscription.id)).size !== value.subscriptions.length) {
    throw new TypeError("Backup subscription identifiers must be unique.");
  }

  const subscriptions = value.subscriptions.map(sanitizeSubscription);
  if (subscriptions.some((subscription) => !subscription)) throw new TypeError("One or more backup subscriptions are invalid.");

  return {
    exportedAt: typeof value.exportedAt === "string" && Number.isFinite(Date.parse(value.exportedAt)) ? value.exportedAt : "",
    ledger: sanitizeLedgerMeta(value.ledger),
    alertSettings: sanitizeAlertSettings(value.alertSettings, permission),
    subscriptions,
  };
}

function clampedCalendarDate(year, month, day) {
  const target = new Date(year, month, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

function addCycle(date, cycle, anchorDay = date.getDate(), anchorMonth = date.getMonth()) {
  if (cycle === "weekly") {
    const next = new Date(date);
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (cycle === "monthly") {
    return clampedCalendarDate(date.getFullYear(), date.getMonth() + 1, anchorDay);
  }
  if (cycle === "yearly") {
    return clampedCalendarDate(date.getFullYear() + 1, anchorMonth, anchorDay);
  }
  return new Date(date);
}

function normalizeBillingDate(subscription, today = new Date()) {
  if (subscription.paused) return subscription;
  if (!validCycles.has(subscription.cycle) || !isValidDate(subscription.nextBillingDate)) return subscription;

  const startOfToday = parseDate(toDateInput(today));
  let nextDate = parseDate(subscription.nextBillingDate);
  const anchorDay = nextDate.getDate();
  const anchorMonth = nextDate.getMonth();
  let advances = 0;

  while (nextDate < startOfToday && advances < MAX_DATE_ADVANCES) {
    nextDate = addCycle(nextDate, subscription.cycle, anchorDay, anchorMonth);
    advances += 1;
  }

  if (nextDate < startOfToday) return subscription;

  const normalizedDate = toDateInput(nextDate);
  return normalizedDate === subscription.nextBillingDate
    ? subscription
    : {
        ...subscription,
        nextBillingDate: normalizedDate,
        revision: subscription.revision + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: "Outflow",
      };
}

function daysBetween(start, end) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((parseDate(end) - parseDate(start)) / msPerDay);
}

function monthlyEquivalent(subscription) {
  const amount = Number(subscription.amount) || 0;
  if (subscription.cycle === "weekly") return (amount * 52) / 12;
  if (subscription.cycle === "yearly") return amount / 12;
  return amount;
}

function money(value, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: validCurrencies.has(currency) ? currency : "USD",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function stripeMoney(unitAmount, currency = "USD") {
  const normalizedCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: normalizedCurrency });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format((Number(unitAmount) || 0) / (10 ** fractionDigits));
}

function totalsByCurrency(items, amountFor = (item) => item.amount) {
  const totals = new Map();
  items.forEach((item) => {
    const currency = validCurrencies.has(item.currency) ? item.currency : "USD";
    totals.set(currency, (totals.get(currency) || 0) + Number(amountFor(item) || 0));
  });
  return [...totals.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function scaleCurrencyTotals(totals, factor) {
  return totals.map((entry) => ({ ...entry, total: entry.total * factor }));
}

function formatCurrencyTotals(totals, fallbackCurrency = "USD") {
  if (!totals.length) return money(0, fallbackCurrency);
  return totals.map((entry) => money(entry.total, entry.currency)).join(" + ");
}

function shortDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
  }).format(parseDate(value));
}

function fullDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "2-digit",
  }).format(parseDate(value));
}

function buildSchedule(subscriptions, startValue, endValue) {
  if (!isValidDate(startValue) || !isValidDate(endValue)) return [];

  const startDate = parseDate(startValue);
  const endDate = parseDate(endValue);
  if (startDate > endDate) return [];

  return subscriptions
    .filter((subscription) => !subscription.paused)
    .flatMap((subscription) => {
      if (!validCycles.has(subscription.cycle) || !isValidDate(subscription.nextBillingDate)) return [];

      const events = [];
      let eventDate = parseDate(subscription.nextBillingDate);
      const anchorDay = eventDate.getDate();
      const anchorMonth = eventDate.getMonth();
      let eventCount = 0;

      while (eventDate < startDate && eventCount < MAX_DATE_ADVANCES) {
        eventDate = addCycle(eventDate, subscription.cycle, anchorDay, anchorMonth);
        eventCount += 1;
      }

      while (eventDate <= endDate && eventCount < MAX_DATE_ADVANCES) {
        const date = toDateInput(eventDate);
        events.push({
          ...subscription,
          eventId: `${subscription.id}-${date}`,
          date,
        });
        eventDate = addCycle(eventDate, subscription.cycle, anchorDay, anchorMonth);
        eventCount += 1;
      }

      return events;
    })
    .sort((a, b) => parseDate(a.date) - parseDate(b.date) || a.name.localeCompare(b.name));
}

function buildTimeline(subscriptions, days = 30) {
  const today = toDateInput(new Date());
  const endDate = parseDate(today);
  endDate.setDate(endDate.getDate() + days);

  return buildSchedule(subscriptions, today, toDateInput(endDate)).map((event) => ({
    ...event,
    daysOut: daysBetween(today, event.date),
  }));
}

function monthLabel(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function monthBounds(date) {
  return {
    start: toDateInput(new Date(date.getFullYear(), date.getMonth(), 1)),
    end: toDateInput(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  };
}

function calendarDays(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

function weeklyForecast(events, days) {
  const today = parseDate(toDateInput(new Date()));
  const bucketCount = Math.ceil((days + 1) / 7);

  return Array.from({ length: bucketCount }, (_, index) => {
    const start = new Date(today);
    start.setDate(start.getDate() + index * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const bucketEvents = events.filter((event) => Math.floor(event.daysOut / 7) === index);
    return {
      id: `${toDateInput(start)}-${toDateInput(end)}`,
      label: `${shortDate(toDateInput(start))}-${shortDate(toDateInput(end))}`,
      totals: totalsByCurrency(bucketEvents),
      count: bucketEvents.length,
    };
  });
}

function buildAlerts(subscriptions, includePausedSchedules = false, today = toDateInput(new Date())) {
  return subscriptions
    .filter((subscription) => (!subscription.paused || includePausedSchedules) && subscription.reminderLeadDays.length > 0)
    .flatMap((subscription) => {
      const alerts = [];
      const chargeDays = daysBetween(today, subscription.nextBillingDate);

      if (chargeDays >= 0 && subscription.reminderLeadDays.includes(chargeDays)) {
        alerts.push({
          id: `charge-${subscription.id}-${subscription.nextBillingDate}-${chargeDays}`,
          type: "charge",
          name: subscription.name,
          date: subscription.nextBillingDate,
          daysOut: chargeDays,
          leadDays: chargeDays,
          amount: subscription.amount,
          currency: subscription.currency,
          color: subscription.color,
          paused: subscription.paused,
        });
      }

      if (subscription.trialEndDate) {
        const trialDays = daysBetween(today, subscription.trialEndDate);
        if (trialDays >= 0 && subscription.reminderLeadDays.includes(trialDays)) {
          alerts.push({
            id: `trial-${subscription.id}-${subscription.trialEndDate}-${trialDays}`,
            type: "trial",
            name: subscription.name,
            date: subscription.trialEndDate,
            daysOut: trialDays,
            leadDays: trialDays,
            amount: subscription.amount,
            currency: subscription.currency,
            color: subscription.color,
            paused: subscription.paused,
          });
        }
      }

      return alerts;
    })
    .sort((a, b) => a.daysOut - b.daysOut || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function subscriptionsToCsv(subscriptions) {
  const columns = [
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
    "createdBy",
    "updatedBy",
    "updatedAt",
  ];
  const rows = subscriptions.map((subscription) => [
    subscription.name,
    subscription.amount,
    subscription.currency,
    subscription.cycle,
    subscription.nextBillingDate,
    subscription.category,
    subscription.tags.join("|"),
    subscription.color,
    subscription.trialEndDate,
    subscription.reminderLeadDays.join("|"),
    subscription.paused,
    subscription.createdBy,
    subscription.updatedBy,
    subscription.updatedAt,
  ]);

  return [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function normalizedHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function guessCsvMapping(headers) {
  return Object.fromEntries(csvImportFields.map((field) => {
    const match = headers.find((header) => field.aliases.includes(normalizedHeader(header)));
    return [field.key, match || ""];
  }));
}

function normalizeCsvDate(value) {
  const text = String(value || "").trim();
  if (isValidDate(text)) return text;

  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return "";
  const [, month, day, year] = match;
  const normalized = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isValidDate(normalized) ? normalized : "";
}

function normalizeCsvCycle(value) {
  const text = normalizedHeader(value);
  if (["weekly", "week", "wk"].includes(text)) return "weekly";
  if (["monthly", "month", "mo"].includes(text)) return "monthly";
  if (["yearly", "annual", "annually", "year", "yr"].includes(text)) return "yearly";
  return "";
}

function normalizeCsvBoolean(value) {
  return ["true", "yes", "1", "paused"].includes(String(value || "").trim().toLowerCase());
}

function importDuplicateKey(subscription) {
  return `${subscription.name.toLowerCase()}|${Number(subscription.amount).toFixed(4)}|${subscription.currency}|${subscription.cycle}`;
}

function buildCsvCandidates(rows, mapping, existingSubscriptions) {
  const existingKeys = new Set(existingSubscriptions.map(importDuplicateKey));
  const fileKeys = new Set();

  return rows.slice(0, MAX_CSV_ROWS).map((row, index) => {
    const value = (key) => mapping[key] ? row[mapping[key]] : "";
    const amountText = String(value("amount") || "").replace(/[^0-9.-]/g, "");
    const amount = Number(amountText);
    const currencyText = String(value("currency") || "USD").trim().toUpperCase();
    const currency = validCurrencies.has(currencyText) ? currencyText : "";
    const cycle = normalizeCsvCycle(value("cycle"));
    const nextBillingDate = normalizeCsvDate(value("nextBillingDate"));
    const trialText = String(value("trialEndDate") || "").trim();
    const trialEndDate = trialText ? normalizeCsvDate(trialText) : "";
    const reminderText = String(value("reminderLeadDays") || "").trim();
    const reminderParts = reminderText.split(/[|;,]/).map((days) => days.trim());
    const reminderValues = reminderParts.map(Number);
    const reminderOff = ["off", "-1"].includes(reminderText.toLowerCase());
    const reminderLeadDays = reminderOff
      ? []
      : sanitizeReminderLeadDays(reminderText, reminderText === "" ? 7 : null);
    const errors = [];

    if (!String(value("name") || "").trim()) errors.push("Missing name");
    if (!Number.isFinite(amount) || amount <= 0) errors.push("Invalid amount");
    if (!currency) errors.push("Unsupported currency");
    if (!cycle) errors.push("Invalid billing cycle");
    if (!nextBillingDate) errors.push("Invalid next billing date");
    if (trialText && !trialEndDate) errors.push("Invalid trial end date");
    if (
      reminderText &&
      !reminderOff &&
      reminderValues.some((days, index) => !reminderParts[index] || !validReminderLeadDays.has(days))
    ) errors.push("Invalid reminder lead days");

    const subscription = errors.length ? null : sanitizeSubscription({
      id: crypto.randomUUID(),
      name: value("name"),
      amount,
      currency,
      cycle,
      nextBillingDate,
      category: value("category") || "Unsorted",
      tags: String(value("tags") || "").split(/[|;,]/),
      color: value("color"),
      trialEndDate,
      reminderLeadDays,
      paused: normalizeCsvBoolean(value("paused")),
    });

    const key = subscription ? importDuplicateKey(subscription) : "";
    const duplicate = Boolean(key && (existingKeys.has(key) || fileKeys.has(key)));
    if (key) fileKeys.add(key);

    return {
      rowNumber: index + 2,
      subscription,
      errors: subscription ? errors : errors.length ? errors : ["Invalid row"],
      duplicate,
    };
  });
}

function dayLabel(daysOut) {
  if (daysOut === 0) return "today";
  if (daysOut === 1) return "tomorrow";
  return `${daysOut} days`;
}

function reminderLeadLabel(days) {
  if (!days.length) return "off";
  return days.map((value) => value === 0 ? "day-of" : `${value}d`).join(" / ");
}

function ledgerKindLabel(kind) {
  if (kind === "household") return "Household";
  if (kind === "team") return "Team";
  return "Personal";
}

function calendarDateParts(value) {
  const date = parseDate(value);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

function subscriptionCalendarEvent(subscription, ledger) {
  const endDate = parseDate(subscription.nextBillingDate);
  endDate.setDate(endDate.getDate() + 1);
  const recurrenceRule = {
    weekly: "FREQ=WEEKLY",
    monthly: "FREQ=MONTHLY",
    yearly: "FREQ=YEARLY",
  }[subscription.cycle];
  const ledgerContext = `${ledger.name} / ${ledger.kind} ${ledger.storage} ledger`;

  return {
    productId: "Outflow Subscription Tracker",
    calName: `Outflow / ${ledger.name}`,
    uid: `${subscription.id}.${ledger.id}@outflow.local`,
    sequence: subscription.revision,
    start: calendarDateParts(subscription.nextBillingDate),
    end: [endDate.getFullYear(), endDate.getMonth() + 1, endDate.getDate()],
    title: `${subscription.name} / ${money(subscription.amount, subscription.currency)}`,
    description: `${subscription.paused ? "Paused schedule / " : ""}${subscription.cycle} charge / ${ledgerContext}`,
    categories: ["Outflow", subscription.category],
    status: subscription.paused ? "TENTATIVE" : "CONFIRMED",
    busyStatus: "FREE",
    transp: "TRANSPARENT",
    classification: "PRIVATE",
    recurrenceRule,
    lastModified: new Date(subscription.updatedAt).getTime(),
  };
}

function createSubscriptionCalendar(subscriptions, ledger) {
  return createEvents(
    subscriptions.map((subscription) => subscriptionCalendarEvent(subscription, ledger)),
    {
      productId: "Outflow Subscription Tracker",
      calName: `Outflow / ${ledger.name}`,
      method: "PUBLISH",
    },
  );
}

function initials(name) {
  return name
    .split(/\s|\+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function Panel({ title, marker, action, children, className = "" }) {
  return (
    <section className={`border border-zinc-800 bg-black/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${className}`}>
      <header className="flex min-h-10 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/70 px-3">
        <div className="flex min-w-0 items-center gap-2">
          {marker && <span className="h-3 w-1 shrink-0 bg-amber-400" />}
          <h2 className="truncate text-[11px] font-black uppercase tracking-[0.18em] text-zinc-300">{title}</h2>
        </div>
        <div className="min-w-0 shrink truncate text-right">{action}</div>
      </header>
      {children}
    </section>
  );
}

function StatCell({ label, value, sublabel, tone = "neutral", code }) {
  const toneClass = tone === "hot" ? "text-amber-300" : "text-zinc-50";

  return (
    <section className="relative border border-zinc-800 bg-black/85 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
        {code && <div className="font-mono text-[10px] text-zinc-600">{code}</div>}
      </div>
      <div className={`mt-3 break-words font-mono text-xl font-black leading-tight sm:text-2xl xl:text-3xl ${toneClass}`}>{value}</div>
      <div className="mt-2 border-t border-zinc-900 pt-2 text-xs text-zinc-500">{sublabel}</div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="grid gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
      {label}
      {children}
    </label>
  );
}

function LiveMessage({ kind = "status", className = "", children, ...props }) {
  const alert = kind === "alert";
  return (
    <div
      role={alert ? "alert" : "status"}
      aria-live={alert ? "assertive" : "polite"}
      aria-atomic="true"
      className={className}
      {...props}
    >
      {children}
    </div>
  );
}

const dialogFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function useDialogLifecycle(open, onClose, closeDisabled = false) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const overlay = dialog.parentElement;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const backgroundNodes = overlay?.parentElement
      ? [...overlay.parentElement.children]
        .filter((node) => node !== overlay)
        .map((node) => ({ node, inert: node.hasAttribute("inert"), ariaHidden: node.getAttribute("aria-hidden") }))
      : [];

    const focusableElements = () => [...dialog.querySelectorAll(dialogFocusableSelector)]
      .filter((element) => element instanceof HTMLElement && element.getClientRects().length > 0);
    const initialFocus = dialog.querySelector("[data-dialog-initial-focus]") || focusableElements()[0] || dialog;
    initialFocus.focus({ preventScroll: true });
    document.body.style.overflow = "hidden";
    backgroundNodes.forEach(({ node }) => {
      node.setAttribute("inert", "");
      node.setAttribute("aria-hidden", "true");
    });

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (closeDisabledRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      backgroundNodes.forEach(({ node, inert, ariaHidden }) => {
        if (!inert) node.removeAttribute("inert");
        if (ariaHidden === null) node.removeAttribute("aria-hidden");
        else node.setAttribute("aria-hidden", ariaHidden);
      });
      window.requestAnimationFrame(() => {
        if (!document.querySelector('[role="dialog"][aria-modal="true"]') && returnFocus?.isConnected) {
          returnFocus.focus({ preventScroll: true });
        }
      });
    };
  }, [open]);

  return dialogRef;
}

function useInstallableApp() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [waitingWorker, setWaitingWorker] = useState(null);
  const [standalone, setStandalone] = useState(() => window.matchMedia("(display-mode: standalone)").matches);
  const [offlineReady, setOfflineReady] = useState(() => Boolean(navigator.serviceWorker?.controller));
  const reloadForUpdate = useRef(false);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setStandalone(true);
    };
    const handleControllerChange = () => {
      setOfflineReady(Boolean(navigator.serviceWorker.controller));
      if (reloadForUpdate.current) window.location.reload();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
      navigator.serviceWorker.register("/sw.js").then((registration) => {
        if (registration.waiting) setWaitingWorker(registration.waiting);
        navigator.serviceWorker.ready.then(() => setOfflineReady(Boolean(navigator.serviceWorker.controller)));
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setWaitingWorker(worker);
          });
        });
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      navigator.serviceWorker?.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  async function install() {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
    return choice.outcome === "accepted";
  }

  function applyUpdate() {
    if (!waitingWorker) return;
    reloadForUpdate.current = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }

  return {
    online,
    standalone,
    offlineReady,
    canInstall: Boolean(installPrompt) && !standalone,
    updateAvailable: Boolean(waitingWorker),
    install,
    applyUpdate,
  };
}

function LandingPage({ onOpen, pwa }) {
  const previewSubscriptions = seedSubscriptions.filter((subscription) => !subscription.paused).slice(0, 4);

  return (
    <main className="min-h-screen bg-[#08090a] text-zinc-100">
      <nav className="relative z-20 border-b border-zinc-800 bg-black">
        <div className="mx-auto flex h-14 max-w-[1560px] items-center justify-between px-4 sm:px-6">
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: preferredScrollBehavior() })} className="text-lg font-black uppercase text-white">
            Outflow
          </button>
          <div className="flex items-center gap-5 text-xs font-bold uppercase text-zinc-500">
            <a href="#system" className="hidden hover:text-zinc-100 sm:block">System</a>
            <a href="#principles" className="hidden hover:text-zinc-100 sm:block">Principles</a>
            {pwa.canInstall && (
              <button type="button" onClick={pwa.install} className="hidden border border-zinc-700 px-3 py-2 text-zinc-300 hover:border-zinc-400 hover:text-white sm:block">
                Install
              </button>
            )}
            <button type="button" onClick={onOpen} className="border border-amber-400 bg-amber-400 px-3 py-2 text-black hover:bg-amber-300">
              Open tracker
            </button>
          </div>
        </div>
      </nav>

      <section className="relative min-h-[480px] overflow-hidden border-b border-zinc-800 min-[360px]:min-h-[560px] sm:min-h-[calc(100svh-96px)] sm:max-h-[780px]">
        <div className="absolute inset-0 grid content-center gap-5 px-3 opacity-25 sm:px-8" aria-hidden="true">
          {previewSubscriptions.map((subscription) => (
            <div key={subscription.id} className="grid min-h-28 gap-3 sm:grid-cols-[220px_minmax(0,1fr)_280px]">
              <div className="border border-violet-400 bg-violet-950 p-4">
                <div className="font-mono text-2xl font-black text-violet-100">{money(subscription.amount, subscription.currency)}</div>
                <div className="mt-6 text-xs uppercase text-violet-300">{initials(subscription.name)} / {subscription.cycle}</div>
              </div>
              <div className="hidden border border-red-400 bg-red-950 p-4 sm:block">
                <div className="text-xl font-black uppercase text-red-50">{subscription.name}</div>
                <div className="mt-8 text-xs uppercase text-red-300">{subscription.category}</div>
              </div>
              <div className="hidden border border-emerald-400 bg-emerald-950 p-4 sm:block">
                <div className="font-mono text-2xl font-black text-emerald-100">{money(subscription.amount, subscription.currency)}</div>
                <div className="mt-6 text-xs uppercase text-emerald-300">{shortDate(subscription.nextBillingDate)}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="absolute inset-0 bg-black/75" aria-hidden="true" />

        <div className="relative z-10 mx-auto flex min-h-[480px] max-w-[1560px] items-center px-4 py-5 min-[360px]:min-h-[560px] sm:min-h-[calc(100svh-96px)] sm:max-h-[780px] sm:px-6 sm:py-10">
          <div className="min-w-0 max-w-3xl">
            <div className="mb-3 flex items-center gap-3 font-mono text-[10px] uppercase text-amber-300 sm:mb-4 sm:text-xs">
              <span className="h-3 w-1 bg-amber-400" />
              Personal recurring debit monitor
            </div>
            <h1 className="text-[48px] font-black uppercase leading-[0.9] text-white min-[360px]:text-6xl sm:text-8xl lg:text-9xl">Outflow</h1>
            <p className="mt-4 max-w-2xl text-base leading-6 text-zinc-300 sm:mt-6 sm:text-xl sm:leading-7">
              Know what is leaving your account, how much it costs, and exactly when it lands. One clear ledger for every recurring charge.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:mt-8 sm:flex sm:flex-wrap sm:gap-3">
              <button type="button" onClick={onOpen} className="border border-amber-400 bg-amber-400 px-2 py-3 text-[11px] font-black uppercase text-black hover:bg-amber-300 sm:px-5 sm:text-sm">
                Open your ledger
              </button>
              <a href="#system" className="border border-zinc-600 bg-black/70 px-2 py-3 text-center text-[11px] font-black uppercase text-zinc-200 hover:border-zinc-300 sm:px-5 sm:text-sm">
                See the system
              </a>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 border-t border-zinc-700 pt-3 font-mono text-[10px] uppercase text-zinc-500 sm:mt-9 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-3 sm:pt-4 sm:text-xs">
              <span><b className="text-zinc-200">Local</b> by default</span>
              <span><b className="text-zinc-200">Zero</b> accounts</span>
              <span><b className="text-zinc-200">One</b> honest number</span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-zinc-800 bg-amber-400 text-black">
        <div className="mx-auto grid max-w-[1560px] gap-1 px-4 py-4 font-mono text-xs uppercase sm:grid-cols-3 sm:px-6">
          <div><span className="font-black">01</span> See the monthly total</div>
          <div><span className="font-black">02</span> Read the next withdrawal</div>
          <div><span className="font-black">03</span> Control every subscription</div>
        </div>
      </section>

      <section id="system" className="border-b border-zinc-800 bg-[#0c0d0e] py-16 sm:py-24">
        <div className="mx-auto max-w-[1560px] px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div>
              <div className="font-mono text-xs uppercase text-amber-300">The system</div>
              <h2 className="mt-3 text-3xl font-black uppercase leading-tight text-white sm:text-4xl">Every charge, read left to right.</h2>
              <p className="mt-4 leading-7 text-zinc-500">Identity. Subscription. Withdrawal. Nothing hidden behind menus or charts.</p>
            </div>

            <div className="grid gap-3">
              {previewSubscriptions.slice(0, 3).map((subscription) => (
                <div key={subscription.id} className="grid gap-2 border border-zinc-800 bg-black p-2 lg:grid-cols-[220px_minmax(0,1fr)_280px] lg:gap-3">
                  <div className="border border-violet-500/60 bg-violet-950/50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="grid h-10 w-10 place-items-center border border-violet-300 bg-black font-mono font-black text-violet-100">{initials(subscription.name)}</span>
                      <span className="font-mono text-xl font-black text-violet-100">{money(subscription.amount, subscription.currency)}</span>
                    </div>
                  </div>
                  <div className="border border-red-500/60 bg-red-950/50 p-4">
                    <div className="text-lg font-black uppercase text-red-50">{subscription.name}</div>
                    <div className="mt-2 text-xs uppercase text-red-300/70">{subscription.category} / {subscription.cycle}</div>
                  </div>
                  <div className="border border-emerald-500/60 bg-emerald-950/50 p-4">
                    <div className="font-mono text-xl font-black text-emerald-100">{money(subscription.amount, subscription.currency)}</div>
                    <div className="mt-2 text-xs uppercase text-emerald-300/70">Pulls {shortDate(subscription.nextBillingDate)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="principles" className="border-b border-zinc-800 bg-black py-16 sm:py-24">
        <div className="mx-auto max-w-[1560px] px-4 sm:px-6">
          <div className="max-w-2xl">
            <div className="font-mono text-xs uppercase text-amber-300">Built for clarity</div>
            <h2 className="mt-3 text-3xl font-black uppercase text-white sm:text-4xl">A finance tool that stays out of your way.</h2>
          </div>
          <div className="mt-10 grid border border-zinc-800 md:grid-cols-3">
            {[
              ["Local first", "Your subscription data stays in this browser. No account or external service required."],
              ["Date aware", "Weekly, monthly, and yearly charges roll forward automatically when billing dates pass."],
              ["Action ready", "Pause, edit, or remove a subscription directly from the ledger whenever plans change."],
            ].map(([title, copy], index) => (
              <div key={title} className="border-b border-zinc-800 p-5 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
                <div className="font-mono text-xs text-zinc-600">0{index + 1}</div>
                <h3 className="mt-8 text-lg font-black uppercase text-zinc-100">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-500">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-amber-400 py-14 text-black">
        <div className="mx-auto flex max-w-[1560px] flex-col items-start justify-between gap-6 px-4 sm:flex-row sm:items-center sm:px-6">
          <div>
            <div className="font-mono text-xs uppercase">Your money is already moving.</div>
            <h2 className="mt-2 text-3xl font-black uppercase">See where it goes.</h2>
          </div>
          <button type="button" onClick={onOpen} className="border border-black bg-black px-5 py-3 text-sm font-black uppercase text-white hover:bg-zinc-900">
            Open Outflow
          </button>
        </div>
      </section>

      <footer className="border-t border-zinc-800 bg-black">
        <div className="mx-auto flex max-w-[1560px] items-center justify-between px-4 py-5 text-xs uppercase text-zinc-600 sm:px-6">
          <span className="font-black text-zinc-300">Outflow</span>
          <span>Recurring debit monitor</span>
        </div>
      </footer>
    </main>
  );
}

function Tracker({ onExit, pwa }) {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [cloudLedgerSession, setCloudLedgerSession] = useState(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState("off");
  const [cloudSyncMessage, setCloudSyncMessage] = useState("");
  const [cloudRemotePending, setCloudRemotePending] = useState(false);
  const [cloudLedgerNameDraft, setCloudLedgerNameDraft] = useState("");
  const cloudSyncingRef = useRef(false);
  const localActiveLedgerRecord = workspace.ledgers.find((entry) => entry.ledger.id === workspace.activeLedgerId) || workspace.ledgers[0];
  const activeLedgerRecord = cloudLedgerSession || localActiveLedgerRecord;
  const ledgerMeta = activeLedgerRecord.ledger;
  const subscriptions = activeLedgerRecord.subscriptions;
  const usingCloudLedger = ledgerMeta.storage === "cloud";
  const cloudLedgerWriteDisabled = usingCloudLedger && (
    !ledgerMeta.canSync
    || cloudSyncingRef.current
    || cloudRemotePending
    || ["loading", "syncing", "refreshing", "stale", "conflict"].includes(cloudSyncStatus)
  );
  const cloudLedgerCanRename = usingCloudLedger
    && ledgerMeta.currentRole === "owner"
    && ledgerMeta.canSync
    && !cloudSyncingRef.current
    && !cloudRemotePending
    && !["loading", "syncing", "refreshing", "stale", "conflict"].includes(cloudSyncStatus);

  function setSubscriptions(nextSubscriptions) {
    if (cloudLedgerSession) {
      if (cloudLedgerWriteDisabled) return;
      const next = typeof nextSubscriptions === "function"
        ? nextSubscriptions(cloudLedgerSession.subscriptions)
        : nextSubscriptions;
      commitCloudSubscriptions(next);
      return;
    }
    setWorkspace((current) => ({
      ...current,
      ledgers: current.ledgers.map((entry) => {
        if (entry.ledger.id !== current.activeLedgerId) return entry;
        const next = typeof nextSubscriptions === "function"
          ? nextSubscriptions(entry.subscriptions)
          : nextSubscriptions;
        return {
          ledger: { ...entry.ledger, updatedAt: new Date().toISOString() },
          subscriptions: next,
        };
      }),
    }));
  }

  function setLedgerMeta(nextLedger) {
    if (cloudLedgerSession) return;
    setWorkspace((current) => ({
      ...current,
      ledgers: current.ledgers.map((entry) => {
        if (entry.ledger.id !== current.activeLedgerId) return entry;
        const next = typeof nextLedger === "function" ? nextLedger(entry.ledger) : nextLedger;
        return { ...entry, ledger: next };
      }),
    }));
  }

  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [newLedgerName, setNewLedgerName] = useState("");
  const [newLedgerKind, setNewLedgerKind] = useState("household");
  const [deleteLedgerId, setDeleteLedgerId] = useState(null);
  const [backupSession, setBackupSession] = useState(null);
  const [backupError, setBackupError] = useState("");
  const [backupLoading, setBackupLoading] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountPromptContext, setAccountPromptContext] = useState("");
  const [accountEntryContext, setAccountEntryContext] = useState("");
  const [accountNudge, setAccountNudge] = useState(() => {
    try {
      return sanitizeAccountNudge(JSON.parse(localStorage.getItem(ACCOUNT_NUDGE_KEY) || "null"));
    } catch {
      return sanitizeAccountNudge(null);
    }
  });
  const [accountEmail, setAccountEmail] = useState("");
  const [accountSession, setAccountSession] = useState(null);
  const [accountEntitlement, setAccountEntitlement] = useState(null);
  const [accountEntitlementLoading, setAccountEntitlementLoading] = useState(false);
  const [emailPreferences, setEmailPreferences] = useState(() => ({
    emailEnabled: false,
    pausedScheduleEnabled: false,
    timezone: browserTimezone(),
  }));
  const [emailPreferencesLoading, setEmailPreferencesLoading] = useState(false);
  const [proOffer, setProOffer] = useState(null);
  const [proOfferLoading, setProOfferLoading] = useState(false);
  const [proOfferError, setProOfferError] = useState("");
  const [proReturn, setProReturn] = useState(readProReturn);
  const [cloudLedgers, setCloudLedgers] = useState([]);
  const [cloudLedgersLoading, setCloudLedgersLoading] = useState(false);
  const [cloudAccessRefresh, setCloudAccessRefresh] = useState(0);
  const [cloudOpenId, setCloudOpenId] = useState("");
  const [managedCloudLedgerId, setManagedCloudLedgerId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [pendingInviteToken, setPendingInviteToken] = useState(readInviteToken);
  const [removeMemberArmed, setRemoveMemberArmed] = useState("");
  const [revokeInviteArmed, setRevokeInviteArmed] = useState("");
  const [cloudClient, setCloudClient] = useState(null);
  const [accountLoading, setAccountLoading] = useState(cloudConfigured);
  const [accountBusy, setAccountBusy] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [accountError, setAccountError] = useState("");
  const [deleteAccountArmed, setDeleteAccountArmed] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [editingId, setEditingId] = useState(null);
  const [forecastHorizon, setForecastHorizon] = useState(30);
  const [notificationPermission, setNotificationPermission] = useState(() =>
    typeof window !== "undefined" && "Notification" in window ? window.Notification.permission : "unsupported",
  );
  const [alertSettings, setAlertSettings] = useState(() => {
    const permission = typeof window !== "undefined" && "Notification" in window ? window.Notification.permission : "unsupported";
    try {
      return sanitizeAlertSettings(JSON.parse(localStorage.getItem(ALERT_SETTINGS_KEY) || "null"), permission);
    } catch {
      return sanitizeAlertSettings(null, permission);
    }
  });
  const [alertSettingsOpen, setAlertSettingsOpen] = useState(false);
  const [deviceAlertStatus, setDeviceAlertStatus] = useState({ kind: "status", message: "" });
  const [calendarExportOpen, setCalendarExportOpen] = useState(false);
  const [includePausedCalendar, setIncludePausedCalendar] = useState(false);
  const [calendarExportError, setCalendarExportError] = useState("");
  const [calendarFeed, setCalendarFeed] = useState(null);
  const [calendarFeedLoading, setCalendarFeedLoading] = useState(false);
  const [calendarFeedBusy, setCalendarFeedBusy] = useState("");
  const [calendarFeedIncludePaused, setCalendarFeedIncludePaused] = useState(false);
  const [calendarFeedSecretUrl, setCalendarFeedSecretUrl] = useState("");
  const [calendarFeedMessage, setCalendarFeedMessage] = useState("");
  const [calendarFeedRevokeArmed, setCalendarFeedRevokeArmed] = useState(false);
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => toDateInput(new Date()));
  const [importOpen, setImportOpen] = useState(false);
  const [csvSession, setCsvSession] = useState(null);
  const [csvMapping, setCsvMapping] = useState({});
  const [csvError, setCsvError] = useState("");
  const [csvLoading, setCsvLoading] = useState(false);
  const accountDialogRef = useDialogLifecycle(accountOpen, closeAccountControls, Boolean(accountBusy));
  const calendarDialogRef = useDialogLifecycle(calendarExportOpen, closeCalendarExport, Boolean(calendarFeedBusy));
  const ledgerDialogRef = useDialogLifecycle(ledgerOpen, closeLedgerControls);
  const alertDialogRef = useDialogLifecycle(alertSettingsOpen, () => setAlertSettingsOpen(false));
  const csvDialogRef = useDialogLifecycle(importOpen, closeCsvImport);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  }, [workspace]);

  useEffect(() => {
    localStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify(alertSettings));
  }, [alertSettings]);

  useEffect(() => {
    localStorage.setItem(ACCOUNT_NUDGE_KEY, JSON.stringify(accountNudge));
  }, [accountNudge]);

  useEffect(() => {
    if (cloudLedgerSession) setCloudLedgerNameDraft(cloudLedgerSession.ledger.name);
    else setCloudLedgerNameDraft("");
  }, [cloudLedgerSession?.ledger.id, cloudLedgerSession?.ledger.name]);

  useEffect(() => {
    if (!cloudConfigured) {
      setAccountLoading(false);
      return undefined;
    }
    let active = true;
    let authSubscription;
    let verificationSequence = 0;
    getCloud().then(async (client) => {
      if (!active || !client) return;
      setCloudClient(client);
      const applyVerifiedSession = async (session) => {
        const sequence = ++verificationSequence;
        if (!session) {
          if (!active) return;
          setAccountSession(null);
          setAccountLoading(false);
          return;
        }
        setAccountLoading(true);
        try {
          const verifiedSession = await verifyAccountSession(session);
          if (!active || sequence !== verificationSequence) return;
          setAccountSession(verifiedSession);
          if (verifiedSession?.user?.email) setAccountEmail(verifiedSession.user.email);
        } catch {
          if (!active || sequence !== verificationSequence) return;
          setAccountSession(null);
          setAccountError("Your account session could not be verified. Sign in again; local ledgers were not changed.");
          window.setTimeout(() => client.auth.signOut({ scope: "local" }).catch(() => {}), 0);
        } finally {
          if (active && sequence === verificationSequence) setAccountLoading(false);
        }
      };
      const { data: authListener } = client.auth.onAuthStateChange((event, session) => {
        if (!active || event === "INITIAL_SESSION") return;
        void applyVerifiedSession(session);
      });
      authSubscription = authListener.subscription;
      const { data, error } = await client.auth.getSession();
      if (!active) return;
      if (error) {
        setAccountSession(null);
        setAccountError("Your account session could not be read. Sign in again; local ledgers were not changed.");
        setAccountLoading(false);
        return;
      }
      await applyVerifiedSession(data.session || null);
    }).catch((error) => {
      if (!active) return;
      setAccountError(error instanceof Error ? error.message : "Outflow cloud could not initialize.");
      setAccountLoading(false);
    });
    return () => {
      active = false;
      authSubscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!accountSession?.user?.id) {
      setAccountEntitlement(null);
      setAccountEntitlementLoading(false);
      return undefined;
    }
    let active = true;
    setAccountEntitlementLoading(true);
    readProEntitlement(accountSession.user.id)
      .then((entitlement) => {
        if (active) setAccountEntitlement(entitlement);
      })
      .catch((error) => {
        if (active) setAccountError(error instanceof Error ? error.message : "Outflow could not read the Pro entitlement.");
      })
      .finally(() => {
        if (active) setAccountEntitlementLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountSession?.user?.id]);

  useEffect(() => {
    const userId = accountSession?.user?.id;
    if (!userId) {
      setEmailPreferences({ emailEnabled: false, pausedScheduleEnabled: false, timezone: browserTimezone() });
      setEmailPreferencesLoading(false);
      return undefined;
    }
    let active = true;
    setEmailPreferencesLoading(true);
    readNotificationPreferences(userId)
      .then((preferences) => {
        if (!active) return;
        setEmailPreferences(preferences || {
          emailEnabled: false,
          pausedScheduleEnabled: false,
          timezone: browserTimezone(),
        });
      })
      .catch((error) => {
        if (active) setAccountError(error instanceof Error ? error.message : "Outflow could not read email reminder settings.");
      })
      .finally(() => {
        if (active) setEmailPreferencesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountSession?.user?.id]);

  useEffect(() => {
    const syncTrackerParameters = () => {
      setPendingInviteToken(readInviteToken());
      setProReturn(readProReturn());
    };
    window.addEventListener("hashchange", syncTrackerParameters);
    return () => window.removeEventListener("hashchange", syncTrackerParameters);
  }, []);

  useEffect(() => {
    if (pendingInviteToken || proReturn) setAccountOpen(true);
  }, [pendingInviteToken, proReturn]);

  useEffect(() => {
    if (proReturn !== "cancelled") return;
    setAccountMessage("Pro checkout was cancelled. No product subscription or recurring charge was created.");
    setAccountError("");
    clearTrackerHashParameter("pro");
    setProReturn("");
  }, [proReturn]);

  useEffect(() => {
    const userId = accountSession?.user?.id;
    if (!userId || proReturn !== "success") return undefined;
    let active = true;
    let timer;
    let attempt = 0;

    const confirmPurchase = async () => {
      timer = undefined;
      attempt += 1;
      setAccountEntitlementLoading(true);
      try {
        const entitlement = await readProEntitlement(userId);
        if (!active) return;
        setAccountEntitlement(entitlement);
        if (entitlement?.status === "active") {
          setAccountMessage("Outflow Pro is active. Your one-time purchase is restored on this account.");
          setAccountError("");
          setCloudAccessRefresh((current) => current + 1);
          clearTrackerHashParameter("pro");
          setProReturn("");
          return;
        }
        if (attempt < 6) {
          timer = window.setTimeout(confirmPurchase, 1500);
          return;
        }
        setAccountMessage("Payment confirmation is still pending. Use Restore access in a moment; the checkout redirect is not treated as proof of payment.");
        clearTrackerHashParameter("pro");
        setProReturn("");
      } catch {
        if (!active) return;
        if (attempt < 6) {
          timer = window.setTimeout(confirmPurchase, 1500);
          return;
        }
        setAccountError("Outflow could not confirm the purchase yet. Use Restore access after the webhook finishes.");
        clearTrackerHashParameter("pro");
        setProReturn("");
      } finally {
        if (active && (!timer || attempt >= 6)) setAccountEntitlementLoading(false);
      }
    };

    confirmPurchase();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [accountSession?.user?.id, proReturn]);

  useEffect(() => {
    const userId = accountSession?.user?.id;
    if (!accountOpen || !userId || accountEntitlement?.status === "active") {
      setProOffer(null);
      setProOfferLoading(false);
      setProOfferError("");
      return undefined;
    }
    let active = true;
    setProOfferLoading(true);
    setProOfferError("");
    readProOffer()
      .then((offer) => {
        if (active) setProOffer(offer);
      })
      .catch(() => {
        if (active) {
          setProOffer(null);
          setProOfferError("One-time checkout is not available in this environment.");
        }
      })
      .finally(() => {
        if (active) setProOfferLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountOpen, accountSession?.user?.id, accountEntitlement?.status]);

  useEffect(() => {
    const userId = accountSession?.user?.id;
    if (!userId) {
      setCloudLedgers([]);
      setCloudLedgersLoading(false);
      setManagedCloudLedgerId("");
      setCloudLedgerSession(null);
      setCloudSyncStatus("off");
      setCloudSyncMessage("");
      setCloudRemotePending(false);
      return undefined;
    }
    let active = true;
    setCloudLedgersLoading(true);
    readCloudLedgerAccess(userId)
      .then((ledgers) => {
        if (!active) return;
        setCloudLedgers(ledgers);
        setManagedCloudLedgerId((current) => current && ledgers.some((ledger) => ledger.id === current) ? current : "");
      })
      .catch((error) => {
        if (active) setAccountError(error instanceof Error ? error.message : "Outflow could not read cloud ledger access.");
      })
      .finally(() => {
        if (active) setCloudLedgersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountSession?.user?.id, cloudAccessRefresh]);

  useEffect(() => {
    const userId = accountSession?.user?.id;
    const ledgerId = cloudLedgerSession?.ledger?.id;
    if (!userId || !ledgerId) return undefined;
    let active = true;
    let unsubscribe = () => {};
    let refreshTimer;

    const receiveRemoteChange = () => {
      if (!active) return;
      if (cloudSyncingRef.current || editingId) {
        setCloudRemotePending(true);
        setCloudSyncStatus("stale");
        setCloudSyncMessage("Another cloud revision is available. Finish or cancel the current edit, then refresh.");
        return;
      }
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(async () => {
        if (!active || cloudSyncingRef.current) return;
        setCloudSyncStatus("refreshing");
        setCloudSyncMessage("A remote change arrived. Refreshing the cloud ledger...");
        try {
          const snapshot = sanitizeCloudLedgerSnapshot(await readCloudLedgerSnapshot(ledgerId, userId));
          if (!active) return;
          setCloudLedgerSession(snapshot);
          setCloudSyncStatus(snapshot.ledger.canSync ? "synced" : "read-only");
          setCloudSyncMessage("Remote changes applied.");
          setCloudRemotePending(false);
          setCloudAccessRefresh((current) => current + 1);
        } catch (error) {
          if (!active) return;
          setCloudSyncStatus("offline");
          setCloudSyncMessage(error instanceof Error ? error.message : "Outflow could not apply a remote change.");
        }
      }, 150);
    };

    subscribeToCloudLedger(ledgerId, receiveRemoteChange)
      .then((cleanup) => {
        if (active) unsubscribe = cleanup;
        else cleanup();
      })
      .catch((error) => {
        if (!active) return;
        setCloudSyncStatus("offline");
        setCloudSyncMessage(error instanceof Error ? error.message : "Realtime synchronization is unavailable.");
      });

    return () => {
      active = false;
      window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [accountSession?.user?.id, cloudLedgerSession?.ledger?.id, editingId]);

  useEffect(() => {
    const userId = accountSession?.user?.id;
    if (!calendarExportOpen || !usingCloudLedger || !userId) {
      setCalendarFeed(null);
      setCalendarFeedLoading(false);
      setCalendarFeedIncludePaused(false);
      setCalendarFeedSecretUrl("");
      setCalendarFeedMessage("");
      setCalendarFeedRevokeArmed(false);
      return undefined;
    }
    let active = true;
    setCalendarFeed(null);
    setCalendarFeedSecretUrl("");
    setCalendarFeedMessage("");
    setCalendarFeedRevokeArmed(false);
    setCalendarFeedLoading(true);
    setCalendarExportError("");
    readHostedCalendarFeed(ledgerMeta.id)
      .then((feed) => {
        if (!active) return;
        setCalendarFeed(feed || null);
        setCalendarFeedIncludePaused(feed?.includePaused === true);
      })
      .catch((error) => {
        if (active) setCalendarExportError(error instanceof Error ? error.message : "Outflow could not read the hosted calendar feed.");
      })
      .finally(() => {
        if (active) setCalendarFeedLoading(false);
      });
    return () => {
      active = false;
    };
  }, [calendarExportOpen, usingCloudLedger, accountSession?.user?.id, ledgerMeta.id]);

  const activeSubscriptions = useMemo(
    () => subscriptions.filter((subscription) => !subscription.paused),
    [subscriptions],
  );
  const calendarExportSubscriptions = useMemo(
    () => subscriptions
      .filter((subscription) => !subscription.paused || includePausedCalendar)
      .sort((a, b) => parseDate(a.nextBillingDate) - parseDate(b.nextBillingDate) || a.name.localeCompare(b.name)),
    [subscriptions, includePausedCalendar],
  );

  const sortedSubscriptions = useMemo(
    () =>
      [...subscriptions].sort((a, b) => {
        if (a.paused !== b.paused) return Number(a.paused) - Number(b.paused);
        return parseDate(a.nextBillingDate) - parseDate(b.nextBillingDate) || a.name.localeCompare(b.name);
      }),
    [subscriptions],
  );

  const timeline = useMemo(() => buildTimeline(subscriptions, 30), [subscriptions]);
  const forecastTimeline = useMemo(
    () => buildTimeline(subscriptions, forecastHorizon),
    [subscriptions, forecastHorizon],
  );
  const forecastWeeks = useMemo(
    () => weeklyForecast(forecastTimeline, forecastHorizon),
    [forecastTimeline, forecastHorizon],
  );
  const forecastCategories = useMemo(() => {
    const categories = new Map();
    forecastTimeline.forEach((event) => {
      const current = categories.get(event.category) || { name: event.category, events: [], count: 0 };
      current.events.push(event);
      current.count += 1;
      categories.set(event.category, current);
    });
    return [...categories.values()]
      .map((category) => ({ ...category, totals: totalsByCurrency(category.events) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [forecastTimeline]);

  const calendarBounds = useMemo(() => monthBounds(calendarCursor), [calendarCursor]);
  const calendarGrid = useMemo(() => calendarDays(calendarCursor), [calendarCursor]);
  const calendarEvents = useMemo(
    () => buildSchedule(subscriptions, calendarBounds.start, calendarBounds.end),
    [subscriptions, calendarBounds],
  );
  const calendarEventsByDate = useMemo(() => {
    const eventsByDate = new Map();
    calendarEvents.forEach((event) => {
      const events = eventsByDate.get(event.date) || [];
      events.push(event);
      eventsByDate.set(event.date, events);
    });
    return eventsByDate;
  }, [calendarEvents]);
  const selectedDayEvents = calendarEventsByDate.get(selectedDate) || [];
  const upcomingWeek = timeline.filter((event) => event.daysOut <= 7);
  const monthlyTotals = totalsByCurrency(activeSubscriptions, monthlyEquivalent);
  const yearlyRunRateTotals = scaleCurrencyTotals(monthlyTotals, 12);
  const pausedCount = subscriptions.length - activeSubscriptions.length;
  const thirtyDayTotals = totalsByCurrency(timeline);
  const forecastTotals = totalsByCurrency(forecastTimeline);
  const forecastWeeklyAverageTotals = scaleCurrencyTotals(forecastTotals, 1 / Math.max(forecastWeeks.length, 1));
  const forecastPeak = Math.max(...forecastWeeks.map((week) => week.count), 0);
  const forecastCategoryPeak = Math.max(...forecastCategories.map((category) => category.count), 0);
  const calendarMonthTotals = totalsByCurrency(calendarEvents);
  const calendarExportTotals = totalsByCurrency(calendarExportSubscriptions, monthlyEquivalent);
  const pausedCalendarExportCount = calendarExportSubscriptions.filter((subscription) => subscription.paused).length;
  const nextCharge = timeline[0];
  const alerts = useMemo(
    () => buildAlerts(subscriptions, alertSettings.includePausedSchedules),
    [subscriptions, alertSettings.includePausedSchedules],
  );
  const csvCandidates = useMemo(
    () => csvSession ? buildCsvCandidates(csvSession.rows, csvMapping, subscriptions) : [],
    [csvSession, csvMapping, subscriptions],
  );
  const backupMergeCandidates = useMemo(() => {
    if (!backupSession) return [];
    const existingIds = new Set(subscriptions.map((subscription) => subscription.id));
    const existingKeys = new Set(subscriptions.map(importDuplicateKey));
    return backupSession.subscriptions.filter(
      (subscription) => !existingIds.has(subscription.id) && !existingKeys.has(importDuplicateKey(subscription)),
    );
  }, [backupSession, subscriptions]);
  const importableCandidates = csvCandidates.filter((candidate) => candidate.subscription && !candidate.duplicate);
  const invalidImportCount = csvCandidates.filter((candidate) => candidate.errors.length > 0).length;
  const duplicateImportCount = csvCandidates.filter((candidate) => candidate.duplicate).length;
  const configuredAlertCount = subscriptions.filter((subscription) => subscription.reminderLeadDays.length > 0).length;
  const backupDuplicateCount = backupSession ? backupSession.subscriptions.length - backupMergeCandidates.length : 0;
  const availableImportSlots = Math.max(MAX_SUBSCRIPTIONS - subscriptions.length, 0);
  const backupMergeCount = Math.min(backupMergeCandidates.length, availableImportSlots);
  const backupCapacityOmittedCount = backupMergeCandidates.length - backupMergeCount;
  const importConfirmCount = Math.min(importableCandidates.length, availableImportSlots);
  const workspaceRecordCount = workspace.ledgers.reduce((total, entry) => total + entry.subscriptions.length, 0);
  const sharedWorkspaceCount = workspace.ledgers.filter((entry) => entry.ledger.kind !== "personal").length;
  const cloudUploadRequiresPro = sharedWorkspaceCount > 0 && accountEntitlement?.status !== "active";
  const hasProAccess = hasLifetimePro(accountEntitlement);
  const editingSubscription = editingId
    ? subscriptions.find((subscription) => subscription.id === editingId) || null
    : null;
  const managedCloudLedger = cloudLedgers.find((ledger) => ledger.id === managedCloudLedgerId) || null;
  const canInviteToManagedLedger = Boolean(
    managedCloudLedger?.currentRole === "owner"
      && managedCloudLedger.kind !== "personal"
      && accountEntitlement?.status === "active",
  );
  const accountPromptDetails = {
    activity: {
      code: "Local checkpoint",
      title: "This workspace exists only in this browser.",
      detail: `${workspaceRecordCount} ${workspaceRecordCount === 1 ? "record" : "records"} remain available without an account. Sign-in is optional and does not upload them.`,
    },
    backup: {
      code: "Backup downloaded",
      title: "Your portable copy is ready.",
      detail: "An optional account can add recovery on another device after you explicitly create a cloud copy.",
    },
    shared: {
      code: "Shared ledger / local",
      title: `${ledgerMeta.name} is isolated to this browser.`,
      detail: "An optional account is the first step toward cloud access and member invitations. The local ledger stays intact.",
    },
    install: {
      code: "Installed locally",
      title: "This install still uses browser-local data.",
      detail: "An optional account adds identity for recovery and multi-device access only when you choose to upload.",
    },
    "pro-csv": {
      code: "Lifetime Pro / CSV import",
      title: "Review imported records with Pro.",
      detail: "CSV export remains free for data ownership. The mapped preview and confirmed bulk import require a verified lifetime entitlement.",
    },
    "pro-currency": {
      code: "Lifetime Pro / currencies",
      title: "Track new non-USD charges with Pro.",
      detail: "Free ledgers use USD for new records. Existing currency data remains visible and editable after account or entitlement changes.",
    },
    "pro-reminders": {
      code: "Lifetime Pro / alert timing",
      title: "Add multiple lead times with Pro.",
      detail: "One device reminder per subscription remains free. Existing advanced rules are retained and can always be reduced or disabled.",
    },
  }[accountPromptContext || accountEntryContext] || null;

  useEffect(() => {
    if (accountSession) {
      setAccountPromptContext("");
      setAccountEntryContext((current) => current.startsWith("pro-") ? current : "");
      return;
    }
    if (!cloudConfigured || accountLoading || accountOpen || accountPromptContext) return;
    if (accountNudgeIsDue(accountNudge)) setAccountPromptContext("activity");
  }, [accountSession, accountLoading, accountOpen, accountPromptContext, accountNudge]);

  useEffect(() => {
    if (!alertSettings.deviceEnabled || notificationPermission !== "granted" || alerts.length === 0) return;

    let stored = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(NOTIFIED_ALERTS_KEY) || "[]");
      if (Array.isArray(parsed)) stored = parsed;
    } catch {
      stored = [];
    }

    const notified = new Set(stored.slice(-200).filter((id) => typeof id === "string"));
    const pending = alerts
      .map((alert) => ({ ...alert, deliveryId: `${ledgerMeta.id}:${alert.id}` }))
      .filter((alert) => !notified.has(alert.deliveryId));

    pending.forEach((alert) => {
      try {
        const title = alert.type === "trial" ? `${alert.name} trial ends ${dayLabel(alert.daysOut)}` : `${alert.name} bills ${dayLabel(alert.daysOut)}`;
        const ledgerContext = `${alert.paused ? "Paused schedule / " : ""}${ledgerMeta.name} / ${ledgerMeta.kind} ${ledgerMeta.storage} ledger.`;
        const body = alert.type === "trial"
          ? `${money(alert.amount, alert.currency)} expected after the trial ends on ${fullDate(alert.date)} / ${ledgerContext}`
          : `${money(alert.amount, alert.currency)} will leave on ${fullDate(alert.date)} / ${ledgerContext}`;
        new window.Notification(`Outflow / ${title}`, { body, tag: alert.deliveryId });
        notified.add(alert.deliveryId);
      } catch {
        // A failed alert remains eligible while later due alerts can still be delivered.
      }
    });

    try {
      localStorage.setItem(NOTIFIED_ALERTS_KEY, JSON.stringify([...notified].slice(-200)));
    } catch {
      // Device notifications are best-effort; the in-app alert remains available.
    }
  }, [alerts, alertSettings.deviceEnabled, notificationPermission, ledgerMeta.id, ledgerMeta.kind, ledgerMeta.name, ledgerMeta.storage]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function recordGuestAccountActivity() {
    if (usingCloudLedger || accountSession) return;
    setAccountNudge((current) => recordAccountNudgeActivity(current));
  }

  function presentGuestAccountPrompt(context) {
    if (!cloudConfigured || accountLoading || accountSession || accountNudgeIsSnoozed(accountNudge)) return;
    setAccountPromptContext(context);
  }

  function dismissGuestAccountPrompt() {
    setAccountNudge((current) => advanceAccountNudge(current, ACCOUNT_NUDGE_DISMISS_DAYS));
    setAccountPromptContext("");
  }

  function openAccountControls(context = "") {
    const resolvedContext = context || accountPromptContext;
    if (["activity", "backup", "shared", "install"].includes(resolvedContext)) {
      setAccountNudge((current) => advanceAccountNudge(current, ACCOUNT_NUDGE_OPEN_DAYS));
      setAccountPromptContext("");
    }
    if (resolvedContext.startsWith("pro-")) setAccountPromptContext("");
    setAccountEntryContext(resolvedContext);
    setAccountOpen(true);
  }

  function toggleReminderLeadDay(days) {
    if (!canToggleReminderLeadDay({
      days,
      selectedLeadDays: form.reminderLeadDays,
      entitlement: accountEntitlement,
      originalLeadDays: editingSubscription?.reminderLeadDays,
    })) {
      openAccountControls("pro-reminders");
      return;
    }
    setForm((current) => ({
      ...current,
      reminderLeadDays: current.reminderLeadDays.includes(days)
        ? current.reminderLeadDays.filter((value) => value !== days)
        : [...current.reminderLeadDays, days].sort((a, b) => b - a),
    }));
  }

  function resetForm() {
    setForm(blankForm);
    setEditingId(null);
  }

  function submitSubscription(event) {
    event.preventDefault();
    if (cloudLedgerWriteDisabled) return;
    const existingSubscription = editingId ? subscriptions.find((subscription) => subscription.id === editingId) : null;
    const restrictedFeature = restrictedDraftFeature({
      currency: form.currency,
      reminderLeadDays: form.reminderLeadDays,
      entitlement: accountEntitlement,
      originalCurrency: existingSubscription?.currency,
      originalLeadDays: existingSubscription?.reminderLeadDays,
    });
    if (restrictedFeature) {
      openAccountControls(restrictedFeature === "currency" ? "pro-currency" : "pro-reminders");
      return;
    }
    const actorLabel = usingCloudLedger ? "Cloud member" : "Local guest";

    const payload = sanitizeSubscription({
      id: editingId || crypto.randomUUID(),
      name: form.name.trim(),
      amount: Number(form.amount),
      currency: form.currency,
      cycle: form.cycle,
      nextBillingDate: form.nextBillingDate,
      category: form.category.trim() || "Unsorted",
      tags: form.tags,
      color: form.color,
      trialEndDate: form.trialEndDate,
      reminderLeadDays: form.reminderLeadDays,
      paused: form.paused,
      revision: existingSubscription ? existingSubscription.revision + 1 : 0,
      updatedAt: new Date().toISOString(),
      createdBy: existingSubscription?.createdBy || actorLabel,
      updatedBy: actorLabel,
    });

    if (!payload) return;

    const normalizedPayload = normalizeBillingDate(payload);

    setSubscriptions((current) =>
      editingId
        ? current.map((item) => (item.id === editingId ? normalizedPayload : item))
        : [...current, normalizedPayload].slice(0, MAX_SUBSCRIPTIONS),
    );
    recordGuestAccountActivity();
    resetForm();
  }

  function editSubscription(subscription) {
    if (cloudLedgerWriteDisabled) return;
    setEditingId(subscription.id);
    setForm({
      name: subscription.name,
      amount: String(subscription.amount),
      currency: subscription.currency,
      cycle: subscription.cycle,
      nextBillingDate: subscription.nextBillingDate,
      category: subscription.category,
      tags: subscription.tags.join(", "),
      color: subscription.color,
      trialEndDate: subscription.trialEndDate,
      reminderLeadDays: subscription.reminderLeadDays,
      paused: subscription.paused,
    });
  }

  function deleteSubscription(id) {
    if (cloudLedgerWriteDisabled) return;
    setSubscriptions((current) => current.filter((subscription) => subscription.id !== id));
    recordGuestAccountActivity();
    if (editingId === id) resetForm();
  }

  function togglePaused(id) {
    if (cloudLedgerWriteDisabled) return;
    setSubscriptions((current) =>
      current.map((subscription) =>
        subscription.id === id ? {
          ...normalizeBillingDate({ ...subscription, paused: !subscription.paused }),
          revision: subscription.revision + 1,
          updatedAt: new Date().toISOString(),
          updatedBy: usingCloudLedger ? "Cloud member" : "Local guest",
        } : subscription,
      ),
    );
    recordGuestAccountActivity();
  }

  async function installOutflow() {
    if (await pwa.install()) presentGuestAccountPrompt("install");
  }

  function moveCalendar(months) {
    setCalendarCursor((current) => {
      const next = new Date(current.getFullYear(), current.getMonth() + months, 1);
      setSelectedDate(toDateInput(next));
      return next;
    });
  }

  function showCurrentMonth() {
    const today = new Date();
    setCalendarCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(toDateInput(today));
  }

  function closeCalendarExport() {
    if (calendarFeedBusy) return;
    setCalendarExportOpen(false);
    setCalendarExportError("");
    setCalendarFeedSecretUrl("");
    setCalendarFeedMessage("");
    setCalendarFeedRevokeArmed(false);
  }

  function exportCalendarFile() {
    if (!calendarExportSubscriptions.length) return;
    try {
      const { error, value } = createSubscriptionCalendar(calendarExportSubscriptions, ledgerMeta);
      if (error || !value) throw error || new Error("Calendar generation failed.");
      const blob = new Blob([value], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const ledgerSlug = ledgerMeta.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "personal";
      link.href = url;
      link.download = `outflow-${ledgerSlug}-calendar.ics`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      closeCalendarExport();
    } catch (error) {
      setCalendarExportError(error instanceof Error ? error.message : "Outflow could not generate this calendar.");
    }
  }

  async function publishCalendarFeed() {
    if (!usingCloudLedger || accountEntitlement?.status !== "active" || calendarFeedBusy) return;
    setCalendarFeedBusy("publish");
    setCalendarExportError("");
    setCalendarFeedMessage("");
    setCalendarFeedRevokeArmed(false);
    try {
      const feed = await publishHostedCalendarFeed(ledgerMeta.id, calendarFeedIncludePaused);
      setCalendarFeed(feed);
      setCalendarFeedSecretUrl(hostedCalendarFeedUrl(feed.token));
      setCalendarFeedMessage(calendarFeed ? "Feed URL rotated. The previous URL is inactive." : "Hosted feed published. This secret URL is shown once.");
    } catch (error) {
      setCalendarExportError(error instanceof Error ? error.message : "Outflow could not publish the calendar feed.");
    } finally {
      setCalendarFeedBusy("");
    }
  }

  async function saveCalendarFeedScope() {
    if (!calendarFeed || accountEntitlement?.status !== "active" || calendarFeedBusy) return;
    setCalendarFeedBusy("scope");
    setCalendarExportError("");
    setCalendarFeedMessage("");
    try {
      const feed = await saveHostedCalendarFeedOptions(ledgerMeta.id, calendarFeedIncludePaused);
      setCalendarFeed(feed);
      setCalendarFeedMessage("Hosted feed scope updated.");
    } catch (error) {
      setCalendarExportError(error instanceof Error ? error.message : "Outflow could not update the calendar feed.");
    } finally {
      setCalendarFeedBusy("");
    }
  }

  async function copyCalendarFeedUrl() {
    if (!calendarFeedSecretUrl) return;
    try {
      await navigator.clipboard.writeText(calendarFeedSecretUrl);
      setCalendarFeedMessage("Secret feed URL copied.");
      setCalendarExportError("");
    } catch {
      setCalendarExportError("The feed URL could not be copied. Select it manually.");
    }
  }

  async function revokeCalendarFeed() {
    if (!calendarFeed || calendarFeedBusy) return;
    if (!calendarFeedRevokeArmed) {
      setCalendarFeedRevokeArmed(true);
      setCalendarFeedMessage("Confirm revocation to disable the hosted URL.");
      return;
    }
    setCalendarFeedBusy("revoke");
    setCalendarExportError("");
    try {
      await revokeHostedCalendarFeed(ledgerMeta.id);
      setCalendarFeed(null);
      setCalendarFeedSecretUrl("");
      setCalendarFeedIncludePaused(false);
      setCalendarFeedRevokeArmed(false);
      setCalendarFeedMessage("Hosted calendar feed revoked.");
    } catch (error) {
      setCalendarExportError(error instanceof Error ? error.message : "Outflow could not revoke the calendar feed.");
    } finally {
      setCalendarFeedBusy("");
    }
  }

  async function requestDeviceAlerts() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      setDeviceAlertStatus({ kind: "alert", message: "Device notifications are not available in this browser." });
      return;
    }
    try {
      const permission = await window.Notification.requestPermission();
      setNotificationPermission(permission);
      setAlertSettings((current) => ({ ...current, deviceEnabled: permission === "granted" }));
      setDeviceAlertStatus(permission === "granted"
        ? { kind: "status", message: "Device notifications enabled for due alerts in this browser." }
        : { kind: "alert", message: "Device notification permission was not granted." });
    } catch {
      setAlertSettings((current) => ({ ...current, deviceEnabled: false }));
      setDeviceAlertStatus({ kind: "alert", message: "Outflow could not request device notification permission." });
    }
  }

  async function setDeviceAlertsEnabled(enabled) {
    if (!enabled) {
      setAlertSettings((current) => ({ ...current, deviceEnabled: false }));
      setDeviceAlertStatus({ kind: "status", message: "Device notifications disabled. In-app alerts remain available." });
      return;
    }
    if (notificationPermission !== "granted") {
      await requestDeviceAlerts();
      return;
    }
    setAlertSettings((current) => ({ ...current, deviceEnabled: true }));
    setDeviceAlertStatus({ kind: "status", message: "Device notifications enabled for due alerts in this browser." });
  }

  function exportCsv() {
    const blob = new Blob([subscriptionsToCsv(subscriptions)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `outflow-subscriptions-${toDateInput(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function openCloudLedger(ledgerId) {
    const userId = accountSession?.user?.id;
    if (!userId || cloudOpenId || cloudSyncingRef.current) return;
    setCloudOpenId(ledgerId);
    setCloudSyncStatus("loading");
    setCloudSyncMessage("");
    try {
      const snapshot = sanitizeCloudLedgerSnapshot(await readCloudLedgerSnapshot(ledgerId, userId));
      setCloudLedgerSession(snapshot);
      setCloudSyncStatus(snapshot.ledger.canSync ? "synced" : "read-only");
      setCloudSyncMessage(snapshot.ledger.canSync
        ? "Cloud ledger loaded. Changes use optimistic revision checks."
        : "Cloud ledger opened read-only. Pro editor access is required to synchronize changes.");
      setCloudRemotePending(false);
      setAccountOpen(false);
      setLedgerOpen(false);
      setBackupSession(null);
      setBackupError("");
      resetForm();
      setCalendarCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
      setSelectedDate(toDateInput(new Date()));
    } catch (error) {
      setCloudSyncStatus("offline");
      setCloudSyncMessage(error instanceof Error ? error.message : "Outflow could not open this cloud ledger.");
    } finally {
      setCloudOpenId("");
    }
  }

  function closeCloudLedger() {
    if (!cloudLedgerSession || cloudSyncingRef.current) return;
    setCloudLedgerSession(null);
    setCloudSyncStatus("off");
    setCloudSyncMessage("");
    setCloudRemotePending(false);
    setBackupSession(null);
    setBackupError("");
    resetForm();
    setLedgerOpen(false);
  }

  async function refreshActiveCloudLedger() {
    const userId = accountSession?.user?.id;
    const ledgerId = cloudLedgerSession?.ledger?.id;
    if (!userId || !ledgerId || cloudSyncingRef.current) return;
    setCloudSyncStatus("refreshing");
    setCloudSyncMessage("Checking the authoritative cloud revision...");
    try {
      const snapshot = sanitizeCloudLedgerSnapshot(await readCloudLedgerSnapshot(ledgerId, userId));
      setCloudLedgerSession(snapshot);
      setCloudSyncStatus(snapshot.ledger.canSync ? "synced" : "read-only");
      setCloudSyncMessage("Cloud ledger refreshed.");
      setCloudRemotePending(false);
      resetForm();
    } catch (error) {
      setCloudSyncStatus("offline");
      setCloudSyncMessage(error instanceof Error ? error.message : "Outflow could not refresh this cloud ledger.");
    }
  }

  async function commitCloudSubscriptions(nextSubscriptions) {
    const baseSession = cloudLedgerSession;
    const userId = accountSession?.user?.id;
    if (!baseSession || !userId || !baseSession.ledger.canSync || cloudSyncingRef.current) return;
    const sanitized = nextSubscriptions.slice(0, MAX_SUBSCRIPTIONS).map(sanitizeSubscription);
    if (sanitized.some((subscription) => !subscription)) {
      setCloudSyncStatus("offline");
      setCloudSyncMessage("The pending cloud change contains an invalid subscription.");
      return;
    }

    cloudSyncingRef.current = true;
    setCloudSyncStatus("syncing");
    setCloudSyncMessage(`Writing revision ${baseSession.ledger.revision + 1}...`);
    setCloudLedgerSession({
      ...baseSession,
      ledger: { ...baseSession.ledger, updatedAt: new Date().toISOString() },
      subscriptions: sanitized,
    });

    let result;
    try {
      result = await replaceCloudLedgerSnapshot(
        baseSession.ledger.id,
        baseSession.ledger.revision,
        sanitized,
        crypto.randomUUID(),
      );
    } catch (error) {
      setCloudLedgerSession(baseSession);
      setCloudSyncStatus("offline");
      setCloudSyncMessage(error instanceof Error ? error.message : "Cloud synchronization failed before the change was committed.");
      cloudSyncingRef.current = false;
      return;
    }

    try {
      if (result?.status === "conflict") {
        try {
          const serverSnapshot = sanitizeCloudLedgerSnapshot(await readCloudLedgerSnapshot(baseSession.ledger.id, userId));
          setCloudLedgerSession(serverSnapshot);
          setCloudRemotePending(false);
        } catch {
          setCloudLedgerSession(baseSession);
          setCloudRemotePending(true);
        }
        setCloudSyncStatus("conflict");
        setCloudSyncMessage(`Cloud changed at revision ${result.currentRevision}. Your stale write was rejected; refresh and review the server copy.`);
      } else {
        const committedRevision = Number.isInteger(result?.currentRevision)
          ? result.currentRevision
          : baseSession.ledger.revision + 1;
        const committedSession = {
          ...baseSession,
          ledger: {
            ...baseSession.ledger,
            revision: committedRevision,
            updatedAt: new Date().toISOString(),
          },
          subscriptions: sanitized,
        };
        setCloudLedgerSession(committedSession);
        try {
          const serverSnapshot = sanitizeCloudLedgerSnapshot(await readCloudLedgerSnapshot(baseSession.ledger.id, userId));
          setCloudLedgerSession(serverSnapshot);
          setCloudRemotePending(false);
          setCloudSyncStatus(serverSnapshot.ledger.canSync ? "synced" : "read-only");
          setCloudSyncMessage(`Synchronized revision ${committedRevision}.`);
        } catch {
          setCloudRemotePending(true);
          setCloudSyncStatus("stale");
          setCloudSyncMessage(`Revision ${committedRevision} was committed, but confirmation failed. Refresh before making another change.`);
        }
      }
      setCloudAccessRefresh((current) => current + 1);
    } finally {
      cloudSyncingRef.current = false;
    }
  }

  async function renameActiveCloudLedger(event) {
    event.preventDefault();
    const baseSession = cloudLedgerSession;
    const userId = accountSession?.user?.id;
    const name = cloudLedgerNameDraft.trim().slice(0, 60);
    if (
      !baseSession
      || !userId
      || baseSession.ledger.currentRole !== "owner"
      || !baseSession.ledger.canSync
      || cloudSyncingRef.current
      || !name
      || name === baseSession.ledger.name
    ) return;

    cloudSyncingRef.current = true;
    setCloudSyncStatus("syncing");
    setCloudSyncMessage(`Renaming cloud revision ${baseSession.ledger.revision}...`);
    let result;
    try {
      result = await renameCloudLedger(
        baseSession.ledger.id,
        baseSession.ledger.revision,
        name,
        crypto.randomUUID(),
      );
    } catch (error) {
      setCloudLedgerNameDraft(baseSession.ledger.name);
      setCloudSyncStatus("offline");
      setCloudSyncMessage(error instanceof Error ? error.message : "Cloud ledger rename failed before it was committed.");
      cloudSyncingRef.current = false;
      return;
    }

    try {
      if (result?.status === "conflict") {
        try {
          const serverSnapshot = sanitizeCloudLedgerSnapshot(await readCloudLedgerSnapshot(baseSession.ledger.id, userId));
          setCloudLedgerSession(serverSnapshot);
          setCloudRemotePending(false);
        } catch {
          setCloudLedgerSession(baseSession);
          setCloudRemotePending(true);
        }
        setCloudSyncStatus("conflict");
        setCloudSyncMessage(`Cloud changed at revision ${result.currentRevision}. The rename was rejected; refresh the current name.`);
      } else {
        const committedRevision = Number.isInteger(result?.currentRevision)
          ? result.currentRevision
          : baseSession.ledger.revision + 1;
        const committedSession = {
          ...baseSession,
          ledger: {
            ...baseSession.ledger,
            name,
            revision: committedRevision,
            updatedAt: new Date().toISOString(),
          },
        };
        setCloudLedgerSession(committedSession);
        try {
          const serverSnapshot = sanitizeCloudLedgerSnapshot(await readCloudLedgerSnapshot(baseSession.ledger.id, userId));
          setCloudLedgerSession(serverSnapshot);
          setCloudRemotePending(false);
          setCloudSyncStatus(serverSnapshot.ledger.canSync ? "synced" : "read-only");
          setCloudSyncMessage(`Renamed and synchronized revision ${committedRevision}.`);
        } catch {
          setCloudRemotePending(true);
          setCloudSyncStatus("stale");
          setCloudSyncMessage(`The rename committed at revision ${committedRevision}, but confirmation failed. Refresh before making another change.`);
        }
      }
      setCloudAccessRefresh((current) => current + 1);
    } finally {
      cloudSyncingRef.current = false;
    }
  }

  function closeAccountControls() {
    if (accountBusy) return;
    setAccountOpen(false);
    setAccountEntryContext("");
    setDeleteAccountArmed(false);
    setRemoveMemberArmed("");
    setRevokeInviteArmed("");
    setAccountError("");
    setAccountMessage("");
  }

  async function sendAccountLink(event) {
    event.preventDefault();
    const email = accountEmail.trim().toLowerCase();
    if (!email || !cloudConfigured) return;
    setAccountBusy("link");
    setAccountError("");
    setAccountMessage("");
    try {
      await requestAccountLink(email);
      setAccountEmail(email);
      setAccountMessage("Sign-in link sent. Your local workspace has not been uploaded.");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Outflow could not send the sign-in link.");
    } finally {
      setAccountBusy("");
    }
  }

  async function uploadLocalWorkspace() {
    if (!accountSession || accountBusy || accountEntitlementLoading || cloudUploadRequiresPro) return;
    setAccountBusy("upload");
    setAccountError("");
    setAccountMessage("");
    try {
      const receipt = await uploadGuestWorkspace(workspace);
      const ledgerCount = Number(receipt?.ledgerCount ?? receipt?.ledger_count ?? workspace.ledgers.length);
      const recordCount = Number(receipt?.subscriptionCount ?? receipt?.subscription_count ?? workspaceRecordCount);
      setAccountMessage(`Cloud copy confirmed / ${ledgerCount} ledgers / ${recordCount} records. Local data remains available.`);
      setCloudAccessRefresh((current) => current + 1);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Outflow could not upload this workspace.");
    } finally {
      setAccountBusy("");
    }
  }

  async function startProCheckout() {
    if (!accountSession || !proOffer || accountBusy || accountEntitlement?.status === "active") return;
    setAccountBusy("checkout");
    setAccountError("");
    setAccountMessage("");
    try {
      const checkoutUrl = await createProCheckout(crypto.randomUUID());
      window.location.assign(checkoutUrl);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Outflow could not open the hosted one-time checkout.");
      setAccountBusy("");
    }
  }

  async function restoreProAccess() {
    const userId = accountSession?.user?.id;
    if (!userId || accountBusy) return;
    setAccountBusy("restore-pro");
    setAccountEntitlementLoading(true);
    setAccountError("");
    setAccountMessage("");
    try {
      const entitlement = await readProEntitlement(userId);
      setAccountEntitlement(entitlement);
      if (entitlement?.status === "active") {
        setAccountMessage("Outflow Pro access restored from this account.");
        setCloudAccessRefresh((current) => current + 1);
      } else if (entitlement?.status === "refunded" || entitlement?.status === "revoked") {
        setAccountMessage(`The previous Pro entitlement is ${entitlement.status}; no active access was restored.`);
      } else {
        setAccountMessage("No completed Outflow Pro purchase is attached to this account.");
      }
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Outflow could not restore Pro access.");
    } finally {
      setAccountEntitlementLoading(false);
      setAccountBusy("");
    }
  }

  async function saveEmailReminderSettings(event) {
    event.preventDefault();
    if (!accountSession || accountBusy || emailPreferencesLoading) return;
    if (emailPreferences.emailEnabled && accountEntitlement?.status !== "active") return;
    setAccountBusy("email-preferences");
    setAccountError("");
    setAccountMessage("");
    try {
      const saved = await saveNotificationPreferences(emailPreferences);
      setEmailPreferences({
        emailEnabled: saved?.emailEnabled === true,
        pausedScheduleEnabled: saved?.pausedScheduleEnabled === true,
        timezone: saved?.timezone || emailPreferences.timezone,
      });
      setAccountMessage(saved?.emailEnabled
        ? "Email reminders enabled. Subscription lead times control each delivery."
        : "Email reminders disabled. Device alert settings were not changed.");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Outflow could not save email reminder settings.");
    } finally {
      setAccountBusy("");
    }
  }

  async function signOutAccount() {
    if (!cloudClient || accountBusy || cloudSyncingRef.current) return;
    setAccountBusy("signout");
    setAccountError("");
    setAccountMessage("");
    try {
      const { error } = await cloudClient.auth.signOut();
      if (error) throw error;
      setAccountSession(null);
      setAccountEntitlement(null);
      setCloudLedgers([]);
      setAccountMessage("Signed out. Local ledgers remain on this browser.");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Outflow could not sign out.");
    } finally {
      setAccountBusy("");
    }
  }

  async function removeCloudAccount() {
    if (!accountSession || accountBusy || cloudSyncingRef.current) return;
    if (!deleteAccountArmed) {
      setDeleteAccountArmed(true);
      return;
    }
    setAccountBusy("delete");
    setAccountError("");
    setAccountMessage("");
    try {
      await deleteCloudAccount();
      await cloudClient?.auth.signOut({ scope: "local" });
      setAccountSession(null);
      setAccountEntitlement(null);
      setCloudLedgers([]);
      setDeleteAccountArmed(false);
      setAccountMessage("Cloud account deleted. Local ledgers were not removed.");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Outflow could not delete this cloud account.");
    } finally {
      setAccountBusy("");
    }
  }

  async function acceptPendingInvitation() {
    if (!accountSession || !pendingInviteToken || accountBusy) return;
    setAccountBusy("accept-invite");
    setAccountError("");
    setAccountMessage("");
    try {
      const result = await acceptCloudLedgerInvitation(pendingInviteToken);
      window.history.replaceState(null, "", "#app");
      setPendingInviteToken("");
      setCloudAccessRefresh((current) => current + 1);
      setAccountMessage(`Joined ${result?.ledgerName || "shared ledger"} as ${result?.role || "member"}.`);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Outflow could not accept this invitation.");
    } finally {
      setAccountBusy("");
    }
  }

  async function sendLedgerInvite(event) {
    event.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!canInviteToManagedLedger || !email || accountBusy) return;
    setAccountBusy("send-invite");
    setAccountError("");
    setAccountMessage("");
    try {
      await sendCloudLedgerInvitation({ ledgerId: managedCloudLedger.id, email, role: inviteRole });
      setInviteEmail("");
      setCloudAccessRefresh((current) => current + 1);
      setAccountMessage(`Invitation sent to ${email}.`);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Outflow could not send this invitation.");
    } finally {
      setAccountBusy("");
    }
  }

  async function changeCloudMemberRole(userId, role) {
    if (!canInviteToManagedLedger || accountBusy || !["editor", "viewer"].includes(role)) return;
    setAccountBusy(`role:${userId}`);
    setAccountError("");
    setAccountMessage("");
    try {
      await updateCloudLedgerMemberRole(managedCloudLedger.id, userId, role);
      setCloudAccessRefresh((current) => current + 1);
      setAccountMessage(`Member access changed to ${role}.`);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Outflow could not update this member.");
    } finally {
      setAccountBusy("");
    }
  }

  async function removeCloudMember(userId) {
    if (!managedCloudLedger || managedCloudLedger.currentRole !== "owner" || accountBusy) return;
    const actionId = `${managedCloudLedger.id}:${userId}`;
    if (removeMemberArmed !== actionId) {
      setRemoveMemberArmed(actionId);
      setRevokeInviteArmed("");
      return;
    }
    setAccountBusy(`remove:${userId}`);
    setAccountError("");
    setAccountMessage("");
    try {
      await removeCloudLedgerMember(managedCloudLedger.id, userId);
      setRemoveMemberArmed("");
      setCloudAccessRefresh((current) => current + 1);
      setAccountMessage("Member removed from the cloud ledger.");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Outflow could not remove this member.");
    } finally {
      setAccountBusy("");
    }
  }

  async function revokeCloudInvite(invitationId) {
    if (!managedCloudLedger || managedCloudLedger.currentRole !== "owner" || accountBusy) return;
    if (revokeInviteArmed !== invitationId) {
      setRevokeInviteArmed(invitationId);
      setRemoveMemberArmed("");
      return;
    }
    setAccountBusy(`revoke:${invitationId}`);
    setAccountError("");
    setAccountMessage("");
    try {
      await revokeCloudLedgerInvitation(invitationId);
      setRevokeInviteArmed("");
      setCloudAccessRefresh((current) => current + 1);
      setAccountMessage("Pending invitation revoked.");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Outflow could not revoke this invitation.");
    } finally {
      setAccountBusy("");
    }
  }

  function closeLedgerControls() {
    setLedgerOpen(false);
    setDeleteLedgerId(null);
    setBackupSession(null);
    setBackupError("");
    setBackupLoading(false);
    setLedgerMeta((current) => sanitizeLedgerMeta(current));
  }

  function switchLedger(id) {
    if (cloudSyncingRef.current || !workspace.ledgers.some((entry) => entry.ledger.id === id)) return;
    setCloudLedgerSession(null);
    setCloudSyncStatus("off");
    setCloudSyncMessage("");
    setCloudRemotePending(false);
    setWorkspace((current) => ({ ...current, activeLedgerId: id }));
    resetForm();
    setDeleteLedgerId(null);
    setBackupSession(null);
    setBackupError("");
    setLedgerOpen(false);
    setCalendarCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    setSelectedDate(toDateInput(new Date()));
  }

  function createLocalLedger(event) {
    event.preventDefault();
    if (cloudSyncingRef.current || workspace.ledgers.length >= MAX_LEDGERS) return;
    const name = newLedgerName.trim().slice(0, 60);
    if (!name || !ledgerKinds.some((kind) => kind.value === newLedgerKind)) return;
    const ledger = sanitizeLedgerMeta({ name, kind: newLedgerKind });
    setCloudLedgerSession(null);
    setCloudSyncStatus("off");
    setCloudSyncMessage("");
    setCloudRemotePending(false);
    setWorkspace((current) => current.ledgers.length >= MAX_LEDGERS ? current : ({
      ...current,
      activeLedgerId: ledger.id,
      ledgers: [...current.ledgers, { ledger, subscriptions: [] }],
    }));
    setNewLedgerName("");
    setNewLedgerKind("household");
    setDeleteLedgerId(null);
    setBackupSession(null);
    resetForm();
    setLedgerOpen(false);
    presentGuestAccountPrompt("shared");
  }

  function deleteLocalLedger(id) {
    const target = workspace.ledgers.find((entry) => entry.ledger.id === id);
    if (!target || target.ledger.kind === "personal") return;
    if (deleteLedgerId !== id) {
      setDeleteLedgerId(id);
      return;
    }
    setWorkspace((current) => {
      const ledgers = current.ledgers.filter((entry) => entry.ledger.id !== id);
      const fallback = ledgers.find((entry) => entry.ledger.kind === "personal") || ledgers[0];
      return {
        ...current,
        activeLedgerId: current.activeLedgerId === id ? fallback.ledger.id : current.activeLedgerId,
        ledgers,
      };
    });
    setDeleteLedgerId(null);
    setBackupSession(null);
    resetForm();
    setLedgerOpen(false);
  }

  function exportLedgerBackup() {
    const backup = createLedgerBackup(ledgerMeta, subscriptions, alertSettings);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const ledgerSlug = ledgerMeta.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "personal";
    link.href = url;
    link.download = `outflow-${ledgerSlug}-backup-${toDateInput(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    presentGuestAccountPrompt("backup");
  }

  async function selectLedgerBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      setBackupSession(null);
      setBackupError("Backup files must be 2 MB or smaller.");
      return;
    }

    setBackupSession(null);
    setBackupError("");
    setBackupLoading(true);
    try {
      const parsed = JSON.parse(await file.text());
      const permission = "Notification" in window ? window.Notification.permission : "unsupported";
      setBackupSession({ ...parseLedgerBackup(parsed, permission), fileName: file.name.slice(0, 120) });
      setBackupError("");
    } catch (error) {
      setBackupSession(null);
      setBackupError(error instanceof Error ? error.message : "Outflow could not read this backup.");
    } finally {
      setBackupLoading(false);
    }
  }

  function mergeLedgerBackup() {
    if (!backupMergeCount || cloudLedgerWriteDisabled) return;
    const additions = backupMergeCandidates
      .slice(0, availableImportSlots)
      .map((subscription) => normalizeBillingDate(subscription));
    setSubscriptions((current) => [...current, ...additions].slice(0, MAX_SUBSCRIPTIONS));
    recordGuestAccountActivity();
    closeLedgerControls();
  }

  function replaceLedgerFromBackup() {
    if (!backupSession || usingCloudLedger) return;
    setSubscriptions(backupSession.subscriptions.map((subscription) => normalizeBillingDate(subscription)));
    setAlertSettings(backupSession.alertSettings);
    setLedgerMeta((current) => ({
      ...current,
      name: backupSession.ledger.name,
      updatedAt: new Date().toISOString(),
    }));
    recordGuestAccountActivity();
    closeLedgerControls();
  }

  function closeCsvImport() {
    setImportOpen(false);
    setCsvSession(null);
    setCsvMapping({});
    setCsvError("");
    setCsvLoading(false);
  }

  function openCsvImport() {
    if (!canUseCsvImport(accountEntitlement)) {
      openAccountControls("pro-csv");
      return;
    }
    if (!cloudLedgerWriteDisabled) setImportOpen(true);
  }

  function selectCsvFile(event) {
    if (!canUseCsvImport(accountEntitlement)) {
      event.target.value = "";
      closeCsvImport();
      openAccountControls("pro-csv");
      return;
    }
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setCsvError("");
    setCsvSession(null);
    setCsvMapping({});
    if (file.size > MAX_CSV_BYTES) {
      setCsvError("CSV files must be 2 MB or smaller.");
      return;
    }

    setCsvLoading(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (result) => {
        setCsvLoading(false);
        const headers = (result.meta.fields || []).map((header) => String(header).trim()).filter(Boolean);
        if (!headers.length) {
          setCsvError("No header row was found in this CSV.");
          return;
        }
        if (!result.data.length) {
          setCsvError("No subscription rows were found in this CSV.");
          return;
        }

        setCsvSession({
          fileName: file.name.slice(0, 120),
          headers,
          rows: result.data.slice(0, MAX_CSV_ROWS),
          truncated: result.data.length > MAX_CSV_ROWS,
          parserWarnings: result.errors.filter((error) => error.type !== "Delimiter").slice(0, 5),
        });
        setCsvMapping(guessCsvMapping(headers));
      },
      error: () => {
        setCsvLoading(false);
        setCsvError("Outflow could not read this CSV file.");
      },
    });
  }

  function confirmCsvImport() {
    if (!canUseCsvImport(accountEntitlement)) {
      closeCsvImport();
      openAccountControls("pro-csv");
      return;
    }
    const imported = importableCandidates
      .slice(0, availableImportSlots)
      .map((candidate) => normalizeBillingDate(candidate.subscription));
    if (!imported.length || cloudLedgerWriteDisabled) return;
    setSubscriptions((current) => [...current, ...imported].slice(0, MAX_SUBSCRIPTIONS));
    recordGuestAccountActivity();
    closeCsvImport();
  }

  return (
    <main className="min-h-screen text-zinc-200">
      <div className="mx-auto grid w-full max-w-[1560px] grid-cols-[minmax(0,1fr)] gap-3 px-3 py-3 sm:px-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="border border-zinc-800 bg-black/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] lg:sticky lg:top-3 lg:h-fit">
          <header className="border-b border-zinc-800 bg-zinc-950/70 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-300">cashflow console</div>
                <h1 className="mt-1 text-3xl font-black uppercase leading-none tracking-[0.14em] text-zinc-50">Outflow</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={onExit}
                  className="border border-zinc-700 bg-black px-2 py-1 font-mono text-[10px] font-black uppercase text-zinc-400 hover:border-zinc-400 hover:text-zinc-100"
                >
                  Home
                </button>
                <div className="border border-amber-500 bg-amber-400 px-2 py-1 font-mono text-[10px] font-black text-black">
                  LIVE
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 border border-zinc-800 font-mono text-[11px]">
              <div className="border-r border-zinc-800 px-2 py-2">
                <div className="text-zinc-600">ACTIVE</div>
                <div className="text-zinc-100">{activeSubscriptions.length}</div>
              </div>
              <div className="border-r border-zinc-800 px-2 py-2">
                <div className="text-zinc-600">PAUSED</div>
                <div className="text-zinc-100">{pausedCount}</div>
              </div>
              <div className="px-2 py-2">
                <div className="text-zinc-600">LINES</div>
                <div className="text-zinc-100">{subscriptions.length}</div>
              </div>
            </div>
          </header>

          <form onSubmit={submitSubscription} className="grid gap-3 p-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-300">
                {editingId ? "Edit subscription" : "Add subscription"}
              </h2>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="border border-zinc-700 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-zinc-400 hover:border-zinc-500 hover:text-zinc-100"
                >
                  Clear
                </button>
              )}
            </div>

            <fieldset disabled={cloudLedgerWriteDisabled} className="contents">
            <Field label="Name">
              <input
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                maxLength={100}
                required
                placeholder="Figma, Slack, AWS..."
                className="h-10 border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-amber-400"
              />
            </Field>

            <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-3">
              <Field label="Amount">
                <input
                  type="number"
                  min="0.01"
                  max="1000000000"
                  step="0.01"
                  value={form.amount}
                  onChange={(event) => updateField("amount", event.target.value)}
                  required
                  placeholder="0.00"
                  className="h-10 border border-zinc-700 bg-zinc-950 px-3 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-amber-400"
                />
              </Field>

              <Field label="Currency">
                <select
                  value={form.currency}
                  onChange={(event) => updateField("currency", event.target.value)}
                  className="h-10 min-w-0 border border-zinc-700 bg-zinc-950 px-2 font-mono text-xs text-zinc-100 outline-none focus:border-amber-400"
                >
                  {currencies.map((currency) => (
                    <option
                      key={currency}
                      value={currency}
                      disabled={!canUseCurrency(currency, accountEntitlement, editingSubscription?.currency)}
                    >
                      {currency}{!canUseCurrency(currency, accountEntitlement, editingSubscription?.currency) ? " / Pro" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {!hasProAccess && (
              <button
                type="button"
                onClick={() => openAccountControls("pro-currency")}
                className="text-left font-mono text-[9px] uppercase leading-4 text-zinc-600 hover:text-amber-300"
              >
                USD on Free / existing currencies retained / Pro adds currencies
              </button>
            )}

            <div className="grid gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
              Cycle
              <div className="grid h-10 grid-cols-3 border border-zinc-700 bg-zinc-950">
                {cycles.map((cycle) => (
                  <button
                    key={cycle.value}
                    type="button"
                    aria-label={cycle.label}
                    aria-pressed={form.cycle === cycle.value}
                    title={cycle.label}
                    onClick={() => updateField("cycle", cycle.value)}
                    className={`border-r border-zinc-800 px-2 text-[11px] uppercase tracking-[0.08em] last:border-r-0 ${
                      form.cycle === cycle.value
                        ? "bg-amber-400 font-black text-black"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                    }`}
                  >
                    {cycle.value === "weekly" ? "Wk" : cycle.value === "monthly" ? "Mo" : "Yr"}
                  </button>
                ))}
              </div>
            </div>

            <Field label="Next billing date">
              <input
                type="date"
                value={form.nextBillingDate}
                onInput={(event) => updateField("nextBillingDate", event.currentTarget.value)}
                required
                className="h-10 border border-zinc-700 bg-zinc-950 px-3 font-mono text-sm text-zinc-100 outline-none focus:border-amber-400"
              />
            </Field>

            <Field label="Category">
              <input
                value={form.category}
                onChange={(event) => updateField("category", event.target.value)}
                maxLength={60}
                placeholder="Streaming"
                className="h-10 border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-amber-400"
              />
            </Field>

            <Field label="Tags">
              <input
                value={form.tags}
                onChange={(event) => updateField("tags", event.target.value)}
                maxLength={249}
                placeholder="personal, work, shared"
                className="h-10 border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-amber-400"
              />
            </Field>

            <Field label="Trial ends">
              <input
                type="date"
                value={form.trialEndDate}
                onInput={(event) => updateField("trialEndDate", event.currentTarget.value)}
                className="h-10 min-w-0 border border-zinc-700 bg-zinc-950 px-3 font-mono text-xs text-zinc-100 outline-none focus:border-amber-400"
              />
            </Field>

            <div className="grid gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
              <div className="flex items-center justify-between gap-3">
                <span>Alert lead times</span>
                {hasProAccess ? (
                  <span className={`font-mono ${form.reminderLeadDays.length ? "text-amber-300" : "text-zinc-700"}`}>
                    {form.reminderLeadDays.length ? `${form.reminderLeadDays.length} armed` : "Off"} / Pro
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openAccountControls("pro-reminders")}
                    className={`font-mono hover:text-amber-200 ${form.reminderLeadDays.length ? "text-amber-300" : "text-zinc-700"}`}
                  >
                    {form.reminderLeadDays.length ? `${form.reminderLeadDays.length} armed` : "Off"} / Free 1
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 border border-zinc-700 bg-zinc-950" role="group" aria-label="Alert lead times">
                {reminderLeadOptions.map((option, index) => {
                  const selected = form.reminderLeadDays.includes(option.value);
                  const available = canToggleReminderLeadDay({
                    days: option.value,
                    selectedLeadDays: form.reminderLeadDays,
                    entitlement: accountEntitlement,
                    originalLeadDays: editingSubscription?.reminderLeadDays,
                  });
                  return (
                    <label
                      key={option.value}
                      title={option.label}
                      className={`flex h-9 cursor-pointer items-center justify-center gap-1.5 border-zinc-800 font-mono text-[10px] tracking-normal ${
                        index < 3 ? "border-b" : ""
                      } ${index % 3 < 2 ? "border-r" : ""} ${
                        selected
                          ? "bg-zinc-800 text-amber-300"
                          : available
                            ? "bg-black text-zinc-500 hover:text-zinc-200"
                            : "bg-black text-zinc-700 hover:text-amber-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleReminderLeadDay(option.value)}
                        aria-label={`${option.label}${available ? "" : " / requires Pro while another lead time is selected"}`}
                        className="h-3 w-3 accent-amber-400"
                      />
                      {option.value === 0 ? "DAY" : `${option.value}D`}
                    </label>
                  );
                })}
              </div>
            </div>

            <Field label="Color tag">
              <div className="grid grid-cols-6 border border-zinc-800 bg-zinc-950" role="group" aria-label="Color tag">
                {colorTags.map((tag) => (
                  <button
                    key={tag.value}
                    type="button"
                    aria-label={tag.label}
                    aria-pressed={form.color === tag.value}
                    title={tag.label}
                    onClick={(event) => {
                      updateField("color", tag.value);
                      event.currentTarget.blur();
                    }}
                    className={`relative h-9 border-r border-zinc-800 outline-none last:border-r-0 ${
                      form.color === tag.value ? "bg-zinc-800" : "bg-black hover:bg-zinc-950"
                    }`}
                  >
                    <span className="mx-auto block h-3 w-5" style={{ background: tag.value }} />
                    {form.color === tag.value && (
                      <span className="absolute inset-x-2 bottom-1 h-0.5 bg-amber-300" />
                    )}
                  </button>
                ))}
              </div>
            </Field>

            <label className="flex h-10 items-center justify-between border border-zinc-800 bg-zinc-950 px-3 text-xs uppercase tracking-[0.14em] text-zinc-400">
              Paused
              <input
                type="checkbox"
                checked={form.paused}
                onChange={(event) => updateField("paused", event.target.checked)}
                className="h-4 w-4 accent-amber-400"
              />
            </label>

            <button
              type="submit"
              className="h-11 border border-amber-400 bg-amber-400 px-3 text-xs font-black uppercase tracking-[0.18em] text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
            >
              {editingId ? "Commit changes" : "Add subscription"}
            </button>
            </fieldset>
          </form>
        </aside>

        <section className="grid min-w-0 gap-3">
          <header className="border border-zinc-800 bg-black/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="grid gap-3 p-3 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">recurring debit monitor</div>
                <div className="mt-1 text-xl font-black uppercase tracking-[0.12em] text-zinc-50">Command Deck</div>
              </div>
              <div className="grid border border-zinc-800 font-mono text-xs sm:grid-cols-[auto_auto_auto]">
                <div className="border-b border-zinc-800 px-3 py-2 sm:border-b-0 sm:border-r">
                  <span className="text-zinc-600">TODAY </span>
                  <span className="text-zinc-300">{shortDate(toDateInput(new Date()))}</span>
                </div>
                <div className="border-b border-zinc-800 px-3 py-2 sm:border-b-0 sm:border-r">
                  <span className="text-zinc-600">NEXT </span>
                  <span className="text-amber-300">{nextCharge ? `${nextCharge.name} ${dayLabel(nextCharge.daysOut)}` : "clear"}</span>
                </div>
                <div className="px-3 py-2">
                  <span className="text-zinc-600">30D </span>
                  <span className="text-zinc-100">{formatCurrencyTotals(thirtyDayTotals)}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-zinc-800 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
                <button
                  type="button"
                  onClick={() => setLedgerOpen(true)}
                  aria-label={`Open ${ledgerMeta.name} ledger controls`}
                  className="flex items-center gap-2 text-zinc-300 hover:text-amber-300"
                >
                  <span className={`h-2 w-2 ${
                    usingCloudLedger
                      ? cloudSyncStatus === "synced" ? "bg-emerald-400" : cloudSyncStatus === "read-only" ? "bg-zinc-500" : "bg-amber-400"
                      : pwa.online ? "bg-emerald-400" : "bg-red-400"
                  }`} />
                  <span className="max-w-40 truncate">{ledgerMeta.name}</span>
                  <span className="text-zinc-700">/</span>
                  <span className="text-zinc-500">
                    {ledgerKindLabel(ledgerMeta.kind)} / {usingCloudLedger ? `Cloud ${ledgerMeta.currentRole}` : "Local"}
                  </span>
                </button>
                <span className="text-zinc-700">/</span>
                <span className={usingCloudLedger
                  ? cloudSyncStatus === "synced" ? "text-emerald-400" : cloudSyncStatus === "offline" ? "text-red-300" : "text-amber-300"
                  : pwa.online ? "text-zinc-600" : "text-red-300"
                }>
                  {usingCloudLedger ? cloudSyncStatus : pwa.online ? "Online" : "Offline"}
                </span>
                {usingCloudLedger && (["stale", "conflict", "offline"].includes(cloudSyncStatus) || cloudRemotePending) && (
                  <button
                    type="button"
                    onClick={refreshActiveCloudLedger}
                    disabled={cloudSyncingRef.current}
                    className="border border-amber-800 px-2 py-1 font-mono text-[9px] font-black uppercase text-amber-300 hover:border-amber-400 disabled:opacity-40"
                  >
                    Refresh
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                {pwa.offlineReady && (
                  <span className="border border-emerald-900 px-2 py-1.5 font-mono text-[10px] font-black uppercase text-emerald-400">
                    Offline ready
                  </span>
                )}
                {pwa.canInstall && (
                  <button
                    type="button"
                    onClick={installOutflow}
                    className="border border-amber-700 bg-black px-2 py-1.5 font-mono text-[10px] font-black uppercase text-amber-300 hover:border-amber-400"
                  >
                    Install
                  </button>
                )}
                {pwa.updateAvailable && (
                  <button
                    type="button"
                    onClick={pwa.applyUpdate}
                    className="border border-cyan-700 bg-black px-2 py-1.5 font-mono text-[10px] font-black uppercase text-cyan-300 hover:border-cyan-400"
                  >
                    Update ready
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openAccountControls()}
                  aria-label={accountSession?.user?.email ? `Open account controls for ${accountSession.user.email}` : "Open optional account controls"}
                  className={`border bg-black px-2 py-1.5 font-mono text-[10px] font-black uppercase ${
                    accountSession
                      ? "border-cyan-700 text-cyan-300 hover:border-cyan-400"
                      : "border-zinc-700 text-zinc-400 hover:border-amber-400 hover:text-amber-300"
                  }`}
                >
                  Account / {accountLoading ? "Check" : accountSession ? "Signed in" : "Guest"}
                </button>
                <button
                  type="button"
                  onClick={() => setAlertSettingsOpen(true)}
                  className={`border bg-black px-2 py-1.5 font-mono text-[10px] font-black uppercase ${
                    alertSettings.deviceEnabled && notificationPermission === "granted"
                      ? "border-emerald-700 text-emerald-300 hover:border-emerald-400"
                      : "border-zinc-700 text-zinc-400 hover:border-amber-400 hover:text-amber-300"
                  }`}
                >
                  Alert rules / {alertSettings.deviceEnabled && notificationPermission === "granted" ? "On" : "Off"}
                </button>
                <button
                  type="button"
                  onClick={openCsvImport}
                  disabled={hasProAccess && cloudLedgerWriteDisabled}
                  className="border border-zinc-700 bg-black px-2 py-1.5 font-mono text-[10px] font-black uppercase text-zinc-300 hover:border-zinc-400 hover:text-white disabled:cursor-not-allowed disabled:border-zinc-900 disabled:text-zinc-700"
                >
                  Import CSV / {hasProAccess ? "Pro" : "Locked"}
                </button>
                <button
                  type="button"
                  onClick={exportCsv}
                  className="border border-zinc-700 bg-black px-2 py-1.5 font-mono text-[10px] font-black uppercase text-zinc-300 hover:border-zinc-400 hover:text-white"
                >
                  Export CSV
                </button>
              </div>
            </div>
          </header>

          {accountPromptContext && accountPromptDetails && cloudConfigured && !accountSession && (
            <section
              role="status"
              aria-label="Optional account prompt"
              className="grid gap-3 border border-amber-800 bg-amber-950/15 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="min-w-0">
                <div className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-amber-300">{accountPromptDetails.code}</div>
                <div className="mt-1 text-sm font-black uppercase tracking-[0.06em] text-zinc-100">{accountPromptDetails.title}</div>
                <div className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500">{accountPromptDetails.detail}</div>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={() => openAccountControls(accountPromptContext)}
                  className="h-9 border border-amber-400 bg-amber-400 px-3 text-[10px] font-black uppercase tracking-[0.1em] text-black hover:bg-amber-300"
                >
                  Create optional account
                </button>
                <button
                  type="button"
                  onClick={dismissGuestAccountPrompt}
                  className="h-9 border border-zinc-700 px-3 font-mono text-[10px] font-black uppercase text-zinc-400 hover:border-zinc-400 hover:text-zinc-100"
                >
                  Dismiss 30 days
                </button>
              </div>
            </section>
          )}

          {usingCloudLedger && (
            <LiveMessage
              kind={["offline", "conflict", "stale"].includes(cloudSyncStatus) ? "alert" : "status"}
              aria-busy={["loading", "syncing", "refreshing"].includes(cloudSyncStatus)}
              className={`grid gap-2 border px-3 py-2 font-mono text-[10px] uppercase sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
              cloudSyncStatus === "offline"
                ? "border-red-900 bg-red-950/25 text-red-200"
                : cloudSyncStatus === "conflict" || cloudSyncStatus === "stale"
                  ? "border-amber-900 bg-amber-950/20 text-amber-200"
                  : "border-cyan-950 bg-cyan-950/10 text-cyan-200"
              }`}
            >
              <span>{cloudSyncMessage || `Cloud revision ${ledgerMeta.revision}`}</span>
              <span aria-hidden="true" className="text-zinc-600">Rev {ledgerMeta.revision} / local ledgers isolated</span>
            </LiveMessage>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCell label="Monthly outflow" value={formatCurrencyTotals(monthlyTotals)} sublabel={`${activeSubscriptions.length} active subscriptions / no FX conversion`} tone="hot" code="MRC" />
            <StatCell label="Next charge" value={nextCharge ? money(nextCharge.amount, nextCharge.currency) : "$0.00"} sublabel={nextCharge ? `${nextCharge.name} / ${fullDate(nextCharge.date)}` : "No active charges"} code="DUE" />
            <StatCell label="30 day pull" value={formatCurrencyTotals(thirtyDayTotals)} sublabel={`${timeline.length} scheduled debit events / no FX conversion`} code="T+30" />
            <StatCell label="Annualized" value={formatCurrencyTotals(yearlyRunRateTotals)} sublabel="Projected run rate / no FX conversion" code="ARR" />
          </div>

          <Panel title="Alerts" marker action={<span className="font-mono text-xs text-amber-300">{alerts.length}</span>}>
            <div className="grid divide-y divide-zinc-900 md:grid-cols-2 md:divide-x md:divide-y-0 md:divide-zinc-900">
              {alerts.length ? (
                alerts.map((alert) => (
                  <div key={alert.id} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 shrink-0" style={{ background: alert.color }} />
                        <span className="truncate text-sm font-bold text-zinc-100">{alert.name}</span>
                        <span className={`shrink-0 border px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                          alert.type === "trial" ? "border-cyan-800 text-cyan-300" : "border-amber-800 text-amber-300"
                        }`}>
                          {alert.type}
                        </span>
                        {alert.paused && <span className="shrink-0 border border-zinc-700 px-1.5 py-0.5 font-mono text-[9px] uppercase text-zinc-500">Paused</span>}
                      </div>
                      <div className="mt-1 font-mono text-xs text-zinc-500">
                        {alert.type === "trial" ? "Trial ends" : "Bills"} {fullDate(alert.date)} / {dayLabel(alert.daysOut)}
                      </div>
                    </div>
                    <div className="font-mono text-sm font-black text-amber-300">{money(alert.amount, alert.currency)}</div>
                  </div>
                ))
              ) : (
                <div className="px-3 py-6 text-sm text-zinc-500 md:col-span-2">No charge or trial reminders are due today.</div>
              )}
            </div>
          </Panel>

          <Panel
            title="Cash-out forecast"
            marker
            action={(
              <div className="grid grid-cols-3 border border-zinc-700" role="group" aria-label="Forecast horizon">
                {[30, 60, 90].map((days) => (
                  <button
                    key={days}
                    type="button"
                    aria-pressed={forecastHorizon === days}
                    onClick={() => setForecastHorizon(days)}
                    className={`border-r border-zinc-700 px-2 py-1 font-mono text-[10px] font-black last:border-r-0 ${
                      forecastHorizon === days ? "bg-amber-400 text-black" : "bg-black text-zinc-500 hover:text-zinc-100"
                    }`}
                  >
                    {days}D
                  </button>
                ))}
              </div>
            )}
          >
            <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 border-b border-zinc-800 xl:border-b-0 xl:border-r">
                <div className="grid grid-cols-3 border-b border-zinc-800 font-mono">
                  <div className="border-r border-zinc-800 px-3 py-3">
                    <div className="text-[9px] uppercase text-zinc-600 sm:text-[10px]">Scheduled</div>
                    <div className="mt-1 truncate text-sm font-black text-amber-300 sm:text-lg">{formatCurrencyTotals(forecastTotals)}</div>
                  </div>
                  <div className="border-r border-zinc-800 px-3 py-3">
                    <div className="text-[9px] uppercase text-zinc-600 sm:text-[10px]">Debits</div>
                    <div className="mt-1 text-sm font-black text-zinc-100 sm:text-lg">{forecastTimeline.length}</div>
                  </div>
                  <div className="px-3 py-3">
                    <div className="text-[9px] uppercase text-zinc-600 sm:text-[10px]">Avg / week</div>
                    <div className="mt-1 truncate text-sm font-black text-zinc-100 sm:text-lg">
                      {formatCurrencyTotals(forecastWeeklyAverageTotals)}
                    </div>
                  </div>
                </div>

                <div className="grid gap-2 p-3">
                  <div className="grid grid-cols-[74px_minmax(0,1fr)_72px] gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-700 sm:grid-cols-[112px_minmax(0,1fr)_88px] sm:text-[10px]">
                    <span>Window</span>
                    <span>Events</span>
                    <span className="text-right">Pull</span>
                  </div>
                  {forecastWeeks.map((week) => {
                    const width = forecastPeak ? (week.count / forecastPeak) * 100 : 0;
                    return (
                      <div key={week.id} className="grid min-h-7 grid-cols-[74px_minmax(0,1fr)_72px] items-center gap-2 sm:grid-cols-[112px_minmax(0,1fr)_88px]">
                        <div className="truncate font-mono text-[9px] text-zinc-500 sm:text-[10px]">{week.label}</div>
                        <div className="h-2 bg-zinc-900">
                          <div className="h-full bg-amber-400" style={{ width: `${width}%` }} />
                        </div>
                        <div className="text-right font-mono text-[10px] font-bold text-zinc-300 sm:text-xs">
                          {formatCurrencyTotals(week.totals)}
                          <span className="ml-1 text-[9px] text-zinc-700">/{week.count}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="min-w-0">
                <div className="border-b border-zinc-800 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                  Category load
                </div>
                <div className="grid gap-3 p-3">
                  {forecastCategories.length ? (
                    forecastCategories.map((category) => {
                      const width = forecastCategoryPeak ? (category.count / forecastCategoryPeak) * 100 : 0;
                      return (
                        <div key={category.name}>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="truncate font-bold uppercase text-zinc-400">{category.name}</span>
                            <span className="shrink-0 font-mono text-zinc-200">{formatCurrencyTotals(category.totals)}</span>
                          </div>
                          <div className="mt-1.5 flex h-1.5 bg-zinc-900">
                            <div className="bg-red-500" style={{ width: `${width}%` }} />
                          </div>
                          <div className="mt-1 font-mono text-[9px] uppercase text-zinc-700">{category.count} scheduled</div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="py-8 text-sm text-zinc-600">No active charges in this forecast window.</div>
                  )}
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            title="Billing calendar"
            marker
            action={(
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-amber-300">{formatCurrencyTotals(calendarMonthTotals)} / {calendarEvents.length}</span>
                <button
                  type="button"
                  onClick={() => setCalendarExportOpen(true)}
                  aria-label="Export calendar"
                  className="border border-zinc-700 bg-black px-2 py-1 font-mono text-[9px] font-black uppercase text-zinc-400 hover:border-amber-400 hover:text-amber-300"
                >
                  ICS
                </button>
              </div>
            )}
          >
            <div className="flex flex-col gap-3 border-b border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">Projected withdrawals</div>
                <div className="mt-1 text-lg font-black uppercase tracking-[0.08em] text-zinc-100">{monthLabel(calendarCursor)}</div>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] border border-zinc-700 font-mono text-[10px] font-black uppercase">
                <button type="button" onClick={() => moveCalendar(-1)} className="border-r border-zinc-700 px-3 py-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">Prev</button>
                <button type="button" onClick={showCurrentMonth} className="border-r border-zinc-700 px-3 py-2 text-amber-300 hover:bg-zinc-900">Today</button>
                <button type="button" onClick={() => moveCalendar(1)} className="px-3 py-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">Next</button>
              </div>
            </div>

            <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0">
                <div className="grid grid-cols-7 border-b border-zinc-800 bg-zinc-950 font-mono text-[9px] uppercase text-zinc-600 sm:text-[10px]">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                    <div key={day} className="border-r border-zinc-800 px-1 py-2 text-center last:border-r-0">
                      <span className="sm:hidden">{day[0]}</span>
                      <span className="hidden sm:inline">{day}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 bg-zinc-800 gap-px">
                  {calendarGrid.map((date) => {
                    const value = toDateInput(date);
                    const events = calendarEventsByDate.get(value) || [];
                    const dayTotals = totalsByCurrency(events);
                    const currentMonth = date.getMonth() === calendarCursor.getMonth();
                    const selected = selectedDate === value;
                    const today = value === toDateInput(new Date());

                    return (
                      <button
                        key={value}
                        type="button"
                        aria-label={`${fullDate(value)}${events.length ? `, ${events.length} ${events.length === 1 ? "charge" : "charges"} totaling ${formatCurrencyTotals(dayTotals)}` : ", no charges"}`}
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedDate(value);
                          if (!currentMonth) setCalendarCursor(new Date(date.getFullYear(), date.getMonth(), 1));
                        }}
                        className={`relative min-h-16 min-w-0 bg-black p-1.5 text-left hover:bg-zinc-950 sm:min-h-24 sm:p-2 ${
                          currentMonth ? "" : "bg-zinc-950/80"
                        } ${selected ? "shadow-[inset_0_0_0_1px_#fbbf24]" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-1 font-mono">
                          <span className={`text-[10px] sm:text-xs ${today ? "bg-amber-400 px-1 font-black text-black" : "text-zinc-500"}`}>
                            {date.getDate()}
                          </span>
                          {events.length > 0 && <span className="text-[8px] text-zinc-700 sm:text-[9px]">{events.length}X</span>}
                        </div>
                        {events.length > 0 && (
                          <div className="mt-2 min-w-0">
                            <div className="flex gap-0.5">
                              {events.slice(0, 3).map((event) => (
                                <span key={event.eventId} className="h-1 w-2 sm:h-1.5 sm:w-3" style={{ background: event.color }} />
                              ))}
                            </div>
                            <div className="mt-1 truncate font-mono text-[8px] font-black text-amber-300 sm:text-[10px]">{formatCurrencyTotals(dayTotals)}</div>
                            <div className="mt-1 hidden truncate text-[9px] uppercase text-zinc-600 sm:block">{events[0].name}</div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-w-0 border-t border-zinc-800 xl:border-l xl:border-t-0">
                <div className="border-b border-zinc-800 px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">Selected day</div>
                  <div className="mt-1 font-mono text-sm font-black text-zinc-200">{fullDate(selectedDate)}</div>
                  <div className="mt-1 font-mono text-xs text-amber-300">
                    {formatCurrencyTotals(totalsByCurrency(selectedDayEvents))} / {selectedDayEvents.length} {selectedDayEvents.length === 1 ? "debit" : "debits"}
                  </div>
                </div>
                <div className="divide-y divide-zinc-900">
                  {selectedDayEvents.length ? (
                    selectedDayEvents.map((event) => (
                      <div key={event.eventId} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0" style={{ background: event.color }} />
                            <span className="truncate text-sm font-bold text-zinc-100">{event.name}</span>
                          </div>
                          <div className="mt-1 text-xs text-zinc-600">{event.category} / {event.cycle}</div>
                        </div>
                        <div className="font-mono text-sm font-black text-amber-300">{money(event.amount, event.currency)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-8 text-sm text-zinc-600">No withdrawals scheduled for this day.</div>
                  )}
                </div>
              </div>
            </div>
          </Panel>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 2xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
              <Panel
                title="Active subscriptions"
                marker
                action={<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">identity / subscription / withdrawal</span>}
              >
                <div className="grid gap-3 p-3">
                  <div className="hidden grid-cols-[220px_minmax(0,1fr)_280px] gap-3 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600 lg:grid">
                    <div>Logo / Plan</div>
                    <div>Subscription</div>
                    <div>Withdrawal</div>
                  </div>

                  {sortedSubscriptions.map((subscription) => {
                    const daysOut = daysBetween(toDateInput(new Date()), subscription.nextBillingDate);
                    const urgent = !subscription.paused && daysOut <= 7;

                    return (
                      <article
                        key={subscription.id}
                        className={`grid gap-2 border border-zinc-800 bg-zinc-950/70 p-2 transition hover:border-zinc-700 lg:grid-cols-[220px_minmax(0,1fr)_280px] lg:gap-3 ${
                          subscription.paused ? "border-zinc-700 bg-black/70" : ""
                        }`}
                      >
                        <div className="border border-violet-500/60 bg-violet-950/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                          <div className="flex items-center justify-between gap-3">
                            <div
                              className="grid h-12 w-12 shrink-0 place-items-center border border-violet-300/70 bg-black font-mono text-sm font-black text-violet-200"
                              style={{ boxShadow: `inset 4px 0 0 ${subscription.color}` }}
                            >
                              {initials(subscription.name)}
                            </div>
                            <div className="text-right">
                              <div className="font-mono text-xl font-black leading-none text-violet-100">{money(subscription.amount, subscription.currency)}</div>
                              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-violet-300/70">
                                {subscription.cycle}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 border border-violet-400/20 font-mono text-[10px] uppercase">
                            <div className="border-r border-violet-400/20 px-2 py-1 text-violet-300/70">monthly eq.</div>
                            <div className="px-2 py-1 text-right text-violet-100">{money(monthlyEquivalent(subscription), subscription.currency)}</div>
                          </div>
                          <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-violet-300/60">
                            Alert {reminderLeadLabel(subscription.reminderLeadDays)}
                          </div>
                        </div>

                        <div className="border border-red-500/60 bg-red-950/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-lg font-black uppercase tracking-[0.08em] text-red-50">{subscription.name}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-red-200/70">
                                <span>{subscription.category}</span>
                                <span className="text-red-400/50">/</span>
                                <span className="font-mono uppercase">{subscription.cycle} billing / {subscription.currency}</span>
                              </div>
                              {subscription.tags.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {subscription.tags.map((tag) => (
                                    <span key={tag} className="border border-red-300/20 px-1.5 py-0.5 font-mono text-[9px] uppercase text-red-200/60">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {subscription.trialEndDate && (
                                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300/80">
                                  Trial ends {fullDate(subscription.trialEndDate)}
                                </div>
                              )}
                              {ledgerMeta.kind !== "personal" && (
                                <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-red-200/45">
                                  Added by {subscription.createdBy} / Updated by {subscription.updatedBy} / {new Date(subscription.updatedAt).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => togglePaused(subscription.id)}
                              disabled={cloudLedgerWriteDisabled}
                              className={`shrink-0 border px-2 py-1 font-mono text-[11px] uppercase disabled:cursor-not-allowed disabled:opacity-40 ${
                                subscription.paused
                                  ? "border-zinc-600 bg-black/40 text-zinc-400 hover:text-zinc-100"
                                  : "border-red-300/50 bg-black/30 text-red-100 hover:border-red-100"
                              }`}
                            >
                              {subscription.paused ? "Paused" : "Active"}
                            </button>
                          </div>

                          <div className="mt-4 flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => editSubscription(subscription)}
                              disabled={cloudLedgerWriteDisabled}
                              className="border border-red-200/30 bg-black/30 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-red-100 hover:border-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSubscription(subscription.id)}
                              disabled={cloudLedgerWriteDisabled}
                              className="border border-red-300/50 bg-black/30 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-red-100 hover:border-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Del
                            </button>
                          </div>
                        </div>

                        <div className="border border-emerald-500/60 bg-emerald-950/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-300/70">will pull</div>
                          <div className="mt-2 font-mono text-2xl font-black leading-none text-emerald-100">{money(subscription.amount, subscription.currency)}</div>
                          <div className={`mt-3 border-t border-emerald-400/20 pt-3 font-mono ${urgent ? "text-amber-200" : "text-emerald-100"}`}>
                            <div className="text-lg font-black">{fullDate(subscription.nextBillingDate)}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.14em] text-emerald-300/70">
                              {subscription.paused ? "paused schedule" : dayLabel(daysOut)}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </Panel>

              <Panel title="Next 7 days" marker action={<span className="font-mono text-xs text-amber-300">{upcomingWeek.length}</span>}>
                <div className="grid divide-y divide-zinc-900 md:grid-cols-2 md:divide-x md:divide-y-0 md:divide-zinc-900">
                  {upcomingWeek.length ? (
                    upcomingWeek.map((event) => (
                      <div key={event.eventId} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="h-3 w-3 shrink-0" style={{ background: event.color }} />
                            <span className="truncate text-sm font-bold text-zinc-100">{event.name}</span>
                          </div>
                          <div className="mt-1 font-mono text-xs text-zinc-500">{fullDate(event.date)} / {dayLabel(event.daysOut)}</div>
                        </div>
                        <div className="font-mono text-sm font-black text-amber-300">{money(event.amount, event.currency)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-6 text-sm text-zinc-500 md:col-span-2">No active charges inside the next week.</div>
                  )}
                </div>
              </Panel>
            </section>

            <Panel title="Upcoming 30 days" marker action={<span className="font-mono text-xs text-amber-300">{timeline.length}</span>} className="min-w-0">
              <ol className="max-h-[640px] overflow-auto">
                {timeline.length ? timeline.map((event) => (
                  <li key={event.eventId} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 border-b border-zinc-900 px-3 py-3">
                    <div className="font-mono text-xs text-zinc-500">
                      <div>{shortDate(event.date)}</div>
                      <div className="text-[10px] uppercase text-zinc-700">{dayLabel(event.daysOut)}</div>
                    </div>
                    <div className="min-w-0 border-l border-zinc-800 pl-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0" style={{ background: event.color }} />
                        <div className="truncate text-sm font-bold text-zinc-100">{event.name}</div>
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-600">{event.category}</div>
                    </div>
                    <div className="font-mono text-sm font-bold text-zinc-100">{money(event.amount, event.currency)}</div>
                  </li>
                )) : (
                  <li className="px-3 py-8 text-sm text-zinc-600">No active charges inside the next 30 days.</li>
                )}
              </ol>
            </Panel>
          </div>
        </section>
      </div>

      {accountOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-3 sm:p-6">
          <section
            ref={accountDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-controls-title"
            aria-busy={Boolean(accountBusy) || accountLoading || accountEntitlementLoading || emailPreferencesLoading || proOfferLoading || cloudLedgersLoading}
            tabIndex={-1}
            className="flex max-h-[calc(100vh-24px)] w-full max-w-2xl flex-col overflow-hidden border border-zinc-700 bg-[#090a0b] shadow-2xl sm:max-h-[calc(100vh-48px)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">Optional identity</div>
                <h2 id="account-controls-title" className="mt-1 truncate text-lg font-black uppercase tracking-[0.1em] text-zinc-100">Account / Pro</h2>
              </div>
              <button
                type="button"
                onClick={closeAccountControls}
                disabled={Boolean(accountBusy)}
                aria-label="Close account controls"
                data-dialog-initial-focus
                className="h-9 border border-zinc-700 px-3 font-mono text-xs font-black uppercase text-zinc-400 hover:border-zinc-400 hover:text-white disabled:opacity-40"
              >
                Close
              </button>
            </header>

            <div tabIndex={0} aria-label="Account and Pro details" className="min-h-0 flex-1 overflow-auto">
              <div className="grid grid-cols-2 border-b border-zinc-800 font-mono text-[10px] uppercase sm:grid-cols-4">
                <div className="border-b border-r border-zinc-800 px-3 py-2 sm:border-b-0">
                  Identity <span className={`ml-1 ${accountSession ? "text-cyan-300" : "text-zinc-400"}`}>{accountSession ? "Signed in" : "Guest"}</span>
                </div>
                <div className="border-b border-zinc-800 px-3 py-2 sm:border-b-0 sm:border-r">
                  Cloud <span className={`ml-1 ${cloudConfigured ? "text-emerald-300" : "text-zinc-500"}`}>{cloudConfigured ? "Ready" : "Not configured"}</span>
                </div>
                <div className="border-r border-zinc-800 px-3 py-2">
                  Ledgers <span className="ml-1 text-zinc-200">{workspace.ledgers.length}L / {cloudLedgersLoading ? "..." : `${cloudLedgers.length}C`}</span>
                </div>
                <div className="px-3 py-2">
                  Entitlement <span className={`ml-1 ${accountEntitlement?.status === "active" ? "text-amber-300" : "text-zinc-400"}`}>
                    {accountEntitlementLoading ? "Check" : accountEntitlement?.status === "active" ? "Pro" : "Free"}
                  </span>
                </div>
              </div>

              {accountEntryContext && accountPromptDetails && (
                <section className="border-b border-amber-900 bg-amber-950/15 px-4 py-3">
                  <div className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-amber-300">{accountPromptDetails.code}</div>
                  <div className="mt-1 text-sm font-black uppercase tracking-[0.06em] text-zinc-100">{accountPromptDetails.title}</div>
                  <div className="mt-1 text-xs leading-5 text-zinc-500">{accountPromptDetails.detail}</div>
                  <div className="mt-2 font-mono text-[9px] uppercase text-zinc-700">
                    {accountEntryContext.startsWith("pro-")
                      ? "Access changes only after the account entitlement is verified. Existing local records are not rewritten."
                      : "No upload occurs until Create cloud copy is selected after sign-in."}
                  </div>
                </section>
              )}

              <section aria-labelledby="access-model-title" className="border-b border-zinc-800">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2">
                  <span id="access-model-title" className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">Access model</span>
                  <span className="font-mono text-[9px] font-black uppercase text-amber-300">One payment / no renewal</span>
                </header>
                <div className="grid sm:grid-cols-2">
                  <div className="border-b border-zinc-800 p-4 sm:border-b-0 sm:border-r">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-black uppercase tracking-[0.1em] text-zinc-200">Free core</h3>
                      <span className="font-mono text-xs font-black text-emerald-300">$0</span>
                    </div>
                    <ul className="mt-3 divide-y divide-zinc-900 font-mono text-[10px] uppercase leading-5 text-zinc-500">
                      <li className="py-1.5">Local subscription tracking</li>
                      <li className="py-1.5">Forecasts and billing calendar</li>
                      <li className="py-1.5">One device or trial reminder per record</li>
                      <li className="py-1.5">CSV, backup, and calendar exports</li>
                      <li className="py-1.5">USD entry / existing data retained</li>
                    </ul>
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-black uppercase tracking-[0.1em] text-zinc-200">Lifetime Pro</h3>
                      <span className="font-mono text-xs font-black text-amber-300">
                        {accountEntitlement?.status === "active"
                          ? "Active"
                          : proOffer
                            ? `${stripeMoney(proOffer.unitAmount, proOffer.currency)} once`
                            : "Paid once"}
                      </span>
                    </div>
                    <ul className="mt-3 divide-y divide-zinc-900 font-mono text-[10px] uppercase leading-5 text-zinc-500">
                      <li className="py-1.5">Cross-device sync and shared access</li>
                      <li className="py-1.5">Reviewed CSV import</li>
                      <li className="py-1.5">Multiple currencies / no conversion</li>
                      <li className="py-1.5">Multiple reminder lead times</li>
                      <li className="py-1.5">Durable email reminders</li>
                      <li className="py-1.5">Hosted calendar subscription</li>
                    </ul>
                  </div>
                </div>
              </section>

              {cloudConfigError && (
                <LiveMessage kind="alert" className="border-b border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{cloudConfigError}</LiveMessage>
              )}

              {!cloudConfigured && (
                <section className="border-b border-zinc-800 px-4 py-5">
                  <div className="text-sm font-black uppercase tracking-[0.08em] text-zinc-200">Cloud service setup pending</div>
                  <div className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">
                    This build remains guest-only. All {workspaceRecordCount} records stay in this browser and every Free-core workflow remains available without an account.
                  </div>
                </section>
              )}

              {cloudConfigured && accountLoading && (
                <LiveMessage className="border-b border-zinc-800 px-4 py-6 font-mono text-xs uppercase text-zinc-500">Checking account session...</LiveMessage>
              )}

              {cloudConfigured && !accountLoading && !accountSession && (
                <form onSubmit={sendAccountLink} className="grid gap-3 border-b border-zinc-800 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <Field label="Email address">
                    <input
                      type="email"
                      value={accountEmail}
                      required
                      maxLength={254}
                      autoComplete="email"
                      placeholder="you@example.com"
                      onChange={(event) => setAccountEmail(event.target.value.slice(0, 254))}
                      className="h-10 min-w-0 border border-zinc-700 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-amber-400"
                    />
                  </Field>
                  <button
                    type="submit"
                    disabled={accountBusy === "link" || !accountEmail.trim()}
                    className="h-10 border border-amber-400 bg-amber-400 px-4 text-xs font-black uppercase tracking-[0.1em] text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
                  >
                    {accountBusy === "link" ? "Sending..." : "Email sign-in link"}
                  </button>
                  <div className="font-mono text-[9px] uppercase text-zinc-700 sm:col-span-2">
                    {pendingInviteToken
                      ? "Sign in with the address that received this private invitation. Local ledger data stays untouched."
                      : proReturn === "success"
                        ? "Sign in to confirm and restore the account entitlement. The return URL does not grant Pro."
                        : "Creating an account does not upload or remove local ledger data."}
                  </div>
                </form>
              )}

              {accountSession && (
                <>
                  {pendingInviteToken && (
                    <section className="grid gap-3 border-b border-amber-900 bg-amber-950/15 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.12em] text-amber-200">Private ledger invitation</div>
                        <div className="mt-1 font-mono text-[10px] uppercase leading-5 text-zinc-500">
                          Acceptance is limited to the account email that received this link.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={acceptPendingInvitation}
                        disabled={Boolean(accountBusy)}
                        className="h-10 border border-amber-400 bg-amber-400 px-4 text-xs font-black uppercase tracking-[0.1em] text-black hover:bg-amber-300 disabled:opacity-40"
                      >
                        {accountBusy === "accept-invite" ? "Joining..." : "Accept invitation"}
                      </button>
                    </section>
                  )}

                  <section className="grid gap-3 border-b border-zinc-800 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">Authenticated identity</div>
                      <div className="mt-1 truncate text-sm font-bold text-zinc-200">{accountSession.user.email || "Email unavailable"}</div>
                      <div className="mt-1 font-mono text-[9px] uppercase text-zinc-700">
                        {usingCloudLedger ? `${ledgerMeta.name} cloud ledger active / local workspace isolated` : "Local workspace active"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={signOutAccount}
                      disabled={Boolean(accountBusy) || cloudSyncStatus === "syncing"}
                      className="h-9 border border-zinc-700 px-3 font-mono text-[10px] font-black uppercase text-zinc-400 hover:border-zinc-400 hover:text-white disabled:opacity-40"
                    >
                      {accountBusy === "signout" ? "Signing out..." : "Sign out"}
                    </button>
                  </section>

                  <section className="grid gap-3 border-b border-zinc-800 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-xs font-black uppercase tracking-[0.12em] text-zinc-200">Outflow Pro</div>
                        <span className={`border px-1.5 py-0.5 font-mono text-[9px] font-black uppercase ${
                          accountEntitlement?.status === "active"
                            ? "border-amber-700 text-amber-300"
                            : "border-zinc-800 text-zinc-600"
                        }`}>
                          {accountEntitlementLoading ? "Checking" : accountEntitlement?.status === "active" ? "Lifetime active" : "One-time unlock"}
                        </span>
                      </div>
                      <LiveMessage kind={proOfferError ? "alert" : "status"} className="mt-2 font-mono text-[10px] uppercase leading-5 text-zinc-600">
                        {accountEntitlement?.status === "active"
                          ? `Purchased ${accountEntitlement.purchased_at ? shortDate(accountEntitlement.purchased_at.slice(0, 10)) : "previously"} / ${accountEntitlement.provider || "account"} / no renewal`
                          : proOfferLoading
                            ? "Loading the hosted one-time offer"
                            : proOffer
                              ? `${proOffer.name} / ${stripeMoney(proOffer.unitAmount, proOffer.currency)} once / no product subscription`
                              : proOfferError || "One-time checkout has not been configured"}
                      </LiveMessage>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      {accountEntitlement?.status !== "active" && (
                        <button
                          type="button"
                          onClick={startProCheckout}
                          disabled={Boolean(accountBusy) || accountEntitlementLoading || proOfferLoading || !proOffer}
                          className="h-10 border border-amber-400 bg-amber-400 px-4 text-xs font-black uppercase tracking-[0.1em] text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
                        >
                          {accountBusy === "checkout" ? "Opening Stripe..." : "Review checkout"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={restoreProAccess}
                        disabled={Boolean(accountBusy) || accountEntitlementLoading}
                        className="h-10 border border-zinc-700 px-3 font-mono text-[10px] font-black uppercase text-zinc-400 hover:border-zinc-400 hover:text-white disabled:opacity-40"
                      >
                        {accountBusy === "restore-pro" ? "Checking..." : "Restore access"}
                      </button>
                    </div>
                  </section>

                  <form onSubmit={saveEmailReminderSettings} className="border-b border-zinc-800">
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-900 px-4 py-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">Email reminder channel</span>
                      <span className={`font-mono text-[9px] font-black uppercase ${
                        emailPreferences.emailEnabled && accountEntitlement?.status === "active"
                          ? "text-amber-300"
                          : emailPreferences.emailEnabled
                            ? "text-red-300"
                            : "text-zinc-600"
                      }`}>
                        {emailPreferencesLoading
                          ? "Loading"
                          : emailPreferences.emailEnabled
                            ? accountEntitlement?.status === "active" ? "Enabled" : "Suspended"
                            : "Disabled"}
                      </span>
                    </header>
                    <div className="grid sm:grid-cols-2">
                      <label className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-900 px-4 py-3 sm:border-r">
                        <span className="min-w-0">
                          <span className="block text-xs font-black uppercase tracking-[0.1em] text-zinc-200">Email reminders</span>
                          <span className="mt-1 block font-mono text-[9px] uppercase leading-4 text-zinc-600">
                            Independent from local device alerts / Pro
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          checked={emailPreferences.emailEnabled}
                          disabled={emailPreferencesLoading || (accountEntitlement?.status !== "active" && !emailPreferences.emailEnabled)}
                          onChange={(event) => setEmailPreferences((current) => ({ ...current, emailEnabled: event.target.checked }))}
                          className="h-5 w-5 accent-amber-400 disabled:opacity-30"
                        />
                      </label>
                      <label className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-900 px-4 py-3">
                        <span className="min-w-0">
                          <span className="block text-xs font-black uppercase tracking-[0.1em] text-zinc-200">Paused schedules</span>
                          <span className="mt-1 block font-mono text-[9px] uppercase leading-4 text-zinc-600">
                            {emailPreferences.pausedScheduleEnabled ? "Included in email runs" : "Excluded from email runs"}
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          checked={emailPreferences.pausedScheduleEnabled}
                          disabled={emailPreferencesLoading || accountEntitlement?.status !== "active"}
                          onChange={(event) => setEmailPreferences((current) => ({ ...current, pausedScheduleEnabled: event.target.checked }))}
                          className="h-5 w-5 accent-amber-400 disabled:opacity-30"
                        />
                      </label>
                    </div>
                    <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <Field label="Reminder timezone">
                        <select
                          value={emailPreferences.timezone}
                          disabled={emailPreferencesLoading}
                          onChange={(event) => setEmailPreferences((current) => ({ ...current, timezone: event.target.value }))}
                          className="h-10 min-w-0 border border-zinc-700 bg-black px-3 font-mono text-[10px] text-zinc-200 outline-none focus:border-amber-400 disabled:opacity-40"
                        >
                          {!availableNotificationTimezones.includes(emailPreferences.timezone) && (
                            <option value={emailPreferences.timezone}>{emailPreferences.timezone}</option>
                          )}
                          {availableNotificationTimezones.map((timezone) => (
                            <option key={timezone} value={timezone}>{timezone}</option>
                          ))}
                        </select>
                      </Field>
                      <button
                        type="submit"
                        disabled={Boolean(accountBusy) || emailPreferencesLoading || (emailPreferences.emailEnabled && accountEntitlement?.status !== "active")}
                        className="h-10 border border-amber-700 px-4 font-mono text-[10px] font-black uppercase text-amber-300 hover:border-amber-400 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-700"
                      >
                        {accountBusy === "email-preferences" ? "Saving..." : "Save email rules"}
                      </button>
                      <div className="font-mono text-[9px] uppercase leading-4 text-zinc-700 sm:col-span-2">
                        {accountEntitlement?.status === "active"
                          ? "Delivery timing comes from each subscription's selected reminder lead days. Trial and charge notices are tracked separately."
                          : "A one-time Pro unlock enables durable email automation. Existing local device alerts remain free."}
                      </div>
                    </div>
                  </form>

                  <section className="grid gap-3 border-b border-zinc-800 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.12em] text-zinc-200">Upload local copy</div>
                      <div className="mt-1 font-mono text-[10px] uppercase text-zinc-600">
                        {accountEntitlementLoading
                          ? "Checking entitlement"
                          : cloudUploadRequiresPro
                            ? `${sharedWorkspaceCount} shared local ${sharedWorkspaceCount === 1 ? "ledger requires" : "ledgers require"} Pro`
                            : `${workspace.ledgers.length} ledgers / ${workspaceRecordCount} records / transactional`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={uploadLocalWorkspace}
                      disabled={Boolean(accountBusy) || accountEntitlementLoading || cloudUploadRequiresPro}
                      className="h-10 border border-cyan-700 bg-black px-4 text-xs font-black uppercase tracking-[0.1em] text-cyan-300 hover:border-cyan-400 disabled:opacity-40"
                    >
                      {accountBusy === "upload" ? "Uploading..." : "Create cloud copy"}
                    </button>
                  </section>

                  <section className="border-b border-zinc-800">
                    <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">Cloud ledger access</span>
                      <span className="font-mono text-[10px] uppercase text-cyan-300">
                        {cloudLedgersLoading ? "Checking" : `${cloudLedgers.length} visible`}
                      </span>
                    </header>

                    {!cloudLedgersLoading && cloudLedgers.length === 0 && (
                      <div className="px-4 py-4 font-mono text-[10px] uppercase leading-5 text-zinc-600">
                        No cloud ledgers yet. Upload a local workspace to create the first cloud revision.
                      </div>
                    )}

                    {cloudLedgers.map((cloudLedger) => {
                      const managing = managedCloudLedgerId === cloudLedger.id;
                      const manageable = cloudLedger.currentRole === "owner" && cloudLedger.kind !== "personal";
                      return (
                        <div key={cloudLedger.id} className="border-b border-zinc-900 last:border-b-0">
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black uppercase tracking-[0.08em] text-zinc-200">{cloudLedger.name}</div>
                              <div className="mt-1 font-mono text-[9px] uppercase text-zinc-600">
                                {ledgerKindLabel(cloudLedger.kind)} / {cloudLedger.currentRole} / {cloudLedger.members.length} {cloudLedger.members.length === 1 ? "member" : "members"} / rev {cloudLedger.revision}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openCloudLedger(cloudLedger.id)}
                                disabled={Boolean(accountBusy) || Boolean(cloudOpenId)}
                                className="h-8 border border-cyan-800 px-3 font-mono text-[9px] font-black uppercase text-cyan-300 hover:border-cyan-400 disabled:opacity-40"
                              >
                                {cloudOpenId === cloudLedger.id ? "Opening..." : "Open"}
                              </button>
                              {manageable && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setManagedCloudLedgerId(managing ? "" : cloudLedger.id);
                                    setInviteEmail("");
                                    setInviteRole("viewer");
                                    setRemoveMemberArmed("");
                                    setRevokeInviteArmed("");
                                  }}
                                  disabled={Boolean(accountBusy) || Boolean(cloudOpenId)}
                                  aria-expanded={managing}
                                  className="h-8 border border-zinc-700 px-3 font-mono text-[9px] font-black uppercase text-zinc-400 hover:border-zinc-400 hover:text-white disabled:opacity-40"
                                >
                                  {managing ? "Close" : "Members"}
                                </button>
                              )}
                            </div>
                          </div>

                          {managing && managedCloudLedger?.id === cloudLedger.id && (
                            <div className="border-t border-zinc-800 bg-black/40">
                              <div className="border-b border-zinc-900 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">Active members</div>
                              {managedCloudLedger.members.map((member) => {
                                const owner = member.role === "owner";
                                const actionId = `${managedCloudLedger.id}:${member.userId}`;
                                const memberName = member.userId === accountSession.user.id
                                  ? "You"
                                  : member.displayName || `Member ${member.userId.slice(0, 8)}`;
                                return (
                                  <div key={member.userId} className="grid gap-2 border-b border-zinc-900 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_120px_auto] sm:items-center">
                                    <div className="min-w-0">
                                      <div className="truncate text-xs font-bold text-zinc-300">{memberName}</div>
                                      <div className="mt-1 truncate font-mono text-[9px] uppercase text-zinc-700">{member.userId}</div>
                                    </div>
                                    {owner ? (
                                      <div className="font-mono text-[9px] font-black uppercase text-amber-300">Owner</div>
                                    ) : (
                                      <select
                                        value={member.role}
                                        onChange={(event) => changeCloudMemberRole(member.userId, event.target.value)}
                                        disabled={Boolean(accountBusy) || !canInviteToManagedLedger}
                                        aria-label={`Access level for ${memberName}`}
                                        className="h-8 border border-zinc-700 bg-black px-2 font-mono text-[10px] uppercase text-zinc-300 outline-none focus:border-amber-400 disabled:opacity-40"
                                      >
                                        <option value="editor">Editor</option>
                                        <option value="viewer">Viewer</option>
                                      </select>
                                    )}
                                    {!owner && (
                                      <button
                                        type="button"
                                        onClick={() => removeCloudMember(member.userId)}
                                        disabled={Boolean(accountBusy)}
                                        className={`h-8 border px-3 font-mono text-[9px] font-black uppercase disabled:opacity-40 ${
                                          removeMemberArmed === actionId
                                            ? "border-red-500 bg-red-950/30 text-red-100"
                                            : "border-red-950 text-red-400 hover:border-red-700"
                                        }`}
                                      >
                                        {accountBusy === `remove:${member.userId}` ? "Removing..." : removeMemberArmed === actionId ? "Confirm" : "Remove"}
                                      </button>
                                    )}
                                  </div>
                                );
                              })}

                              {managedCloudLedger.invitations.length > 0 && (
                                <>
                                  <div className="border-b border-zinc-900 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">Pending invitations</div>
                                  {managedCloudLedger.invitations.map((invitation) => (
                                    <div key={invitation.id} className="grid gap-2 border-b border-zinc-900 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                                      <div className="min-w-0">
                                        <div className="truncate text-xs font-bold text-zinc-300">{invitation.email}</div>
                                        <div className="mt-1 font-mono text-[9px] uppercase text-zinc-700">Expires {shortDate(invitation.expiresAt.slice(0, 10))}</div>
                                      </div>
                                      <div className="font-mono text-[9px] uppercase text-zinc-500">{invitation.role}</div>
                                      <button
                                        type="button"
                                        onClick={() => revokeCloudInvite(invitation.id)}
                                        disabled={Boolean(accountBusy)}
                                        className={`h-8 border px-3 font-mono text-[9px] font-black uppercase disabled:opacity-40 ${
                                          revokeInviteArmed === invitation.id
                                            ? "border-red-500 bg-red-950/30 text-red-100"
                                            : "border-zinc-800 text-zinc-500 hover:border-red-800 hover:text-red-300"
                                        }`}
                                      >
                                        {accountBusy === `revoke:${invitation.id}` ? "Revoking..." : revokeInviteArmed === invitation.id ? "Confirm" : "Revoke"}
                                      </button>
                                    </div>
                                  ))}
                                </>
                              )}

                              {canInviteToManagedLedger ? (
                                <form onSubmit={sendLedgerInvite} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_110px_auto] sm:items-end">
                                  <Field label="Invite by email">
                                    <input
                                      type="email"
                                      required
                                      maxLength={254}
                                      autoComplete="off"
                                      value={inviteEmail}
                                      onChange={(event) => setInviteEmail(event.target.value.slice(0, 254))}
                                      placeholder="member@example.com"
                                      className="h-9 min-w-0 border border-zinc-700 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-amber-400"
                                    />
                                  </Field>
                                  <Field label="Access">
                                    <select
                                      value={inviteRole}
                                      onChange={(event) => setInviteRole(event.target.value)}
                                      className="h-9 border border-zinc-700 bg-black px-2 font-mono text-[10px] uppercase text-zinc-300 outline-none focus:border-amber-400"
                                    >
                                      <option value="viewer">Viewer</option>
                                      <option value="editor">Editor</option>
                                    </select>
                                  </Field>
                                  <button
                                    type="submit"
                                    disabled={Boolean(accountBusy) || !inviteEmail.trim()}
                                    className="h-9 border border-cyan-700 px-3 text-[10px] font-black uppercase tracking-[0.08em] text-cyan-300 hover:border-cyan-400 disabled:opacity-40"
                                  >
                                    {accountBusy === "send-invite" ? "Sending..." : "Send invite"}
                                  </button>
                                </form>
                              ) : (
                                <div className="px-4 py-3 font-mono text-[9px] uppercase leading-5 text-zinc-700">
                                  Pro is required for new invitations and role changes. Existing members remain visible and removable.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </section>

                  <section className="grid gap-3 border-b border-red-950 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.12em] text-red-200">Delete cloud account</div>
                      <div className="mt-1 font-mono text-[10px] uppercase text-zinc-700">Local browser ledgers are retained</div>
                    </div>
                    <button
                      type="button"
                      onClick={removeCloudAccount}
                      disabled={Boolean(accountBusy) || cloudSyncStatus === "syncing"}
                      className={`h-10 border px-4 text-xs font-black uppercase tracking-[0.1em] disabled:opacity-40 ${
                        deleteAccountArmed
                          ? "border-red-500 bg-red-950/40 text-red-100"
                          : "border-red-950 bg-black text-red-400 hover:border-red-700"
                      }`}
                    >
                      {accountBusy === "delete" ? "Deleting..." : deleteAccountArmed ? "Confirm cloud delete" : "Delete account data"}
                    </button>
                  </section>
                </>
              )}

              {(accountMessage || accountError) && (
                <LiveMessage kind={accountError ? "alert" : "status"} className={`border-b px-4 py-3 text-sm ${
                  accountError ? "border-red-900 bg-red-950/40 text-red-200" : "border-emerald-900 bg-emerald-950/20 text-emerald-200"
                }`}>
                  {accountError || accountMessage}
                </LiveMessage>
              )}

            </div>
          </section>
        </div>
      )}

      {calendarExportOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-3 sm:p-6">
          <section
            ref={calendarDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-export-title"
            aria-busy={calendarFeedLoading || Boolean(calendarFeedBusy)}
            tabIndex={-1}
            className="flex max-h-[calc(100vh-24px)] w-full max-w-2xl flex-col overflow-hidden border border-zinc-700 bg-[#090a0b] shadow-2xl sm:max-h-[calc(100vh-48px)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">External calendar</div>
                <h2 id="calendar-export-title" className="mt-1 truncate text-lg font-black uppercase tracking-[0.1em] text-zinc-100">Calendar export</h2>
              </div>
              <button
                type="button"
                onClick={closeCalendarExport}
                aria-label="Close calendar export"
                data-dialog-initial-focus
                disabled={Boolean(calendarFeedBusy)}
                className="h-9 border border-zinc-700 px-3 font-mono text-xs font-black uppercase text-zinc-400 hover:border-zinc-400 hover:text-white disabled:opacity-40"
              >
                Close
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-auto">
              <div className="grid grid-cols-2 border-b border-zinc-800 font-mono text-[10px] uppercase sm:grid-cols-4">
                <div className="border-b border-r border-zinc-800 px-3 py-2 sm:border-b-0">
                  Ledger <span className="ml-1 text-zinc-200">{ledgerMeta.name}</span>
                </div>
                <div className="border-b border-zinc-800 px-3 py-2 sm:border-b-0 sm:border-r">
                  Events <span className="ml-1 text-zinc-200">{calendarExportSubscriptions.length}</span>
                </div>
                <div className="border-r border-zinc-800 px-3 py-2">
                  Paused <span className="ml-1 text-zinc-400">{pausedCalendarExportCount}</span>
                </div>
                <div className="px-3 py-2">
                  Identity <span className="ml-1 text-emerald-300">Stable</span>
                </div>
              </div>

              {usingCloudLedger && accountSession && (
                <section className="border-b border-zinc-800">
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-900 px-4 py-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">Hosted subscription / Pro</span>
                    <span role="status" aria-live="polite" aria-atomic="true" className={`font-mono text-[9px] font-black uppercase ${
                      calendarFeed && accountEntitlement?.status === "active" ? "text-emerald-300" : "text-zinc-600"
                    }`}>
                      {calendarFeedLoading
                        ? "Checking"
                        : calendarFeed
                          ? accountEntitlement?.status === "active" ? "Published" : "Suspended"
                          : "Not published"}
                    </span>
                  </header>

                  {!calendarFeedLoading && (
                    <>
                      <label className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-900 px-4 py-3">
                        <span className="min-w-0">
                          <span className="block text-xs font-black uppercase tracking-[0.1em] text-zinc-200">Feed paused schedules</span>
                          <span className="mt-1 block font-mono text-[9px] uppercase text-zinc-600">
                            Scope / {calendarFeedIncludePaused ? "included" : "excluded"}
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          checked={calendarFeedIncludePaused}
                          disabled={accountEntitlement?.status !== "active" || Boolean(calendarFeedBusy)}
                          onChange={(event) => setCalendarFeedIncludePaused(event.target.checked)}
                          className="h-5 w-5 accent-amber-400 disabled:opacity-30"
                        />
                      </label>

                      {calendarFeedSecretUrl && (
                        <div className="grid gap-2 border-b border-amber-900/60 bg-amber-950/10 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                          <Field label="Secret feed URL / shown once">
                            <input
                              readOnly
                              value={calendarFeedSecretUrl}
                              aria-label="Secret hosted calendar feed URL"
                              onFocus={(event) => event.currentTarget.select()}
                              className="h-10 min-w-0 border border-amber-800 bg-black px-3 font-mono text-[10px] text-amber-200 outline-none focus:border-amber-400"
                            />
                          </Field>
                          <button
                            type="button"
                            onClick={copyCalendarFeedUrl}
                            className="h-10 border border-amber-500 px-4 font-mono text-[10px] font-black uppercase text-amber-200 hover:bg-amber-950/30"
                          >
                            Copy URL
                          </button>
                        </div>
                      )}

                      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 font-mono text-[9px] uppercase leading-4 text-zinc-600">
                          {calendarFeed
                            ? `Rotated ${calendarFeed.rotatedAt ? shortDate(calendarFeed.rotatedAt.slice(0, 10)) : "previously"} / ${calendarFeed.lastAccessAt ? `last fetched ${shortDate(calendarFeed.lastAccessAt.slice(0, 10))}` : "not fetched"}`
                            : accountEntitlement?.status === "active"
                              ? "Private recurring feed / live cloud revisions"
                              : "One-time Pro unlock required"}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {calendarFeed && accountEntitlement?.status === "active" && (
                            <button
                              type="button"
                              onClick={saveCalendarFeedScope}
                              disabled={Boolean(calendarFeedBusy) || calendarFeed.includePaused === calendarFeedIncludePaused}
                              className="h-9 border border-zinc-700 px-3 font-mono text-[9px] font-black uppercase text-zinc-300 hover:border-zinc-400 disabled:opacity-30"
                            >
                              {calendarFeedBusy === "scope" ? "Saving..." : "Save scope"}
                            </button>
                          )}
                          {accountEntitlement?.status === "active" && (
                            <button
                              type="button"
                              onClick={publishCalendarFeed}
                              disabled={Boolean(calendarFeedBusy)}
                              className="h-9 border border-cyan-700 px-3 font-mono text-[9px] font-black uppercase text-cyan-300 hover:border-cyan-400 disabled:opacity-40"
                            >
                              {calendarFeedBusy === "publish" ? "Publishing..." : calendarFeed ? "Rotate URL" : "Publish feed"}
                            </button>
                          )}
                          {calendarFeed && (
                            <button
                              type="button"
                              onClick={revokeCalendarFeed}
                              disabled={Boolean(calendarFeedBusy)}
                              className={`h-9 border px-3 font-mono text-[9px] font-black uppercase disabled:opacity-40 ${
                                calendarFeedRevokeArmed
                                  ? "border-red-500 bg-red-950/30 text-red-100"
                                  : "border-red-950 text-red-400 hover:border-red-700"
                              }`}
                            >
                              {calendarFeedBusy === "revoke" ? "Revoking..." : calendarFeedRevokeArmed ? "Confirm revoke" : "Revoke"}
                            </button>
                          )}
                        </div>
                      </div>
                      {calendarFeedMessage && (
                        <LiveMessage className="border-t border-emerald-950 bg-emerald-950/10 px-4 py-2 text-xs text-emerald-200">{calendarFeedMessage}</LiveMessage>
                      )}
                    </>
                  )}
                </section>
              )}

              <label className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-800 px-4 py-3 hover:bg-zinc-950">
                <span className="min-w-0">
                  <span className="block text-xs font-black uppercase tracking-[0.14em] text-zinc-200">Download paused schedules</span>
                  <span className="mt-1 block font-mono text-[10px] uppercase text-zinc-600">
                    Scope / {includePausedCalendar ? "included" : "excluded"}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={includePausedCalendar}
                  onChange={(event) => setIncludePausedCalendar(event.target.checked)}
                  className="h-5 w-5 accent-amber-400"
                />
              </label>

              <div className="divide-y divide-zinc-900">
                {calendarExportSubscriptions.map((subscription) => (
                  <div key={subscription.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0" style={{ background: subscription.color }} />
                        <span className="truncate text-sm font-bold text-zinc-100">{subscription.name}</span>
                        {subscription.paused && <span className="border border-zinc-700 px-1.5 py-0.5 font-mono text-[9px] uppercase text-zinc-500">Paused</span>}
                      </div>
                      <div className="mt-1 font-mono text-[10px] uppercase text-zinc-600">
                        {subscription.cycle} / {fullDate(subscription.nextBillingDate)} / rev {subscription.revision}
                      </div>
                    </div>
                    <div className="font-mono text-sm font-black text-amber-300">{money(subscription.amount, subscription.currency)}</div>
                  </div>
                ))}
                {!calendarExportSubscriptions.length && (
                  <div className="px-4 py-8 text-sm text-zinc-600">No subscription schedules are available for export.</div>
                )}
              </div>
            </div>

            {calendarExportError && <LiveMessage kind="alert" className="border-t border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{calendarExportError}</LiveMessage>}

            <footer className="flex flex-col gap-2 border-t border-zinc-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="font-mono text-[10px] uppercase text-zinc-600">
                {formatCurrencyTotals(calendarExportTotals)} monthly / private / transparent
              </div>
              <button
                type="button"
                disabled={!calendarExportSubscriptions.length}
                onClick={exportCalendarFile}
                className="h-10 border border-amber-400 bg-amber-400 px-4 text-xs font-black uppercase tracking-[0.12em] text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
              >
                Download .ics
              </button>
            </footer>
          </section>
        </div>
      )}

      {ledgerOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-3 sm:p-6">
          <section
            ref={ledgerDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ledger-controls-title"
            aria-busy={cloudLedgersLoading || Boolean(cloudOpenId) || backupLoading}
            tabIndex={-1}
            className="flex max-h-[calc(100vh-24px)] w-full max-w-3xl flex-col overflow-hidden border border-zinc-700 bg-[#090a0b] shadow-2xl sm:max-h-[calc(100vh-48px)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">Data control</div>
                <h2 id="ledger-controls-title" className="mt-1 truncate text-lg font-black uppercase tracking-[0.1em] text-zinc-100">Ledger controls</h2>
              </div>
              <button
                type="button"
                onClick={closeLedgerControls}
                aria-label="Close ledger controls"
                data-dialog-initial-focus
                className="h-9 border border-zinc-700 px-3 font-mono text-xs font-black uppercase text-zinc-400 hover:border-zinc-400 hover:text-white"
              >
                Close
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-auto">
              <section className="border-b border-zinc-800">
                <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  <span>Local ledgers</span>
                  <span>{workspace.ledgers.length} / {MAX_LEDGERS}</span>
                </header>
                <div className="divide-y divide-zinc-900">
                  {workspace.ledgers.map((entry) => {
                    const active = !usingCloudLedger && entry.ledger.id === workspace.activeLedgerId;
                    const deleting = deleteLedgerId === entry.ledger.id;
                    return (
                      <div key={entry.ledger.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 ${active ? "bg-amber-950/15" : ""}`}>
                        <button
                          type="button"
                          onClick={() => switchLedger(entry.ledger.id)}
                          disabled={cloudSyncStatus === "syncing"}
                          aria-current={active ? "true" : undefined}
                          className="min-w-0 text-left disabled:opacity-40"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={`h-2.5 w-2.5 shrink-0 ${active ? "bg-amber-400" : "bg-zinc-700"}`} />
                            <span className="truncate text-sm font-black uppercase tracking-[0.08em] text-zinc-200">{entry.ledger.name}</span>
                            {active && <span className="border border-amber-800 px-1.5 py-0.5 font-mono text-[8px] uppercase text-amber-300">Active</span>}
                          </span>
                          <span className="mt-1 block pl-[18px] font-mono text-[10px] uppercase text-zinc-600">
                            {ledgerKindLabel(entry.ledger.kind)} / {entry.subscriptions.length} records / local only
                          </span>
                        </button>
                        {entry.ledger.kind !== "personal" && (
                          <button
                            type="button"
                            onClick={() => deleteLocalLedger(entry.ledger.id)}
                            className={`h-8 border px-2 font-mono text-[9px] font-black uppercase ${
                              deleting
                                ? "border-red-500 bg-red-950/40 text-red-200"
                                : "border-zinc-800 text-zinc-600 hover:border-red-700 hover:text-red-300"
                            }`}
                          >
                            {deleting ? `Confirm ${entry.subscriptions.length}` : "Delete"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <form onSubmit={createLocalLedger} className="grid gap-2 border-t border-zinc-800 p-4 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-end">
                  <Field label="New ledger">
                    <input
                      value={newLedgerName}
                      maxLength={60}
                      required
                      placeholder="Home, Studio..."
                      onChange={(event) => setNewLedgerName(event.target.value.slice(0, 60))}
                      className="h-10 min-w-0 border border-zinc-700 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-amber-400"
                    />
                  </Field>
                  <Field label="Kind">
                    <select
                      value={newLedgerKind}
                      onChange={(event) => setNewLedgerKind(event.target.value)}
                      className="h-10 border border-zinc-700 bg-black px-3 font-mono text-xs uppercase text-zinc-300 outline-none focus:border-amber-400"
                    >
                      {ledgerKinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
                    </select>
                  </Field>
                  <button
                    type="submit"
                    disabled={!newLedgerName.trim() || workspace.ledgers.length >= MAX_LEDGERS || cloudSyncStatus === "syncing"}
                    className="h-10 border border-zinc-600 bg-black px-3 text-xs font-black uppercase tracking-[0.1em] text-zinc-200 hover:border-amber-400 hover:text-amber-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-700"
                  >
                    Create local
                  </button>
                </form>
                <div className="border-t border-zinc-900 px-4 py-2 font-mono text-[9px] uppercase text-zinc-700">
                  Local ledgers stay on this browser and never merge into cloud totals unless explicitly uploaded.
                </div>
              </section>

              {accountSession && (
                <section className="border-b border-zinc-800">
                  <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                    <span>Cloud ledgers</span>
                    <span>{cloudLedgersLoading ? "Checking" : cloudLedgers.length}</span>
                  </header>
                  {cloudLedgers.length === 0 && !cloudLedgersLoading && (
                    <div className="px-4 py-4 font-mono text-[10px] uppercase text-zinc-700">No cloud ledger access</div>
                  )}
                  {cloudLedgers.map((cloudLedger) => {
                    const active = usingCloudLedger && cloudLedger.id === ledgerMeta.id;
                    return (
                      <div key={cloudLedger.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-zinc-900 px-4 py-3 last:border-b-0 ${active ? "bg-cyan-950/15" : ""}`}>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={`h-2.5 w-2.5 shrink-0 ${active ? "bg-cyan-400" : "bg-zinc-700"}`} />
                            <span className="truncate text-sm font-black uppercase tracking-[0.08em] text-zinc-200">{cloudLedger.name}</span>
                            {active && <span className="border border-cyan-800 px-1.5 py-0.5 font-mono text-[8px] uppercase text-cyan-300">Active</span>}
                          </div>
                          <div className="mt-1 pl-[18px] font-mono text-[10px] uppercase text-zinc-600">
                            {ledgerKindLabel(cloudLedger.kind)} / {cloudLedger.currentRole} / rev {cloudLedger.revision}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => active ? closeCloudLedger() : openCloudLedger(cloudLedger.id)}
                          disabled={Boolean(cloudOpenId) || cloudSyncingRef.current}
                          className="h-8 border border-cyan-900 px-3 font-mono text-[9px] font-black uppercase text-cyan-300 hover:border-cyan-500 disabled:opacity-40"
                        >
                          {cloudOpenId === cloudLedger.id ? "Opening..." : active ? "Close cloud" : "Open"}
                        </button>
                      </div>
                    );
                  })}
                </section>
              )}

              <section className="border-b border-zinc-800 p-4">
                {usingCloudLedger ? (
                  <form onSubmit={renameActiveCloudLedger} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <Field label="Cloud ledger name">
                      <input
                        value={cloudLedgerNameDraft}
                        maxLength={60}
                        disabled={!cloudLedgerCanRename}
                        onChange={(event) => setCloudLedgerNameDraft(event.target.value.slice(0, 60))}
                        className="h-10 border border-zinc-700 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-cyan-400 disabled:border-zinc-900 disabled:text-zinc-500"
                      />
                    </Field>
                    <button
                      type="submit"
                      disabled={!cloudLedgerCanRename || !cloudLedgerNameDraft.trim() || cloudLedgerNameDraft.trim() === ledgerMeta.name}
                      className="h-10 border border-cyan-800 px-4 text-xs font-black uppercase tracking-[0.1em] text-cyan-300 hover:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Save name
                    </button>
                  </form>
                ) : (
                  <Field label="Ledger name">
                    <input
                      value={ledgerMeta.name}
                      maxLength={60}
                      onChange={(event) => setLedgerMeta((current) => ({ ...current, name: event.target.value.slice(0, 60), updatedAt: new Date().toISOString() }))}
                      onBlur={() => setLedgerMeta((current) => ({ ...current, name: current.name.trim() || ledgerKindLabel(current.kind) }))}
                      className="h-10 border border-zinc-700 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-amber-400"
                    />
                  </Field>
                )}

                <div className="mt-3 grid grid-cols-2 border border-zinc-800 font-mono text-[10px] uppercase sm:grid-cols-4">
                  <div className="border-b border-r border-zinc-800 px-3 py-2 sm:border-b-0">
                    Kind <span className="ml-1 text-zinc-200">{ledgerKindLabel(ledgerMeta.kind)}</span>
                  </div>
                  <div className="border-b border-zinc-800 px-3 py-2 sm:border-b-0 sm:border-r">
                    Storage <span className={`ml-1 ${usingCloudLedger ? "text-cyan-300" : "text-zinc-200"}`}>{usingCloudLedger ? "Cloud" : "Local"}</span>
                  </div>
                  <div className="border-r border-zinc-800 px-3 py-2">
                    Sync <span className={`ml-1 ${usingCloudLedger && cloudSyncStatus === "synced" ? "text-emerald-300" : "text-zinc-500"}`}>
                      {usingCloudLedger ? cloudSyncStatus : "Off"}
                    </span>
                  </div>
                  <div className="px-3 py-2">
                    Account <span className={`ml-1 ${accountSession ? "text-cyan-300" : "text-zinc-500"}`}>{accountSession ? ledgerMeta.currentRole || "Signed in" : "Guest"}</span>
                  </div>
                </div>
              </section>

              <section className="grid gap-3 border-b border-zinc-800 p-4 sm:grid-cols-2 sm:items-end">
                <div className="grid gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                  Download backup
                  <button
                    type="button"
                    onClick={exportLedgerBackup}
                    className="h-10 border border-zinc-700 bg-black px-3 font-mono text-xs font-black uppercase text-zinc-300 hover:border-amber-400 hover:text-amber-300"
                  >
                    Export full ledger
                  </button>
                </div>

                <Field label="Restore backup">
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={selectLedgerBackup}
                    disabled={usingCloudLedger || backupLoading}
                    aria-invalid={Boolean(backupError)}
                    aria-errormessage={backupError ? "backup-error" : undefined}
                    aria-describedby={backupError ? "backup-error" : undefined}
                    className="h-10 min-w-0 border border-zinc-700 bg-black px-2 py-2 font-mono text-xs text-zinc-400 file:mr-3 file:border-0 file:bg-amber-400 file:px-2 file:py-1 file:font-mono file:text-[10px] file:font-black file:uppercase file:text-black disabled:border-zinc-900 disabled:text-zinc-700"
                  />
                </Field>
              </section>

              {backupLoading && <LiveMessage className="border-b border-zinc-800 px-4 py-3 font-mono text-[10px] uppercase text-zinc-500">Reading backup...</LiveMessage>}

              {backupError && <LiveMessage id="backup-error" kind="alert" className="border-b border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{backupError}</LiveMessage>}

              {backupSession && (
                <section>
                  <header className="grid grid-cols-2 border-b border-zinc-800 font-mono text-[10px] uppercase sm:grid-cols-4">
                    <div className="border-b border-r border-zinc-800 px-3 py-2 sm:border-b-0">
                      Ledger <span className="ml-1 text-zinc-200">{backupSession.ledger.name}</span>
                    </div>
                    <div className="border-b border-zinc-800 px-3 py-2 sm:border-b-0 sm:border-r">
                      Records <span className="ml-1 text-zinc-200">{backupSession.subscriptions.length}</span>
                    </div>
                    <div className="border-r border-zinc-800 px-3 py-2">
                      New <span className="ml-1 text-emerald-300">{backupMergeCandidates.length}</span>
                    </div>
                    <div className="px-3 py-2">
                      Existing <span className="ml-1 text-amber-300">{backupDuplicateCount}</span>
                    </div>
                  </header>

                  <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black uppercase tracking-[0.08em] text-zinc-200">{backupSession.fileName}</div>
                      <div className="mt-1 font-mono text-[10px] uppercase text-zinc-600">
                        Exported {backupSession.exportedAt ? new Date(backupSession.exportedAt).toLocaleString() : "date unavailable"}
                      </div>
                      <div className="mt-2 font-mono text-xs text-amber-300">
                        {formatCurrencyTotals(totalsByCurrency(backupSession.subscriptions, monthlyEquivalent))} monthly
                      </div>
                      {backupCapacityOmittedCount > 0 && (
                        <div className="mt-2 font-mono text-[10px] uppercase text-red-300">
                          Capacity blocks {backupCapacityOmittedCount} new {backupCapacityOmittedCount === 1 ? "record" : "records"}
                        </div>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={!backupMergeCount}
                        onClick={mergeLedgerBackup}
                        className="h-10 border border-zinc-600 bg-black px-3 text-xs font-black uppercase tracking-[0.1em] text-zinc-200 hover:border-zinc-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-700"
                      >
                        Merge {backupMergeCount}
                      </button>
                      <button
                        type="button"
                        onClick={replaceLedgerFromBackup}
                        className="h-10 border border-red-600 bg-red-950/30 px-3 text-xs font-black uppercase tracking-[0.1em] text-red-200 hover:border-red-300"
                      >
                        Replace all
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </div>

            {!backupSession && (
              <footer className="grid grid-cols-2 border-t border-zinc-800 font-mono text-[10px] uppercase text-zinc-600">
                <div className="border-r border-zinc-800 px-4 py-3">
                  Records <span className="text-zinc-200">{subscriptions.length}</span>
                </div>
                <div className="px-4 py-3 text-right">
                  Updated <span className="text-zinc-300">{new Date(ledgerMeta.updatedAt).toLocaleDateString()}</span>
                </div>
              </footer>
            )}
          </section>
        </div>
      )}

      {alertSettingsOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-3 sm:p-6">
          <section
            ref={alertDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="alert-settings-title"
            tabIndex={-1}
            className="w-full max-w-xl border border-zinc-700 bg-[#090a0b] shadow-2xl"
          >
            <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">{ledgerKindLabel(ledgerMeta.kind)} local ledger</div>
                <h2 id="alert-settings-title" className="mt-1 truncate text-lg font-black uppercase tracking-[0.1em] text-zinc-100">Alert controls</h2>
              </div>
              <button
                type="button"
                onClick={() => setAlertSettingsOpen(false)}
                aria-label="Close alert controls"
                data-dialog-initial-focus
                className="h-9 border border-zinc-700 px-3 font-mono text-xs font-black uppercase text-zinc-400 hover:border-zinc-400 hover:text-white"
              >
                Close
              </button>
            </header>

            {deviceAlertStatus.message && (
              <LiveMessage
                kind={deviceAlertStatus.kind}
                className={`border-b px-4 py-3 font-mono text-[10px] uppercase ${
                  deviceAlertStatus.kind === "alert"
                    ? "border-red-900 bg-red-950/20 text-red-200"
                    : "border-emerald-950 bg-emerald-950/15 text-emerald-300"
                }`}
              >
                {deviceAlertStatus.message}
              </LiveMessage>
            )}

            <div className="divide-y divide-zinc-800">
              <label className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-4 hover:bg-zinc-950">
                <span className="min-w-0">
                  <span className="block text-xs font-black uppercase tracking-[0.14em] text-zinc-200">Device notifications</span>
                  <span className="mt-1 block font-mono text-[10px] uppercase text-zinc-600">
                    Permission / {notificationPermission}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={alertSettings.deviceEnabled}
                  disabled={notificationPermission === "unsupported"}
                  onChange={(event) => void setDeviceAlertsEnabled(event.target.checked)}
                  className="h-5 w-5 accent-amber-400 disabled:opacity-30"
                />
              </label>

              <label className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-4 hover:bg-zinc-950">
                <span className="min-w-0">
                  <span className="block text-xs font-black uppercase tracking-[0.14em] text-zinc-200">Paused schedule alerts</span>
                  <span className="mt-1 block font-mono text-[10px] uppercase text-zinc-600">
                    Scope / {alertSettings.includePausedSchedules ? "included" : "excluded"}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={alertSettings.includePausedSchedules}
                  onChange={(event) => setAlertSettings((current) => ({ ...current, includePausedSchedules: event.target.checked }))}
                  className="h-5 w-5 accent-amber-400"
                />
              </label>
            </div>

            <footer className="grid grid-cols-2 border-t border-zinc-800 font-mono text-[10px] uppercase text-zinc-600">
              <div className="border-r border-zinc-800 px-4 py-3">
                Configured <span className="text-zinc-200">{configuredAlertCount}</span>
              </div>
              <div className="px-4 py-3 text-right">
                Due today <span className="text-amber-300">{alerts.length}</span>
              </div>
            </footer>
          </section>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-3 sm:p-6">
          <section
            ref={csvDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="csv-import-title"
            aria-busy={csvLoading}
            tabIndex={-1}
            className="flex max-h-[calc(100vh-24px)] min-w-0 w-full max-w-full flex-col overflow-hidden border border-zinc-700 bg-[#090a0b] shadow-2xl sm:max-h-[calc(100vh-48px)] sm:max-w-5xl"
          >
            <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-3 py-3 sm:px-4">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">Data intake</div>
                <h2 id="csv-import-title" className="mt-1 truncate text-lg font-black uppercase tracking-[0.1em] text-zinc-100">Import subscriptions</h2>
              </div>
              <button
                type="button"
                onClick={closeCsvImport}
                aria-label="Close import"
                data-dialog-initial-focus
                className="h-9 border border-zinc-700 px-3 font-mono text-xs font-black uppercase text-zinc-400 hover:border-zinc-400 hover:text-white"
              >
                Close
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-auto">
              <div className="grid gap-3 border-b border-zinc-800 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-4">
                <Field label="CSV file">
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={selectCsvFile}
                    disabled={csvLoading}
                    aria-invalid={Boolean(csvError)}
                    aria-errormessage={csvError ? "csv-error" : undefined}
                    aria-describedby={csvError ? "csv-error" : undefined}
                    className="h-10 min-w-0 border border-zinc-700 bg-black px-2 py-2 font-mono text-xs text-zinc-400 file:mr-3 file:border-0 file:bg-amber-400 file:px-2 file:py-1 file:font-mono file:text-[10px] file:font-black file:uppercase file:text-black"
                  />
                </Field>
                {csvSession && (
                  <div className="font-mono text-[10px] uppercase text-zinc-500 sm:pb-2">
                    {csvSession.fileName} / {csvSession.rows.length} rows
                  </div>
                )}
              </div>

              {csvLoading && <LiveMessage className="border-b border-zinc-800 px-4 py-3 font-mono text-[10px] uppercase text-zinc-500">Reading CSV...</LiveMessage>}

              {csvError && <LiveMessage id="csv-error" kind="alert" className="border-b border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{csvError}</LiveMessage>}

              {csvSession && (
                <>
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] border-b border-zinc-800 lg:grid-cols-[320px_minmax(0,1fr)]">
                    <section className="min-w-0 border-b border-zinc-800 lg:border-b-0 lg:border-r">
                      <header className="border-b border-zinc-800 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                        Field mapping
                      </header>
                      <div className="grid gap-2 p-3">
                        {csvImportFields.map((field) => (
                          <label key={field.key} className="grid min-w-0 grid-cols-[100px_minmax(0,1fr)] items-center gap-2 text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500 sm:grid-cols-[116px_minmax(0,1fr)]">
                            <span className="truncate">{field.label}{field.required ? " *" : ""}</span>
                            <select
                              value={csvMapping[field.key] || ""}
                              onChange={(event) => setCsvMapping((current) => ({ ...current, [field.key]: event.target.value }))}
                              className="h-8 min-w-0 border border-zinc-700 bg-black px-2 font-mono text-[10px] text-zinc-300 outline-none focus:border-amber-400"
                            >
                              <option value="">Not mapped</option>
                              {csvSession.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                            </select>
                          </label>
                        ))}
                      </div>
                    </section>

                    <section className="min-w-0">
                      <header className="grid grid-cols-3 border-b border-zinc-800 font-mono text-[10px] uppercase text-zinc-600">
                        <div className="border-r border-zinc-800 px-3 py-2">
                          Ready <span className="text-emerald-300">{importableCandidates.length}</span>
                        </div>
                        <div className="border-r border-zinc-800 px-3 py-2">
                          Duplicate <span className="text-amber-300">{duplicateImportCount}</span>
                        </div>
                        <div className="px-3 py-2">
                          Invalid <span className="text-red-300">{invalidImportCount}</span>
                        </div>
                      </header>

                      <div className="max-h-[420px] overflow-auto">
                        <div className="sticky top-0 grid grid-cols-[42px_minmax(120px,1fr)_110px_90px] border-b border-zinc-800 bg-zinc-950 font-mono text-[9px] uppercase text-zinc-600">
                          <div className="border-r border-zinc-800 px-2 py-2">Row</div>
                          <div className="border-r border-zinc-800 px-2 py-2">Subscription</div>
                          <div className="border-r border-zinc-800 px-2 py-2 text-right">Amount</div>
                          <div className="px-2 py-2">Status</div>
                        </div>
                        {csvCandidates.slice(0, 100).map((candidate) => (
                          <div key={candidate.rowNumber} className="grid grid-cols-[42px_minmax(120px,1fr)_110px_90px] border-b border-zinc-900 text-xs">
                            <div className="border-r border-zinc-900 px-2 py-2 font-mono text-zinc-700">{candidate.rowNumber}</div>
                            <div className="min-w-0 border-r border-zinc-900 px-2 py-2">
                              <div className="truncate font-bold text-zinc-300">{candidate.subscription?.name || "Unreadable row"}</div>
                              <div className="mt-0.5 truncate font-mono text-[9px] uppercase text-zinc-600">
                                {candidate.subscription ? `${candidate.subscription.cycle} / ${candidate.subscription.nextBillingDate}` : candidate.errors.join(", ")}
                              </div>
                            </div>
                            <div className="border-r border-zinc-900 px-2 py-2 text-right font-mono text-zinc-300">
                              {candidate.subscription ? money(candidate.subscription.amount, candidate.subscription.currency) : "-"}
                            </div>
                            <div className={`px-2 py-2 font-mono text-[9px] font-black uppercase ${
                              candidate.errors.length
                                ? "text-red-300"
                                : candidate.duplicate
                                  ? "text-amber-300"
                                  : "text-emerald-300"
                            }`}>
                              {candidate.errors.length ? "Invalid" : candidate.duplicate ? "Duplicate" : "Ready"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>

                  {(csvSession.truncated || csvSession.parserWarnings.length > 0) && (
                    <LiveMessage className="border-b border-amber-900 bg-amber-950/20 px-4 py-3 font-mono text-[10px] uppercase text-amber-300">
                      {csvSession.truncated && <div>Only the first {MAX_CSV_ROWS} rows were loaded.</div>}
                      {csvSession.parserWarnings.map((warning, index) => <div key={`${warning.code}-${index}`}>Row {(warning.row ?? 0) + 2}: {warning.message}</div>)}
                    </LiveMessage>
                  )}
                </>
              )}
            </div>

            <footer className="flex flex-col gap-2 border-t border-zinc-800 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <div className="font-mono text-[10px] uppercase text-zinc-600">
                Duplicates and invalid rows are skipped
              </div>
              <button
                type="button"
                disabled={!importConfirmCount || cloudLedgerWriteDisabled}
                onClick={confirmCsvImport}
                className="h-10 border border-amber-400 bg-amber-400 px-4 text-xs font-black uppercase tracking-[0.12em] text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
              >
                Import {importConfirmCount} {importConfirmCount === 1 ? "subscription" : "subscriptions"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}

function App() {
  const [trackerOpen, setTrackerOpen] = useState(() => isTrackerHash());
  const pwa = useInstallableApp();

  useEffect(() => {
    const syncView = () => setTrackerOpen(isTrackerHash());
    window.addEventListener("popstate", syncView);
    window.addEventListener("hashchange", syncView);
    return () => {
      window.removeEventListener("popstate", syncView);
      window.removeEventListener("hashchange", syncView);
    };
  }, []);

  function navigateToTracker() {
    window.history.pushState(null, "", "#app");
    setTrackerOpen(true);
    window.scrollTo(0, 0);
  }

  function navigateHome() {
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
    setTrackerOpen(false);
    window.scrollTo(0, 0);
  }

  return trackerOpen ? <Tracker onExit={navigateHome} pwa={pwa} /> : <LandingPage onOpen={navigateToTracker} pwa={pwa} />;
}

export default App;
