import { createAdminClient, resolveSupabaseRuntime } from "../_shared/supabase-runtime.ts";
import {
  allowedBrowserOrigin,
  bearerToken,
  integrationRoute,
  readJsonObjectBody,
  validDueBefore,
  validRouteIdentifiers,
  withoutSubscriptionId,
} from "./integration.ts";

type JsonObject = Record<string, unknown>;

function addCorsHeaders(headers: Headers, origin: string) {
  if (!origin) return;
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Expose-Headers", "X-Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset");
  headers.set("Vary", "Origin");
}

function jsonResponse(body: JsonObject, status: number, origin: string, requestId: string, rate?: JsonObject) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Request-ID": requestId,
  });
  if (rate) {
    headers.set("X-RateLimit-Limit", "300");
    headers.set("X-RateLimit-Remaining", String(rate.requestsRemaining ?? 0));
    headers.set("X-RateLimit-Reset", String(rate.windowResetsAt || ""));
  }
  addCorsHeaders(headers, origin);
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

function databaseStatus(error: { code?: string; message?: string } | null) {
  if (error?.code === "42501") return 403;
  if (error?.code === "23505") return 409;
  if (error?.code === "22023" || error?.code === "22007") return 400;
  if (error?.code === "54000") return 409;
  return 500;
}

function databaseMessage(status: number) {
  if (status === 403) return "This token cannot perform that operation.";
  if (status === 409) return "The requested change conflicts with current data.";
  if (status === 400) return "The subscription data is invalid.";
  return "Outflow could not complete the request.";
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get("origin") || "";
  const configuredOrigins = Deno.env.get("OUTFLOW_ALLOWED_ORIGINS") || "";
  if (!allowedBrowserOrigin(origin, configuredOrigins)) {
    return jsonResponse({ error: "Origin is not allowed." }, 403, "", requestId);
  }
  if (request.method === "OPTIONS") {
    if (!origin) return jsonResponse({ error: "Origin is required for browser preflight." }, 400, "", requestId);
    const headers = new Headers({
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Max-Age": "86400",
    });
    addCorsHeaders(headers, origin);
    return new Response(null, {
      status: 204,
      headers,
    });
  }

  const { projectUrl, secretKey } = resolveSupabaseRuntime();
  if (!projectUrl || !secretKey) {
    return jsonResponse({ error: "Outflow integrations are not configured." }, 503, origin, requestId);
  }
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return jsonResponse({ error: "A valid Outflow integration token is required." }, 401, origin, requestId);

  const admin = createAdminClient(projectUrl, secretKey);
  const { data: serviceStatus, error: serviceError } = await admin.rpc("read_app_service_status");
  if (serviceError) return jsonResponse({ error: "Outflow integrations are temporarily unavailable." }, 503, origin, requestId);
  if (serviceStatus?.maintenanceEnabled === true) {
    return jsonResponse({ error: "App in maintenance mode. Thank you for understanding." }, 503, origin, requestId);
  }

  const { data: principal, error: authError } = await admin.rpc("authenticate_integration_token", {
    presented_token: token,
  });
  if (authError || !principal) {
    return jsonResponse({ error: "The integration token is invalid, expired, revoked, or inactive." }, 401, origin, requestId);
  }
  if (principal.rateLimited === true) {
    return jsonResponse({ error: "Integration request limit reached. Try again after the current ten-minute window." }, 429, origin, requestId, principal);
  }

  const route = integrationRoute(new URL(request.url));
  if (!validRouteIdentifiers(route)) return jsonResponse({ error: "Resource identifier is invalid." }, 400, origin, requestId, principal);
  if (route.kind === "missing") return jsonResponse({ error: "Resource not found." }, 404, origin, requestId, principal);
  const scopes = Array.isArray(principal.scopes) ? principal.scopes : [];
  const writing = ["POST", "PATCH", "DELETE"].includes(request.method);
  if (!scopes.includes(writing ? "write" : "read")) {
    return jsonResponse({ error: "This token does not include the required scope." }, 403, origin, requestId, principal);
  }

  if (route.kind === "service" && request.method === "GET") {
    return jsonResponse({ data: { product: "Outflow", apiVersion: "v1", authenticated: true } }, 200, origin, requestId, principal);
  }

  if (route.kind === "lists" && request.method === "GET") {
    const { data, error } = await admin.rpc("integration_list_lists", { caller: principal.userId });
    if (error) return jsonResponse({ error: databaseMessage(databaseStatus(error)) }, databaseStatus(error), origin, requestId, principal);
    return jsonResponse({ data }, 200, origin, requestId, principal);
  }

  if (route.kind === "subscriptions" && request.method === "GET") {
    const url = new URL(request.url);
    const dueBefore = url.searchParams.get("dueBefore");
    if (!validDueBefore(dueBefore)) return jsonResponse({ error: "dueBefore must be a valid YYYY-MM-DD date." }, 400, origin, requestId, principal);
    const includePaused = url.searchParams.get("includePaused") !== "false";
    const { data, error } = await admin.rpc("integration_list_subscriptions", {
      caller: principal.userId,
      target_list_id: route.listId,
      include_paused: includePaused,
      due_before: dueBefore || null,
    });
    if (error) return jsonResponse({ error: databaseMessage(databaseStatus(error)) }, databaseStatus(error), origin, requestId, principal);
    return jsonResponse({ data }, 200, origin, requestId, principal);
  }

  if (route.kind === "subscriptions" && request.method === "POST") {
    const parsed = withoutSubscriptionId(await readJsonObjectBody(request));
    if (!parsed) return jsonResponse({ error: "A valid JSON subscription is required." }, 400, origin, requestId, principal);
    const subscriptionId = parsed.id || crypto.randomUUID();
    const { data, error } = await admin.rpc("integration_save_subscription", {
      caller: principal.userId,
      target_list_id: route.listId,
      target_subscription_id: subscriptionId,
      subscription_payload: parsed.payload,
      create_only: true,
    });
    if (error) return jsonResponse({ error: databaseMessage(databaseStatus(error)) }, databaseStatus(error), origin, requestId, principal);
    return jsonResponse({ data }, 201, origin, requestId, principal);
  }

  if (route.kind === "subscription" && request.method === "PATCH") {
    const body = await readJsonObjectBody(request);
    if (!body) return jsonResponse({ error: "A valid JSON subscription change is required." }, 400, origin, requestId, principal);
    const { data, error } = await admin.rpc("integration_save_subscription", {
      caller: principal.userId,
      target_list_id: route.listId,
      target_subscription_id: route.subscriptionId,
      subscription_payload: body,
      create_only: false,
    });
    if (error) return jsonResponse({ error: databaseMessage(databaseStatus(error)) }, databaseStatus(error), origin, requestId, principal);
    if (!data) return jsonResponse({ error: "Subscription not found." }, 404, origin, requestId, principal);
    return jsonResponse({ data }, 200, origin, requestId, principal);
  }

  if (route.kind === "subscription" && request.method === "DELETE") {
    const { data, error } = await admin.rpc("integration_delete_subscription", {
      caller: principal.userId,
      target_list_id: route.listId,
      target_subscription_id: route.subscriptionId,
    });
    if (error) return jsonResponse({ error: databaseMessage(databaseStatus(error)) }, databaseStatus(error), origin, requestId, principal);
    if (data !== true) return jsonResponse({ error: "Subscription not found." }, 404, origin, requestId, principal);
    return jsonResponse({ data: { deleted: true, id: route.subscriptionId } }, 200, origin, requestId, principal);
  }

  return jsonResponse({ error: "Method not allowed." }, 405, origin, requestId, principal);
});
