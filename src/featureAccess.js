export const FREE_CURRENCY = "USD";
export const FREE_REMINDER_LIMIT = 1;
export const STANDARD_REMINDER_LEAD_DAYS = [0, 1, 3, 7, 14, 30];
export const MAX_REMINDER_LEAD_DAY = 365;
export const MAX_REMINDER_LEAD_TIMES = 12;

export function isValidReminderLeadDay(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_REMINDER_LEAD_DAY;
}

export function isStandardReminderLeadDay(value) {
  return STANDARD_REMINDER_LEAD_DAYS.includes(value);
}

export function hasLifetimePro(entitlement) {
  return entitlement?.status === "active";
}

export function canUseCsvImport(entitlement) {
  return hasLifetimePro(entitlement);
}

export function canUseCurrency(currency, entitlement, originalCurrency = "") {
  return hasLifetimePro(entitlement)
    || currency === FREE_CURRENCY
    || (Boolean(originalCurrency) && currency === originalCurrency);
}

export function canUseReminderLeadDays(leadDays, entitlement, originalLeadDays = []) {
  const selected = [...new Set(Array.isArray(leadDays) ? leadDays : [])];
  if (selected.length > MAX_REMINDER_LEAD_TIMES || selected.some((days) => !isValidReminderLeadDay(days))) return false;
  if (hasLifetimePro(entitlement)) return true;

  const original = new Set(Array.isArray(originalLeadDays) ? originalLeadDays : []);
  if (selected.some((days) => !isStandardReminderLeadDay(days) && !original.has(days))) return false;
  if (selected.length <= FREE_REMINDER_LIMIT) return true;

  return selected.every((days) => original.has(days));
}

export function canToggleReminderLeadDay({
  days,
  selectedLeadDays,
  entitlement,
  originalLeadDays = [],
}) {
  const selected = Array.isArray(selectedLeadDays) ? selectedLeadDays : [];
  if (selected.includes(days) || hasLifetimePro(entitlement)) return true;
  return canUseReminderLeadDays([...selected, days], entitlement, originalLeadDays);
}

export function restrictedDraftFeature({
  currency,
  reminderLeadDays,
  entitlement,
  originalCurrency = "",
  originalLeadDays = [],
}) {
  if (!canUseCurrency(currency, entitlement, originalCurrency)) return "currency";
  if (!canUseReminderLeadDays(reminderLeadDays, entitlement, originalLeadDays)) return "reminders";
  return "";
}
