import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildBillingPlaneReport,
  cleanupBillingAcceptance,
  probeStripeBillingLifecycle,
  resolveBillingAcceptanceConfig,
} from "../scripts/check-staging-billing-plane.mjs";
import { opaqueSecretFetch } from "../scripts/staging-acceptance-client.mjs";

const projectRef = "abcdefghijklmnopqrst";
const stripeSecretKey = `sk_test_${"a".repeat(24)}`;
const webhookSecret = `whsec_${"b".repeat(24)}`;
const publishableKey = `sb_publishable_${"p".repeat(24)}`;
const supabaseSecretKey = `sb_secret_${"s".repeat(24)}`;
const priceId = "price_Acceptance123";

function environment(overrides = {}) {
  return {
    SUPABASE_URL: `https://${projectRef}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SECRET_KEY: supabaseSecretKey,
    OUTFLOW_APP_URL: "https://staging.outflow.example",
    OUTFLOW_ACCEPTANCE_PROJECT_REF: projectRef,
    OUTFLOW_ACCEPTANCE_MODE: "staging",
    STRIPE_SECRET_KEY: stripeSecretKey,
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    STRIPE_PRO_PRICE_ID: priceId,
    ...overrides,
  };
}

test("billing-plane configuration is bound to one hosted project and Stripe test mode", () => {
  const valid = resolveBillingAcceptanceConfig(environment());
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.projectRef, projectRef);
  assert.equal(valid.appOrigin, "https://staging.outflow.example");
  assert.equal(valid.stripeSecretKey, stripeSecretKey);

  const live = resolveBillingAcceptanceConfig(environment({ STRIPE_SECRET_KEY: `sk_live_${"a".repeat(24)}` }));
  assert.match(live.errors.join("\n"), /live keys are forbidden/);
  const mismatch = resolveBillingAcceptanceConfig(environment({ OUTFLOW_ACCEPTANCE_PROJECT_REF: "zyxwvutsrqponmlkjihg" }));
  assert.match(mismatch.errors.join("\n"), /does not match/);
  const unsafe = resolveBillingAcceptanceConfig(environment({ OUTFLOW_ACCEPTANCE_MODE: "production" }));
  assert.match(unsafe.errors.join("\n"), /literal value staging/);
});

test("opaque staging secrets are sent only as an apikey", async () => {
  let observedHeaders;
  const wrapped = opaqueSecretFetch(supabaseSecretKey, async (_input, init) => {
    observedHeaders = new Headers(init.headers);
    return new Response("{}", { status: 200 });
  });
  await wrapped("https://example.test", {
    headers: { Authorization: `Bearer ${supabaseSecretKey}`, "X-Test": "accepted" },
  });
  assert.equal(observedHeaders.get("authorization"), null);
  assert.equal(observedHeaders.get("apikey"), supabaseSecretKey);
  assert.equal(observedHeaders.get("x-test"), "accepted");
});

test("billing lifecycle verifies one-time Checkout, signed idempotent fulfillment, restore, and refund", async () => {
  const config = resolveBillingAcceptanceConfig(environment());
  const userId = "11111111-1111-4111-8111-111111111111";
  const sessionId = `cs_test_${"c".repeat(24)}`;
  const paymentIntentId = `pi_${"d".repeat(24)}`;
  const seenEvents = new Set();
  const resources = {};
  const requests = [];
  let entitlement = null;
  let restoreCount = 0;

  const response = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    requests.push({ url: url.toString(), method: init.method || "GET", headers: new Headers(init.headers) });
    if (url.pathname.endsWith("/functions/v1/create-pro-checkout") && init.method === "GET") {
      return response({ currency: "USD", name: "Outflow Pro", unitAmount: 4900 });
    }
    if (url.pathname.endsWith("/functions/v1/create-pro-checkout") && init.method === "POST") {
      assert.match(JSON.parse(init.body).operationId, /^[0-9a-f-]{36}$/);
      return response({ url: `https://checkout.stripe.com/c/pay/${sessionId}#acceptance` }, 201);
    }
    if (url.hostname === "api.stripe.com" && url.pathname === `/v1/checkout/sessions/${sessionId}`) {
      assert.equal(url.searchParams.get("expand[]"), "line_items");
      return response({
        id: sessionId,
        livemode: false,
        mode: "payment",
        payment_status: "unpaid",
        status: "open",
        client_reference_id: userId,
        metadata: { outflow_product: "outflow_pro_lifetime", outflow_user_id: userId },
        success_url: "https://staging.outflow.example/#app?pro=success",
        cancel_url: "https://staging.outflow.example/#app?pro=cancelled",
        line_items: { has_more: false, data: [{ price: { id: priceId }, quantity: 1 }] },
      });
    }
    if (url.hostname === "api.stripe.com" && url.pathname === "/v1/payment_intents" && init.method === "POST") {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get("amount"), "4900");
      assert.equal(form.get("currency"), "usd");
      assert.equal(form.get("metadata[outflow_product]"), "outflow_pro_lifetime");
      assert.equal(form.get("metadata[outflow_user_id]"), userId);
      return response({
        id: paymentIntentId,
        livemode: false,
        status: "requires_payment_method",
        metadata: { outflow_product: "outflow_pro_lifetime", outflow_user_id: userId },
      });
    }
    if (url.pathname.endsWith("/functions/v1/stripe-webhook") && init.method === "POST") {
      const event = JSON.parse(init.body);
      const signature = init.headers["Stripe-Signature"];
      const timestamp = Number(signature.match(/t=(\d+)/)?.[1]);
      const digest = signature.match(/v1=([a-f0-9]+)/)?.[1];
      assert.equal(digest, createHmac("sha256", webhookSecret).update(`${timestamp}.${init.body}`).digest("hex"));
      if (seenEvents.has(event.id)) return response({ received: true, result: "duplicate" });
      seenEvents.add(event.id);
      if (event.type === "checkout.session.completed") {
        entitlement = { status: "active", provider: "stripe", provider_reference: sessionId };
        return response({ received: true, result: "fulfilled" });
      }
      if (event.type === "charge.refunded") {
        assert.equal(event.data.object.amount_refunded, event.data.object.amount);
        entitlement = { status: "refunded", provider: "stripe", provider_reference: sessionId };
        return response({ received: true, result: "refunded" });
      }
    }
    throw new Error(`Unexpected request: ${init.method || "GET"} ${url}`);
  };

  const checks = await probeStripeBillingLifecycle({
    config,
    userId,
    accessToken: "synthetic-access-token",
    readEntitlement: async () => entitlement,
    restoreEntitlement: async () => {
      restoreCount += 1;
      return { userId, entitlement };
    },
    resources,
    fetchImpl,
    now: () => Date.parse("2026-07-19T12:00:00.000Z"),
  });

  assert.deepEqual(checks, [
    "test-mode checkout offer",
    "one-time Checkout session",
    "Checkout identity binding",
    "signed purchase fulfillment",
    "duplicate purchase delivery",
    "cross-session entitlement restore",
    "signed full refund",
    "duplicate refund delivery",
    "entitlement revocation",
  ]);
  assert.equal(resources.sessionId, sessionId);
  assert.equal(resources.paymentIntentId, paymentIntentId);
  assert.equal(resources.eventIds.length, 2);
  assert.equal(restoreCount, 1);
  assert.equal(seenEvents.size, 2);
  assert.equal(requests.filter(({ url }) => url.includes("/stripe-webhook")).length, 4);
  assert.ok(requests.filter(({ url }) => url.startsWith("https://api.stripe.com/")).every(({ headers }) =>
    headers.get("authorization") === `Basic ${Buffer.from(`${stripeSecretKey}:`).toString("base64")}`));
});

test("billing report is fixed, bounded, and free of provider identifiers", () => {
  const checks = [
    "synthetic billing account",
    "test-mode checkout offer",
    "one-time Checkout session",
    "Checkout identity binding",
    "signed purchase fulfillment",
    "duplicate purchase delivery",
    "cross-session entitlement restore",
    "signed full refund",
    "duplicate refund delivery",
    "entitlement revocation",
    "synthetic billing cleanup",
  ];
  const report = buildBillingPlaneReport({
    checks,
    projectRef,
    appOrigin: "https://staging.outflow.example",
    commitSha: "abcdef1234567",
    actor: "release-operator",
    runId: "12345",
    completedAt: "2026-07-19T12:00:00.000Z",
  });
  assert.match(report, /Stripe mode: `test`/);
  assert.match(report, /PASS \/ signed purchase fulfillment/);
  assert.match(report, /made no card charge/);
  assert.match(report, /does not prove Stripe's outbound webhook delivery/);
  assert.doesNotMatch(report, /cs_test_|pi_|evt_|sk_test_|whsec_|synthetic-access-token/);
  assert.throws(() => buildBillingPlaneReport({
    checks: checks.slice(0, -1),
    projectRef,
    appOrigin: "https://staging.outflow.example",
    completedAt: "2026-07-19T12:00:00.000Z",
  }), /complete billing acceptance inventory/);
});

test("billing cleanup retires Stripe objects and removes every exact synthetic row", async () => {
  const config = resolveBillingAcceptanceConfig(environment());
  const userId = "11111111-1111-4111-8111-111111111111";
  const sessionId = `cs_test_${"c".repeat(24)}`;
  const paymentIntentId = `pi_${"d".repeat(24)}`;
  const eventIds = [`evt_${"e".repeat(24)}`, `evt_${"f".repeat(24)}`];
  const calls = [];
  const deleteBuilder = (table) => ({
    in(column, values) {
      calls.push([table, "in", column, values]);
      return Promise.resolve({ data: null, error: null });
    },
    eq(column, value) {
      calls.push([table, "eq", column, value]);
      return table === "entitlements" && column === "user_id"
        ? { eq: (nextColumn, nextValue) => {
          calls.push([table, "eq", nextColumn, nextValue]);
          return Promise.resolve({ data: null, error: null });
        } }
        : Promise.resolve({ data: null, error: null });
    },
  });
  const admin = {
    from(table) {
      return { delete: () => deleteBuilder(table) };
    },
    auth: { admin: { async deleteUser(id, softDelete) {
      calls.push(["auth.users", "delete", id, softDelete]);
      return { data: null, error: null };
    } } },
  };
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    calls.push([url.pathname, init.method || "GET"]);
    if (url.pathname === `/v1/checkout/sessions/${sessionId}`) {
      return new Response(JSON.stringify({ id: sessionId, status: "open" }), { status: 200 });
    }
    if (url.pathname === `/v1/checkout/sessions/${sessionId}/expire`) {
      return new Response(JSON.stringify({ id: sessionId, status: "expired" }), { status: 200 });
    }
    if (url.pathname === `/v1/payment_intents/${paymentIntentId}`) {
      return new Response(JSON.stringify({ id: paymentIntentId, status: "requires_payment_method" }), { status: 200 });
    }
    if (url.pathname === `/v1/payment_intents/${paymentIntentId}/cancel`) {
      return new Response(JSON.stringify({ id: paymentIntentId, status: "canceled" }), { status: 200 });
    }
    throw new Error(`Unexpected cleanup request: ${url}`);
  };

  await cleanupBillingAcceptance(config, admin, userId, { sessionId, paymentIntentId, eventIds }, fetchImpl);
  assert.deepEqual(calls.filter(([target]) => target.startsWith("/v1/")), [
    [`/v1/checkout/sessions/${sessionId}`, "GET"],
    [`/v1/checkout/sessions/${sessionId}/expire`, "POST"],
    [`/v1/payment_intents/${paymentIntentId}`, "GET"],
    [`/v1/payment_intents/${paymentIntentId}/cancel`, "POST"],
  ]);
  assert.ok(calls.some((call) => call[0] === "billing_events" && call[1] === "in"));
  assert.ok(calls.some((call) => call[0] === "stripe_purchases" && call[2] === "checkout_session_id"));
  assert.ok(calls.some((call) => call[0] === "entitlements" && call[2] === "product"));
  assert.ok(calls.some((call) => call[0] === "billing_checkout_requests" && call[2] === "user_id"));
  assert.ok(calls.some((call) => call[0] === "auth.users" && call[2] === userId));
});

test("billing workflow is manual, protected, test-mode only, and provider secrets reach only the live step", async () => {
  const source = await readFile(new URL("../.github/workflows/staging-billing-plane.yml", import.meta.url), "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /\b(push|pull_request|schedule):/);
  assert.match(source, /environment: staging/);
  assert.match(source, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /permissions:\n\s+contents: read/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /OUTFLOW_ACCEPTANCE_MODE: staging/);
  assert.match(source, /secrets\.OUTFLOW_STRIPE_SECRET_KEY/);
  assert.match(source, /secrets\.OUTFLOW_STRIPE_WEBHOOK_SECRET/);
  const liveStep = source.slice(source.indexOf("- name: Run signed billing-plane acceptance"));
  const setup = source.slice(0, source.indexOf("- name: Run signed billing-plane acceptance"));
  assert.doesNotMatch(setup, /OUTFLOW_SUPABASE_SECRET_KEY|OUTFLOW_STRIPE_SECRET_KEY|OUTFLOW_STRIPE_WEBHOOK_SECRET/);
  assert.match(liveStep, /npm run check:staging-billing-plane/);
  assert.doesNotMatch(source, /sk_live_|STRIPE_TEST_CARD|4242/);

  const quality = await readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8");
  assert.match(quality, /npm run test:staging-billing-plane/);
});

test("live billing harness signs raw events, restores in a second session, and always cleans up", async () => {
  const source = await readFile(new URL("../scripts/check-staging-billing-plane.mjs", import.meta.url), "utf8");
  assert.match(source, /createHmac\("sha256"/);
  assert.match(source, /checkout\.session\.completed/);
  assert.match(source, /charge\.refunded/);
  assert.match(source, /restoreEntitlement/);
  assert.match(source, /finally \{/);
  assert.match(source, /cleanupBillingAcceptance/);
  assert.match(source, /checkout\/sessions\/\$\{resources\.sessionId\}\/expire/);
  assert.match(source, /payment_intents\/\$\{resources\.paymentIntentId\}\/cancel/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(email|password|token|secret|sessionId|paymentIntentId|eventIds)/i);
});
