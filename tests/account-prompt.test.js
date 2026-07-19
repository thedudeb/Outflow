import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_NUDGE_ACTIVITY_STEP,
  accountNudgeIsDue,
  accountNudgeIsSnoozed,
  advanceAccountNudge,
  recordAccountNudgeActivity,
  sanitizeAccountNudge,
} from "../src/accountPrompt.js";

const now = Date.parse("2026-07-19T12:00:00.000Z");

test("invalid prompt state falls back to the first activity checkpoint", () => {
  assert.deepEqual(sanitizeAccountNudge({ activityCount: -2, nextActivityCount: 0, snoozedUntil: "nope" }), {
    version: 1,
    activityCount: 0,
    nextActivityCount: 3,
    snoozedUntil: "",
  });
});

test("the first periodic prompt becomes due after three meaningful changes", () => {
  let state = sanitizeAccountNudge(null);
  state = recordAccountNudgeActivity(state);
  state = recordAccountNudgeActivity(state);
  assert.equal(accountNudgeIsDue(state, now), false);
  state = recordAccountNudgeActivity(state);
  assert.equal(accountNudgeIsDue(state, now), true);
});

test("opening account controls advances the threshold and applies a short cooldown", () => {
  const state = advanceAccountNudge({ activityCount: 3, nextActivityCount: 3 }, 7, now);
  assert.equal(state.nextActivityCount, 3 + ACCOUNT_NUDGE_ACTIVITY_STEP);
  assert.equal(state.snoozedUntil, "2026-07-26T12:00:00.000Z");
  assert.equal(accountNudgeIsSnoozed(state, now), true);
  assert.equal(accountNudgeIsDue(state, now), false);
});

test("a dismissed prompt can become due again after cooldown and more activity", () => {
  const dismissed = advanceAccountNudge({ activityCount: 3, nextActivityCount: 3 }, 30, now);
  const ready = { ...dismissed, activityCount: dismissed.nextActivityCount };
  assert.equal(accountNudgeIsDue(ready, Date.parse("2026-08-18T11:59:59.000Z")), false);
  assert.equal(accountNudgeIsDue(ready, Date.parse("2026-08-18T12:00:00.000Z")), true);
});

test("snooze timestamps and counters are bounded during sanitization", () => {
  const state = sanitizeAccountNudge({
    activityCount: Number.MAX_SAFE_INTEGER,
    nextActivityCount: Number.MAX_SAFE_INTEGER,
    snoozedUntil: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(state.activityCount, 100000);
  assert.equal(state.nextActivityCount, 100000);
  assert.equal(state.snoozedUntil, "2026-08-01T00:00:00.000Z");
});
