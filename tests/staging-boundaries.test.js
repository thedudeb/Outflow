import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildStagingBoundaryReport, probeStagingBoundaries, resolvePublicStagingConfig } from "../scripts/check-staging-boundaries.mjs";

const publishableKey = `sb_publishable_${"p".repeat(24)}`;
const projectUrl = "https://outflow-stage.supabase.co";
const appOrigin = "https://stage.outflow.example";

function fixtureFetch({ corsOrigin = appOrigin, calendarStatus = 404, calendarHeaders = true } = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const functionName = url.pathname.split("/").at(-1);
    const headers = new Headers(init.headers);
    calls.push({ functionName, headers, method: init.method, url });
    if (init.method === "OPTIONS") {
      const allowedMethods = functionName === "create-pro-checkout" ? "GET, POST, OPTIONS" : "POST, OPTIONS";
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
          "Access-Control-Allow-Methods": allowedMethods,
          Vary: "Origin",
        },
      });
    }
    if (["delete-account", "send-ledger-invite", "create-pro-checkout"].includes(functionName)) {
      return Response.json({ error: "invalid JWT" }, { status: 401 });
    }
    if (functionName === "stripe-webhook") return Response.json({ error: "invalid signature" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    if (functionName === "send-due-reminders") return Response.json({ error: "invalid cron secret" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    if (functionName === "resend-webhook") return Response.json({ error: "invalid signature" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    if (functionName === "calendar-feed") {
      return Response.json({ error: "not found" }, {
        status: calendarStatus,
        headers: calendarHeaders ? { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } : {},
      });
    }
    return Response.json({ error: "unexpected" }, { status: 500 });
  };
  return { calls, fetchImpl };
}

test("public staging configuration accepts hosted keys and rejects secret browser values", () => {
  assert.deepEqual(resolvePublicStagingConfig({
    SUPABASE_URL: projectUrl,
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: publishableKey }),
    VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    OUTFLOW_APP_URL: `${appOrigin}/`,
    OUTFLOW_ALLOWED_ORIGINS: appOrigin,
  }).errors, []);

  const secret = `sb_secret_${"s".repeat(24)}`;
  const invalid = resolvePublicStagingConfig({
    SUPABASE_URL: projectUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: secret,
    OUTFLOW_APP_URL: `${appOrigin}/`,
  });
  assert.ok(invalid.errors.some((error) => error.startsWith("VITE_SUPABASE_PUBLISHABLE_KEY:")));
  assert.equal(JSON.stringify(invalid.errors).includes(secret), false);

  const mismatched = resolvePublicStagingConfig({
    SUPABASE_URL: projectUrl,
    VITE_SUPABASE_URL: "https://different-stage.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    OUTFLOW_APP_URL: `${appOrigin}/`,
    OUTFLOW_ALLOWED_ORIGINS: `*,${appOrigin}/path`,
  });
  assert.ok(mismatched.errors.some((error) => error.startsWith("VITE_SUPABASE_URL:")));
  assert.ok(mismatched.errors.some((error) => error.startsWith("OUTFLOW_ALLOWED_ORIGINS: wildcard")));
  assert.ok(mismatched.errors.some((error) => error.startsWith("OUTFLOW_ALLOWED_ORIGINS: every entry")));
  assert.ok(resolvePublicStagingConfig({
    SUPABASE_URL: projectUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    OUTFLOW_APP_URL: `${appOrigin}/`,
  }).errors.some((error) => error.startsWith("OUTFLOW_ALLOWED_ORIGINS: expected")));
});

test("the probe verifies ten non-destructive boundaries without server credentials", async () => {
  const fixture = fixtureFetch();
  const completed = await probeStagingBoundaries({ projectUrl, publishableKey, appOrigin, fetchImpl: fixture.fetchImpl });
  assert.equal(completed.length, 10);
  assert.equal(fixture.calls.length, 10);
  for (const call of fixture.calls.filter(({ functionName }) => ["delete-account", "send-ledger-invite", "create-pro-checkout"].includes(functionName))) {
    assert.equal(call.headers.get("apikey"), publishableKey);
  }
  for (const call of fixture.calls.filter(({ method }) => method === "OPTIONS")) {
    assert.equal(call.headers.get("authorization"), null);
    assert.equal(call.headers.get("origin"), appOrigin);
  }
});

test("the probe fails on permissive CORS or an exposed calendar token without echoing bodies", async () => {
  await assert.rejects(
    probeStagingBoundaries({ projectUrl, publishableKey, appOrigin, fetchImpl: fixtureFetch({ corsOrigin: "*" }).fetchImpl }),
    /delete-account CORS: exact origin was not returned/,
  );
  await assert.rejects(
    probeStagingBoundaries({ projectUrl, publishableKey, appOrigin, fetchImpl: fixtureFetch({ calendarStatus: 200 }).fetchImpl }),
    /calendar-feed private token: expected HTTP 404, received 200/,
  );
  await assert.rejects(
    probeStagingBoundaries({ projectUrl, publishableKey, appOrigin, fetchImpl: fixtureFetch({ calendarHeaders: false }).fetchImpl }),
    /calendar-feed private token: Outflow privacy headers were not returned/,
  );
  let networkError;
  try {
    await probeStagingBoundaries({
      projectUrl,
      publishableKey,
      appOrigin,
      fetchImpl: async () => { throw new Error("private-provider-value"); },
    });
  } catch (error) {
    networkError = error;
  }
  assert.match(networkError?.message || "", /delete-account CORS: request failed/);
  assert.equal((networkError?.message || "").includes("private-provider-value"), false);
});

test("the staging report records bounded evidence without credentials or full-acceptance claims", () => {
  const report = buildStagingBoundaryReport({
    projectUrl,
    appOrigin,
    completed: Array.from({ length: 10 }, (_, index) => `check-${index}`),
    migrations: ["20260719133000_account_foundation.sql", "unsafe name.sql"],
    commit: "5c173bd",
    actor: "release-owner",
    recordedAt: "2026-07-19T22:00:00.000Z",
    runUrl: "https://github.com/thedudeb/Outflow/actions/runs/123",
  });

  assert.match(report, /\*\*PASS\*\* \(10 non-destructive checks across 7 functions\)/);
  assert.match(report, /Migration Inventory \(1\)/);
  assert.match(report, /outflow-stage\.supabase\.co/);
  assert.match(report, /20260719133000_account_foundation\.sql/);
  assert.match(report, /does not replace the synthetic-account/);
  assert.doesNotMatch(report, /sb_publishable_/);
  assert.doesNotMatch(report, /unsafe name/);
});

test("the manual staging workflow is protected and receives no provider or service-role secrets", async () => {
  const source = await readFile(new URL("../.github/workflows/staging-boundary.yml", import.meta.url), "utf8");

  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: staging/);
  assert.match(source, /permissions:\n  contents: read/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /secrets\.OUTFLOW_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(source, /check:staging-boundaries/);
  assert.doesNotMatch(source, /SUPABASE_SECRET|SERVICE_ROLE|STRIPE_|RESEND_|CRON_SECRET/);
  assert.doesNotMatch(source, /^\s{2}(?:push|pull_request|schedule):/m);
});
