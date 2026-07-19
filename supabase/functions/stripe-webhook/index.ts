import Stripe from "npm:stripe@22.0.0";
import { createAdminClient, resolveSupabaseRuntime } from "../_shared/supabase-runtime.ts";

const PRODUCT = "outflow_pro_lifetime";
const MAX_WEBHOOK_BYTES = 1024 * 1024;

function response(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
  if (Number(request.headers.get("content-length") || 0) > MAX_WEBHOOK_BYTES) return response({ error: "Request is too large." }, 413);

  const { projectUrl, secretKey } = resolveSupabaseRuntime();
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") || "";
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  const priceId = Deno.env.get("STRIPE_PRO_PRICE_ID") || "";
  const signature = request.headers.get("stripe-signature") || "";
  if (!projectUrl || !secretKey || !stripeSecret || !webhookSecret || !/^price_[a-zA-Z0-9]+$/.test(priceId) || !signature) {
    return response({ error: "Stripe fulfillment is not configured." }, 503);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES) return response({ error: "Request is too large." }, 413);
  const stripe = new Stripe(stripeSecret);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return response({ error: "Webhook signature is invalid." }, 400);
  }

  const adminClient = createAdminClient(projectUrl, secretKey);

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "payment" || session.payment_status !== "paid") return response({ received: true, result: "payment-pending" }, 200);
      const userId = session.metadata?.outflow_user_id || "";
      if (
        session.metadata?.outflow_product !== PRODUCT
        || session.client_reference_id !== userId
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
        || session.livemode !== event.livemode
      ) return response({ error: "Checkout identity is invalid." }, 400);

      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 });
      if (lineItems.has_more || lineItems.data.length !== 1 || lineItems.data[0].price?.id !== priceId || lineItems.data[0].quantity !== 1) {
        return response({ error: "Checkout product is invalid." }, 400);
      }
      const { data: accountData, error: accountError } = await adminClient.auth.admin.getUserById(userId);
      if (accountError && accountError.status !== 404) throw accountError;
      if (!accountData.user) return response({ received: true, result: "account-deleted" }, 200);
      const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || "";
      const { data, error } = await adminClient.rpc("fulfill_stripe_pro_purchase", {
        provider_event_id: event.id,
        provider_event_type: event.type,
        target_checkout_session_id: session.id,
        target_payment_intent_id: paymentIntentId,
        target_user_id: userId,
        event_livemode: event.livemode,
        payment_completed_at: new Date(event.created * 1000).toISOString(),
      });
      if (error) throw error;
      return response({ received: true, result: data?.status || "fulfilled" }, 200);
    }

    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      if (!charge.refunded || charge.amount_refunded < charge.amount) return response({ received: true, result: "partial-refund-ignored" }, 200);
      const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id || "";
      if (!paymentIntentId) return response({ error: "Refund payment is unavailable." }, 400);
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (paymentIntent.metadata?.outflow_product !== PRODUCT) return response({ received: true, result: "unrelated-refund" }, 200);
      if (paymentIntent.livemode !== event.livemode) return response({ error: "Refund mode is invalid." }, 400);
      const { data, error } = await adminClient.rpc("refund_stripe_pro_purchase", {
        provider_event_id: event.id,
        target_payment_intent_id: paymentIntentId,
        payment_refunded_at: new Date(event.created * 1000).toISOString(),
      });
      if (error) throw error;
      return response({ received: true, result: data?.status || "refunded" }, 200);
    }

    return response({ received: true, result: "ignored" }, 200);
  } catch {
    return response({ error: "Billing event could not be processed." }, 500);
  }
});
