import assert from "node:assert/strict";
import test from "node:test";
import {
  canToggleReminderLeadDay,
  canUseCsvImport,
  canUseCurrency,
  canUseReminderLeadDays,
  hasLifetimePro,
  restrictedDraftFeature,
} from "../src/featureAccess.js";

const pro = { status: "active" };

test("only a verified active entitlement unlocks Pro features", () => {
  assert.equal(hasLifetimePro(null), false);
  assert.equal(hasLifetimePro({ status: "refunded" }), false);
  assert.equal(hasLifetimePro(pro), true);
  assert.equal(canUseCsvImport(null), false);
  assert.equal(canUseCsvImport(pro), true);
});

test("Free currency changes are USD-only while existing currency data remains editable", () => {
  assert.equal(canUseCurrency("USD", null), true);
  assert.equal(canUseCurrency("CAD", null), false);
  assert.equal(canUseCurrency("CAD", null, "CAD"), true);
  assert.equal(canUseCurrency("EUR", null, "CAD"), false);
  assert.equal(canUseCurrency("EUR", pro, "CAD"), true);
});

test("Free reminders allow one lead time and preserve existing advanced rules", () => {
  assert.equal(canUseReminderLeadDays([], null), true);
  assert.equal(canUseReminderLeadDays([7], null), true);
  assert.equal(canUseReminderLeadDays([45], null), false);
  assert.equal(canUseReminderLeadDays([45], null, [45]), true);
  assert.equal(canUseReminderLeadDays([7, 1], null), false);
  assert.equal(canUseReminderLeadDays([7, 1], null, [7, 1]), true);
  assert.equal(canUseReminderLeadDays([7, 3], null, [7, 1]), false);
  assert.equal(canUseReminderLeadDays([7, 3], pro), true);
  assert.equal(canUseReminderLeadDays([365, 45, 1], pro), true);
  assert.equal(canUseReminderLeadDays(Array.from({ length: 13 }, (_, index) => index + 31), pro), false);
  assert.equal(canUseReminderLeadDays([366], pro), false);
  assert.equal(canUseReminderLeadDays([1.5], pro), false);
});

test("downgraded users can remove and restore existing rules but cannot expand them", () => {
  const originalLeadDays = [7, 1];
  assert.equal(canToggleReminderLeadDay({ days: 1, selectedLeadDays: [7, 1], originalLeadDays }), true);
  assert.equal(canToggleReminderLeadDay({ days: 1, selectedLeadDays: [7], originalLeadDays }), true);
  assert.equal(canToggleReminderLeadDay({ days: 3, selectedLeadDays: [7], originalLeadDays }), false);
  assert.equal(canToggleReminderLeadDay({ days: 3, selectedLeadDays: [], originalLeadDays }), true);
  assert.equal(canToggleReminderLeadDay({ days: 45, selectedLeadDays: [], originalLeadDays: [45] }), true);
  assert.equal(canToggleReminderLeadDay({ days: 45, selectedLeadDays: [], originalLeadDays }), false);
});

test("draft validation identifies the first restricted capability", () => {
  assert.equal(restrictedDraftFeature({ currency: "CAD", reminderLeadDays: [], entitlement: null }), "currency");
  assert.equal(restrictedDraftFeature({ currency: "USD", reminderLeadDays: [7, 1], entitlement: null }), "reminders");
  assert.equal(restrictedDraftFeature({ currency: "CAD", reminderLeadDays: [7, 1], entitlement: pro }), "");
  assert.equal(restrictedDraftFeature({
    currency: "CAD",
    reminderLeadDays: [7, 1],
    entitlement: null,
    originalCurrency: "CAD",
    originalLeadDays: [7, 1],
  }), "");
});
