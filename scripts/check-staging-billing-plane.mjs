import { appendFile, readFile } from "node:fs/promises";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnvFile, resolveSupabaseKeys } from "./check-service-readiness.mjs";
import { createAcceptanceClient } from "./staging-acceptance-client.mjs";

const PRODUCT = "outflow_pro_lifetime";
const expectedCheckNames = Object.freeze([
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
]);

function hostedProjectOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && /^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname)
      && url.origin === value;
  } catch {
    return false;
  }
}

function exactHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname === "/";
  } catch {
    return false;
  }
}

export function resolveBillingAcceptanceConfig(env) {
  const errors = [];
  const projectUrl = String(env.SUPABASE_URL || "").trim();
  const projectRef = String(env.OUTFLOW_ACCEPTANCE_PROJECT_REF || "").trim();
  const appUrl = String(env.OUTFLOW_APP_URL || "").trim();
  const mode = String(env.OUTFLOW_ACCEPTANCE_MODE || "").trim();
  const stripeSecretKey = String(env.STRIPE_SECRET_KEY || "").trim();
  const stripeWebhookSecret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  const stripePriceId = String(env.STRIPE_PRO_PRICE_ID || "").trim();
  const { publishableKey, secretKey } = resolveSupabaseKeys(env, errors);

  if (!hostedProjectOrigin(projectUrl)) {
    errors.push("SUPABASE_URL: expected an exact hosted Supabase project origin.");
  }
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    errors.push("OUTFLOW_ACCEPTANCE_PROJECT_REF: expected the protected staging project reference.");
  }
  if (hostedProjectOrigin(projectUrl) && projectRef && new URL(projectUrl).hostname.split(".")[0] !== projectRef) {
    errors.push("OUTFLOW_ACCEPTANCE_PROJECT_REF: does not match the configured Supabase project.");
  }
  if (!exactHttpsOrigin(appUrl)) {
    errors.push("OUTFLOW_APP_URL: expected the staging application's exact HTTPS origin.");
  }
  if (mode !== "staging") {
    errors.push("OUTFLOW_ACCEPTANCE_MODE: must be the literal value staging.");
  }
  if (!/^sk_test_[A-Za-z0-9]{16,}$/.test(stripeSecretKey)) {
    errors.push("STRIPE_SECRET_KEY: a test-mode Stripe secret is required; live keys are forbidden.");
  }
  if (!/^whsec_[A-Za-z0-9]{16,}$/.test(stripeWebhookSecret)) {
    errors.push("STRIPE_WEBHOOK_SECRET: expected the staging endpoint signing secret.");
  }
  if (!/^price_[A-Za-z0-9]{8,}$/.test(stripePriceId)) {
    errors.push("STRIPE_PRO_PRICE_ID: expected the staging one-time Price ID.");
  }

  return {
    errors,
    projectUrl,
    projectRef,
    appOrigin: exactHttpsOrigin(appUrl) ? new URL(appUrl).origin : "",
    publishableKey,
    secretKey,
    stripeSecretKey,
    stripeWebhookSecret,
    stripePriceId,
  };
}

function assert(condition, label) {
  if (!condition) throw new Error(`${label}: assertion failed.`);
}

function remoteResult(result, label) {
  if (result?.error) {
    const code = /^[A-Za-z0-9_-]{1,40}$/.test(String(result.error.code || ""))
      ? result.error.code
      : "remote-error";
    throw new Error(`${label}: remote operation failed (${code}).`);
  }
  return result?.data;
}

async function responseJson(response, label) {
  let text;
  try {
    text = await response.text();
  } catch {
    throw new Error(`${label}: response body could not be read.`);
  }
  assert(text.length <= 100_000, label);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: response was not valid JSON.`);
  }
}

async function jsonRequest(url, init, expectedStatus, label, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`${label}: request failed.`);
  }
  if (response.status !== expectedStatus) {
    await response.body?.cancel();
    throw new Error(`${label}: expected HTTP ${expectedStatus}, received ${response.status}.`);
  }
  return responseJson(response, label);
}

function stripeAuthorization(secretKey) {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

async function stripeRequest(config, path, { method = "GET", form } = {}, label, fetchImpl) {
  const body = form ? new URLSearchParams(form) : undefined;
  return jsonRequest(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: stripeAuthorization(config.stripeSecretKey),
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(body ? { body } : {}),
  }, 200, label, fetchImpl);
}

function checkoutSessionId(checkoutUrl) {
  try {
    const url = new URL(checkoutUrl);
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") return "";
    return url.pathname.match(/(?:^|\/)(cs_test_[A-Za-z0-9]+)(?:\/|$)/)?.[1] || "";
  } catch {
    return "";
  }
}

function signedEvent(payload, webhookSecret, timestamp) {
  const rawBody = JSON.stringify(payload);
  const digest = createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`).digest("hex");
  return { rawBody, signature: `t=${timestamp},v1=${digest}` };
}

async function sendWebhook(config, event, label, fetchImpl, timestamp) {
  const signed = signedEvent(event, config.stripeWebhookSecret, timestamp);
  return jsonRequest(`${config.projectUrl}/functions/v1/stripe-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signed.signature,
    },
    body: signed.rawBody,
  }, 200, label, fetchImpl);
}

function eventId() {
  return `evt_outflowacceptance${randomBytes(12).toString("hex")}`;
}

function activeEntitlement(entitlement, sessionId) {
  return entitlement?.status === "active"
    && entitlement?.provider === "stripe"
    && entitlement?.provider_reference === sessionId;
}

function revokedEntitlement(entitlement, sessionId) {
  return entitlement?.status === "refunded"
    && entitlement?.provider === "stripe"
    && entitlement?.provider_reference === sessionId;
}

export async function probeStripeBillingLifecycle({
  config,
  userId,
  accessToken,
  readEntitlement,
  restoreEntitlement,
  resources = {},
  fetchImpl = fetch,
  now = () => Date.now(),
  operationId = randomUUID,
}) {
  const completed = [];
  const functionUrl = `${config.projectUrl}/functions/v1/create-pro-checkout`;
  const functionHeaders = {
    apikey: config.publishableKey,
    Authorization: `Bearer ${accessToken}`,
    Origin: config.appOrigin,
  };
  const offer = await jsonRequest(functionUrl, { method: "GET", headers: functionHeaders }, 200, "test-mode checkout offer", fetchImpl);
  assert(
    Number.isSafeInteger(offer?.unitAmount)
      && offer.unitAmount > 0
      && /^[A-Z]{3}$/.test(offer?.currency || "")
      && typeof offer?.name === "string"
      && offer.name.length > 0,
    "test-mode checkout offer",
  );
  completed.push("test-mode checkout offer");

  const checkout = await jsonRequest(functionUrl, {
    method: "POST",
    headers: { ...functionHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ operationId: operationId() }),
  }, 201, "one-time Checkout session", fetchImpl);
  resources.sessionId = checkoutSessionId(checkout?.url);
  assert(resources.sessionId, "one-time Checkout session");
  const session = await stripeRequest(
    config,
    `/checkout/sessions/${resources.sessionId}?expand%5B%5D=line_items`,
    {},
    "one-time Checkout session",
    fetchImpl,
  );
  const lineItems = session?.line_items;
  assert(
    session?.id === resources.sessionId
      && session?.livemode === false
      && session?.mode === "payment"
      && session?.payment_status === "unpaid"
      && session?.status === "open"
      && Array.isArray(lineItems?.data)
      && lineItems.data.length === 1
      && lineItems.has_more === false
      && lineItems.data[0]?.price?.id === config.stripePriceId
      && lineItems.data[0]?.quantity === 1,
    "one-time Checkout session",
  );
  completed.push("one-time Checkout session");

  const successUrl = new URL(config.appOrigin);
  successUrl.hash = "app?pro=success";
  const cancelUrl = new URL(config.appOrigin);
  cancelUrl.hash = "app?pro=cancelled";
  assert(
    session.client_reference_id === userId
      && session.metadata?.outflow_product === PRODUCT
      && session.metadata?.outflow_user_id === userId
      && session.success_url === successUrl.toString()
      && session.cancel_url === cancelUrl.toString(),
    "Checkout identity binding",
  );
  completed.push("Checkout identity binding");

  const paymentIntent = await stripeRequest(config, "/payment_intents", {
    method: "POST",
    form: {
      amount: String(offer.unitAmount),
      currency: offer.currency.toLowerCase(),
      "payment_method_types[]": "card",
      "metadata[outflow_product]": PRODUCT,
      "metadata[outflow_user_id]": userId,
      "metadata[outflow_acceptance]": "synthetic-signed-event",
    },
  }, "billing acceptance PaymentIntent", fetchImpl);
  resources.paymentIntentId = paymentIntent?.id;
  assert(
    /^pi_[A-Za-z0-9]+$/.test(resources.paymentIntentId || "")
      && paymentIntent?.livemode === false
      && paymentIntent?.status === "requires_payment_method"
      && paymentIntent?.metadata?.outflow_product === PRODUCT
      && paymentIntent?.metadata?.outflow_user_id === userId,
    "billing acceptance PaymentIntent",
  );

  const created = Math.floor(now() / 1000);
  const purchaseEventId = eventId();
  const refundEventId = eventId();
  resources.eventIds = [purchaseEventId, refundEventId];
  const purchaseEvent = {
    id: purchaseEventId,
    object: "event",
    created,
    data: { object: {
      id: resources.sessionId,
      object: "checkout.session",
      client_reference_id: userId,
      livemode: false,
      metadata: { outflow_product: PRODUCT, outflow_user_id: userId },
      mode: "payment",
      payment_intent: resources.paymentIntentId,
      payment_status: "paid",
    } },
    livemode: false,
    type: "checkout.session.completed",
  };
  const fulfilled = await sendWebhook(config, purchaseEvent, "signed purchase fulfillment", fetchImpl, created);
  assert(fulfilled?.received === true && fulfilled?.result === "fulfilled", "signed purchase fulfillment");
  assert(activeEntitlement(await readEntitlement(), resources.sessionId), "signed purchase fulfillment");
  completed.push("signed purchase fulfillment");

  const purchaseReplay = await sendWebhook(config, purchaseEvent, "duplicate purchase delivery", fetchImpl, created);
  assert(purchaseReplay?.received === true && purchaseReplay?.result === "duplicate", "duplicate purchase delivery");
  completed.push("duplicate purchase delivery");

  const restored = await restoreEntitlement();
  assert(restored?.userId === userId && activeEntitlement(restored?.entitlement, resources.sessionId), "cross-session entitlement restore");
  completed.push("cross-session entitlement restore");

  const refundEvent = {
    id: refundEventId,
    object: "event",
    created: created + 1,
    data: { object: {
      id: `ch_outflowacceptance${randomBytes(12).toString("hex")}`,
      object: "charge",
      amount: offer.unitAmount,
      amount_refunded: offer.unitAmount,
      currency: offer.currency.toLowerCase(),
      livemode: false,
      payment_intent: resources.paymentIntentId,
      refunded: true,
    } },
    livemode: false,
    type: "charge.refunded",
  };
  const refunded = await sendWebhook(config, refundEvent, "signed full refund", fetchImpl, created + 1);
  assert(refunded?.received === true && refunded?.result === "refunded", "signed full refund");
  completed.push("signed full refund");

  const refundReplay = await sendWebhook(config, refundEvent, "duplicate refund delivery", fetchImpl, created + 1);
  assert(refundReplay?.received === true && refundReplay?.result === "duplicate", "duplicate refund delivery");
  completed.push("duplicate refund delivery");
  assert(revokedEntitlement(await readEntitlement(), resources.sessionId), "entitlement revocation");
  completed.push("entitlement revocation");

  return completed;
}

async function readAccountEntitlement(client) {
  return remoteResult(await client
    .from("entitlements")
    .select("status, provider, provider_reference")
    .eq("product", PRODUCT)
    .maybeSingle(), "billing entitlement read");
}

async function signIn(config, email, password) {
  const client = createAcceptanceClient(config.projectUrl, config.publishableKey);
  const data = remoteResult(await client.auth.signInWithPassword({ email, password }), "synthetic billing sign-in");
  assert(data?.session?.access_token && data?.user?.id, "synthetic billing sign-in");
  return { client, session: data.session, user: data.user };
}

export async function cleanupBillingAcceptance(config, admin, userId, resources, fetchImpl) {
  let failed = false;
  const attempt = async (operation) => {
    try {
      await operation();
    } catch {
      failed = true;
    }
  };

  if (resources.sessionId) {
    await attempt(async () => {
      const session = await stripeRequest(config, `/checkout/sessions/${resources.sessionId}`, {}, "billing Checkout cleanup", fetchImpl);
      if (session?.status === "open") {
        await stripeRequest(config, `/checkout/sessions/${resources.sessionId}/expire`, { method: "POST" }, "billing Checkout cleanup", fetchImpl);
      }
    });
  }
  if (resources.paymentIntentId) {
    await attempt(async () => {
      const intent = await stripeRequest(config, `/payment_intents/${resources.paymentIntentId}`, {}, "billing PaymentIntent cleanup", fetchImpl);
      if (["requires_payment_method", "requires_confirmation", "requires_action", "requires_capture", "processing"].includes(intent?.status)) {
        await stripeRequest(config, `/payment_intents/${resources.paymentIntentId}/cancel`, { method: "POST" }, "billing PaymentIntent cleanup", fetchImpl);
      }
    });
  }
  if (resources.eventIds?.length) {
    await attempt(async () => remoteResult(await admin.from("billing_events").delete().in("event_id", resources.eventIds), "billing event cleanup"));
  }
  if (resources.sessionId) {
    await attempt(async () => remoteResult(await admin.from("stripe_purchases").delete().eq("checkout_session_id", resources.sessionId), "billing purchase cleanup"));
  }
  if (userId) {
    await attempt(async () => remoteResult(await admin.from("entitlements").delete().eq("user_id", userId).eq("product", PRODUCT), "billing entitlement cleanup"));
    await attempt(async () => remoteResult(await admin.from("billing_checkout_requests").delete().eq("user_id", userId), "billing reservation cleanup"));
    await attempt(async () => {
      const result = await admin.auth.admin.deleteUser(userId, false);
      if (result.error && !["user_not_found", "not_found"].includes(result.error.code)) throw result.error;
    });
  }
  if (failed) throw new Error("synthetic billing cleanup: one or more resources could not be removed.");
}

export async function runBillingPlaneAcceptance(config, { fetchImpl = fetch } = {}) {
  const completed = [];
  const admin = createAcceptanceClient(config.projectUrl, config.secretKey);
  const suffix = randomBytes(8).toString("hex");
  const email = `outflow-billing-${suffix}@example.com`;
  const password = `${randomBytes(24).toString("base64url")}aA1!`;
  const resources = {};
  let userId = "";

  try {
    const user = remoteResult(await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Outflow billing acceptance" },
    }), "synthetic billing account setup")?.user;
    userId = user?.id || "";
    assert(userId, "synthetic billing account");
    const signedIn = await signIn(config, email, password);
    assert(signedIn.user.id === userId && await readAccountEntitlement(signedIn.client) === null, "synthetic billing account");
    completed.push("synthetic billing account");

    completed.push(...await probeStripeBillingLifecycle({
      config,
      userId,
      accessToken: signedIn.session.access_token,
      readEntitlement: () => readAccountEntitlement(signedIn.client),
      restoreEntitlement: async () => {
        const restored = await signIn(config, email, password);
        return { userId: restored.user.id, entitlement: await readAccountEntitlement(restored.client) };
      },
      resources,
      fetchImpl,
    }));
  } finally {
    await cleanupBillingAcceptance(config, admin, userId, resources, fetchImpl);
  }
  completed.push("synthetic billing cleanup");
  return completed;
}

export function buildBillingPlaneReport({ checks, projectRef, appOrigin, commitSha, actor, runId, completedAt }) {
  assert(JSON.stringify(checks) === JSON.stringify(expectedCheckNames), "complete billing acceptance inventory");
  assert(/^[a-z0-9]{20}$/.test(projectRef), "billing report project");
  assert(exactHttpsOrigin(appOrigin), "billing report app origin");
  const safeCommit = /^[a-f0-9]{7,40}$/i.test(String(commitSha || "")) ? commitSha : "local";
  const safeActor = /^[A-Za-z0-9_-]{1,80}$/.test(String(actor || "")) ? actor : "local";
  const safeRun = /^[A-Za-z0-9_-]{1,80}$/.test(String(runId || "")) ? runId : "local";
  const safeTime = Number.isFinite(Date.parse(completedAt)) ? new Date(completedAt).toISOString() : new Date().toISOString();
  return [
    "## Outflow staging billing plane",
    "",
    `- Commit: \`${safeCommit}\``,
    `- Actor: \`${safeActor}\``,
    `- Run: \`${safeRun}\``,
    `- Supabase project: \`${projectRef}\``,
    `- Application origin: \`${appOrigin}\``,
    `- Completed: \`${safeTime}\``,
    "- Stripe mode: `test`",
    "",
    ...checks.map((check) => `- PASS / ${check}`),
    "",
    "This run used a real open test-mode Checkout Session plus correctly signed synthetic fulfillment and refund events. It made no card charge and does not prove Stripe's outbound webhook delivery.",
    "The report excludes identities, credentials, Checkout URLs, provider object IDs, event bodies, and response bodies.",
    "",
  ].join("\n");
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

async function main() {
  const envFile = argumentValue("--env-file");
  const summaryFile = argumentValue("--summary-file");
  const fileEnvironment = envFile ? parseEnvFile(await readFile(resolve(envFile), "utf8")) : {};
  const config = resolveBillingAcceptanceConfig({ ...fileEnvironment, ...process.env });
  if (config.errors.length) {
    for (const error of config.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  try {
    const checks = await runBillingPlaneAcceptance(config);
    const report = buildBillingPlaneReport({
      checks,
      projectRef: config.projectRef,
      appOrigin: config.appOrigin,
      commitSha: process.env.GITHUB_SHA,
      actor: process.env.GITHUB_ACTOR,
      runId: process.env.GITHUB_RUN_ID,
      completedAt: new Date().toISOString(),
    });
    if (summaryFile) await appendFile(resolve(summaryFile), report, "utf8");
    console.log(report);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Staging billing plane failed.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
