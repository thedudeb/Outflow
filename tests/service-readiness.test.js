import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvFile, validateRepository, validateServiceEnvironment } from "../scripts/check-service-readiness.mjs";

function validEnvironment() {
  return {
    SUPABASE_URL: "https://outflow-stage.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"p".repeat(24)}`,
    SUPABASE_SECRET_KEY: `sb_secret_${"s".repeat(24)}`,
    RESEND_API_KEY: `re_${"r".repeat(24)}`,
    STRIPE_SECRET_KEY: `sk_test_${"a".repeat(24)}`,
    STRIPE_WEBHOOK_SECRET: `whsec_${"w".repeat(24)}`,
    STRIPE_PRO_PRICE_ID: `price_${"i".repeat(16)}`,
    OUTFLOW_ALLOWED_ORIGINS: "https://stage.outflow.example",
    OUTFLOW_APP_URL: "https://stage.outflow.example/",
    OUTFLOW_INVITE_FROM: "Outflow <invites@outflow.example>",
    OUTFLOW_REMINDER_FROM: "Outflow <reminders@outflow.example>",
    OUTFLOW_CRON_SECRET: "0123456789abcdefghijklmnopqrstuv",
  };
}

test("repository service inventory and JWT policy are complete", async () => {
  const result = await validateRepository();
  assert.deepEqual(result.errors, []);
  assert.equal(result.functionCount, 6);
  assert.equal(result.jwtProtectedCount, 3);
  assert.equal(result.publicBoundaryCount, 3);
  assert.ok(result.migrationCount >= 7);
});

test("environment templates support comments, exports, and quoted sender values on Node 18", () => {
  assert.deepEqual(parseEnvFile(`
# ignored
export OUTFLOW_APP_URL=https://stage.outflow.example/ # app origin
OUTFLOW_INVITE_FROM="Outflow <invites@outflow.example>"
`), {
    OUTFLOW_APP_URL: "https://stage.outflow.example/",
    OUTFLOW_INVITE_FROM: "Outflow <invites@outflow.example>",
  });
});

test("a complete production environment passes without exposing values", () => {
  assert.deepEqual(validateServiceEnvironment(validEnvironment()), []);
});

test("wildcards, local production URLs, mismatched browser values, and weak secrets fail closed", () => {
  const env = {
    ...validEnvironment(),
    OUTFLOW_ALLOWED_ORIGINS: "*,http://localhost:5173",
    OUTFLOW_APP_URL: "http://localhost:5173/",
    OUTFLOW_CRON_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    VITE_SUPABASE_URL: "https://another-project.supabase.co",
    VITE_STRIPE_SECRET_KEY: "must-never-be-public",
  };
  const errors = validateServiceEnvironment(env);
  assert.ok(errors.some((error) => error.startsWith("OUTFLOW_ALLOWED_ORIGINS: wildcard")));
  assert.ok(errors.some((error) => error.startsWith("OUTFLOW_APP_URL:")));
  assert.ok(errors.some((error) => error.startsWith("OUTFLOW_CRON_SECRET:")));
  assert.ok(errors.some((error) => error.startsWith("VITE_SUPABASE_URL:")));
  assert.ok(errors.some((error) => error.startsWith("VITE_STRIPE_SECRET_KEY:")));
  assert.equal(JSON.stringify(errors).includes("must-never-be-public"), false);
});

test("local origins are accepted only when the caller explicitly opts in", () => {
  const env = {
    ...validEnvironment(),
    OUTFLOW_ALLOWED_ORIGINS: "http://localhost:5173",
    OUTFLOW_APP_URL: "http://localhost:5173/",
  };
  assert.ok(validateServiceEnvironment(env).length > 0);
  assert.deepEqual(validateServiceEnvironment(env, { allowLocal: true }), []);
});
