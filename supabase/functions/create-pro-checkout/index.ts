import Stripe from "npm:stripe@22.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.75.0";
import { resolveSupabaseRuntime } from "../_shared/supabase-runtime.ts";

const PRODUCT = "outflow_pro_lifetime";
const OFFER_CACHE_MS = 5 * 60 * 1000;

type Offer = {
  currency: string;
  name: string;
  priceId: string;
  unitAmount: number;
};

let cachedOffer: Offer | null = null;
let offerExpiresAt = 0;

function allowedOrigin(request: Request) {
  const origin = request.headers.get("origin") || "";
  const configured = (Deno.env.get("OUTFLOW_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.includes(origin) ? origin : "";
}

function response(body: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    },
  });
}

function validAppUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  } catch {
    return false;
  }
}

async function readOffer(stripe: Stripe, priceId: string): Promise<Offer> {
  if (cachedOffer?.priceId === priceId && offerExpiresAt > Date.now()) return cachedOffer;
  const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
  if (!price.active || price.type !== "one_time" || !Number.isSafeInteger(price.unit_amount) || (price.unit_amount || 0) <= 0) {
    throw new Error("The configured Pro price must be an active fixed one-time price.");
  }
  if (!price.product || typeof price.product === "string" || "deleted" in price.product) {
    throw new Error("The configured Pro product is unavailable.");
  }
  cachedOffer = {
    currency: price.currency.toUpperCase(),
    name: String(price.product.name || "Outflow Pro").slice(0, 80),
    priceId: price.id,
    unitAmount: price.unit_amount || 0,
  };
  offerExpiresAt = Date.now() + OFFER_CACHE_MS;
  return cachedOffer;
}

Deno.serve(async (request) => {
  const origin = allowedOrigin(request);
  if (!origin) return response({ error: "Origin is not allowed." }, 403, "");
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }
  if (!['GET', 'POST'].includes(request.method)) return response({ error: "Method not allowed." }, 405, origin);
  if (Number(request.headers.get("content-length") || 0) > 4096) return response({ error: "Request is too large." }, 413, origin);

  const { projectUrl, publishableKey } = resolveSupabaseRuntime();
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") || "";
  const priceId = Deno.env.get("STRIPE_PRO_PRICE_ID") || "";
  const appUrl = Deno.env.get("OUTFLOW_APP_URL") || "";
  const authorization = request.headers.get("authorization") || "";
  if (!projectUrl || !publishableKey || !stripeSecret || !/^price_[a-zA-Z0-9]+$/.test(priceId) || !validAppUrl(appUrl) || !authorization.startsWith("Bearer ")) {
    return response({ error: "Outflow Pro checkout is not configured." }, 503, origin);
  }

  const userClient = createClient(projectUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return response({ error: "Authentication is required." }, 401, origin);

  try {
    const stripe = new Stripe(stripeSecret);
    const offer = await readOffer(stripe, priceId);
    if (request.method === "GET") {
      return response({ currency: offer.currency, name: offer.name, unitAmount: offer.unitAmount }, 200, origin);
    }

    let body: { operationId?: unknown };
    try {
      body = await request.json();
    } catch {
      return response({ error: "A valid JSON request is required." }, 400, origin);
    }
    const operationId = typeof body.operationId === "string" ? body.operationId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
      return response({ error: "Checkout operation is invalid." }, 400, origin);
    }

    const { error: reservationError } = await userClient.rpc("reserve_pro_checkout", {
      client_operation_id: operationId,
    });
    if (reservationError) {
      const limited = reservationError.message?.includes("Checkout request limit reached");
      return response({ error: limited ? "Checkout request limit reached. Try again later." : "Checkout could not be reserved." }, limited ? 429 : 409, origin);
    }

    const successUrl = new URL(appUrl);
    successUrl.hash = "app?pro=success";
    const cancelUrl = new URL(appUrl);
    cancelUrl.hash = "app?pro=cancelled";
    const metadata = { outflow_product: PRODUCT, outflow_user_id: userData.user.id };
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: userData.user.id,
      customer_email: userData.user.email || undefined,
      line_items: [{ price: offer.priceId, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString(),
    }, { idempotencyKey: `outflow:${userData.user.id}:${operationId}` });
    if (!session.url) return response({ error: "Stripe did not return a hosted checkout URL." }, 502, origin);
    return response({ url: session.url }, 201, origin);
  } catch {
    return response({ error: "Outflow Pro checkout is temporarily unavailable." }, 502, origin);
  }
});
