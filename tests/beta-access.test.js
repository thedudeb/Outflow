import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeBetaAccessCode,
  sanitizeBetaAccessReport,
  sanitizeBetaRedemptionResult,
  sanitizeCreatedBetaAccessCode,
} from "../src/betaAccess.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const codeId = "44444444-4444-4444-8444-444444444444";
const testerId = "33333333-3333-4333-8333-333333333333";
const createdAt = "2026-07-20T16:00:00.000Z";

function codeRecord(overrides = {}) {
  return {
    id: codeId,
    label: "Private beta",
    codeSuffix: "ABCDE",
    maxRedemptions: 20,
    redemptionCount: 1,
    remaining: 19,
    expiresAt: null,
    disabledAt: null,
    createdAt,
    redemptions: [{
      userId: testerId,
      email: "beta@example.com",
      displayName: "Beta Tester",
      redeemedAt: createdAt,
    }],
    ...overrides,
  };
}

test("beta code input is bounded and normalized without inventing characters", () => {
  assert.equal(normalizeBetaAccessCode(" outflow-ab12!c-def34 "), "OUTFLOW-AB12C-DEF34");
  assert.equal(normalizeBetaAccessCode("x".repeat(100)).length, 64);
});

test("created code parser accepts the one-time secret and rejects malformed capacity", () => {
  const parsed = sanitizeCreatedBetaAccessCode({
    schemaVersion: 1,
    code: "OUTFLOW-ABCDE-F0123-45678-9ABCD",
    ...codeRecord({ redemptionCount: 0, remaining: 20, redemptions: undefined }),
  });
  assert.equal(parsed.code, "OUTFLOW-ABCDE-F0123-45678-9ABCD");
  assert.throws(() => sanitizeCreatedBetaAccessCode({
    schemaVersion: 1,
    code: "short",
    ...codeRecord(),
  }));
  assert.throws(() => sanitizeCreatedBetaAccessCode({
    schemaVersion: 1,
    code: "OUTFLOW-ABCDE-F0123-45678-9ABCD",
    ...codeRecord({ maxRedemptions: 21, remaining: 20 }),
  }));
});

test("admin report keeps bounded tester identity and deletion tombstones", () => {
  const [parsed] = sanitizeBetaAccessReport({ schemaVersion: 1, codes: [codeRecord()] });
  assert.equal(parsed.redemptions[0].email, "beta@example.com");
  const [deleted] = sanitizeBetaAccessReport({
    schemaVersion: 1,
    codes: [codeRecord({
      redemptions: [{ userId: null, email: null, displayName: null, redeemedAt: createdAt }],
    })],
  });
  assert.equal(deleted.redemptions[0].userId, null);
  assert.equal(deleted.redemptions[0].email, "");
  assert.throws(() => sanitizeBetaAccessReport({
    schemaVersion: 1,
    codes: [codeRecord({ redemptions: [{ userId: testerId, email: "x".repeat(255), displayName: null, redeemedAt: createdAt }] })],
  }));
});

test("redemption parser accepts only explicit, bounded outcomes", () => {
  assert.deepEqual(sanitizeBetaRedemptionResult({ schemaVersion: 1, status: "invalid" }), { status: "invalid" });
  assert.deepEqual(sanitizeBetaRedemptionResult({
    schemaVersion: 1,
    status: "redeemed",
    label: "Private beta",
    redeemedAt: createdAt,
  }), { status: "redeemed", label: "Private beta", redeemedAt: createdAt });
  assert.throws(() => sanitizeBetaRedemptionResult({ schemaVersion: 1, status: "free_pro" }));
});

test("beta access migration keeps secrets private and mutations server-authorized", () => {
  const migration = read("supabase/migrations/20260721030000_beta_access_codes.sql");
  assert.match(migration, /requested_max_redemptions not between 1 and 20/);
  assert.match(migration, /count\(\*\) from public\.beta_access_codes\) >= 100/);
  assert.match(migration, /extensions\.gen_random_bytes\(10\)/);
  assert.match(migration, /extensions\.digest/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /attempted_at >= now\(\) - interval '1 hour'/);
  assert.match(migration, /for update/);
  assert.match(migration, /public\.is_outflow_admin\(\)/);
  assert.match(migration, /revoke all on table public\.beta_access_codes/);
  assert.doesNotMatch(migration, /grant .* on table public\.beta_access_codes.*authenticated/i);
});

test("account and admin surfaces expose redemption and tracked usage", () => {
  const app = read("src/App.jsx");
  assert.match(app, /Beta codes/);
  assert.match(app, /Create code/);
  assert.match(app, /Disable code/);
  assert.match(app, /No redemptions yet/);
  assert.match(app, /Activate Pro/);
  assert.match(app, /invalid, expired, disabled, or has reached its account limit/);
  assert.match(app, /if \(!isAdmin\)[\s\S]*setCreatedBetaCode\(""\)/);
});
