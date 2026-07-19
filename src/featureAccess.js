export const FREE_CURRENCY = "USD";
export const FREE_REMINDER_LIMIT = 1;

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
  if (hasLifetimePro(entitlement)) return true;

  const selected = [...new Set(Array.isArray(leadDays) ? leadDays : [])];
  if (selected.length <= FREE_REMINDER_LIMIT) return true;

  const original = new Set(Array.isArray(originalLeadDays) ? originalLeadDays : []);
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
