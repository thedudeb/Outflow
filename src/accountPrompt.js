export const ACCOUNT_NUDGE_VERSION = 1;
export const ACCOUNT_NUDGE_ACTIVITY_STEP = 8;
export const ACCOUNT_NUDGE_DISMISS_DAYS = 30;
export const ACCOUNT_NUDGE_OPEN_DAYS = 7;

export function sanitizeAccountNudge(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const activityCount = Number.isInteger(source.activityCount) && source.activityCount >= 0
    ? Math.min(source.activityCount, 100000)
    : 0;
  const nextActivityCount = Number.isInteger(source.nextActivityCount) && source.nextActivityCount >= 1
    ? Math.min(source.nextActivityCount, 100000)
    : 3;
  const snoozedUntil = typeof source.snoozedUntil === "string" && Number.isFinite(Date.parse(source.snoozedUntil))
    ? source.snoozedUntil
    : "";

  return {
    version: ACCOUNT_NUDGE_VERSION,
    activityCount,
    nextActivityCount: Math.max(nextActivityCount, 1),
    snoozedUntil,
  };
}

export function recordAccountNudgeActivity(value) {
  const state = sanitizeAccountNudge(value);
  return { ...state, activityCount: Math.min(state.activityCount + 1, 100000) };
}

export function accountNudgeIsSnoozed(value, now = Date.now()) {
  const state = sanitizeAccountNudge(value);
  return Boolean(state.snoozedUntil) && Date.parse(state.snoozedUntil) > now;
}

export function accountNudgeIsDue(value, now = Date.now()) {
  const state = sanitizeAccountNudge(value);
  return !accountNudgeIsSnoozed(state, now) && state.activityCount >= state.nextActivityCount;
}

export function advanceAccountNudge(value, days, now = Date.now()) {
  const state = sanitizeAccountNudge(value);
  const duration = Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000;
  return {
    ...state,
    nextActivityCount: Math.min(state.activityCount + ACCOUNT_NUDGE_ACTIVITY_STEP, 100000),
    snoozedUntil: duration ? new Date(now + duration).toISOString() : "",
  };
}
