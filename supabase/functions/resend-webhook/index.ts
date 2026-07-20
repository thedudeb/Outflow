import { createAdminClient, resolveSupabaseRuntime } from "../_shared/supabase-runtime.ts";
import { MAX_RESEND_WEBHOOK_BYTES, parseResendProviderEvent, verifyResendWebhook } from "./webhook.ts";

function response(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
  if (Number(request.headers.get("content-length") || 0) > MAX_RESEND_WEBHOOK_BYTES) {
    return response({ error: "Request is too large." }, 413);
  }

  const { projectUrl, secretKey } = resolveSupabaseRuntime();
  const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";
  const webhookHeaders = {
    id: request.headers.get("svix-id") || "",
    timestamp: request.headers.get("svix-timestamp") || "",
    signature: request.headers.get("svix-signature") || "",
  };
  if (!projectUrl || !secretKey || !/^whsec_[A-Za-z0-9+/_=-]{16,}$/.test(webhookSecret)) {
    return response({ error: "Resend event handling is not configured." }, 503);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_RESEND_WEBHOOK_BYTES) {
    return response({ error: "Request is too large." }, 413);
  }
  if (!(await verifyResendWebhook(rawBody, webhookHeaders, webhookSecret))) {
    return response({ error: "Webhook signature is invalid." }, 400);
  }

  let event;
  try {
    event = parseResendProviderEvent(rawBody);
  } catch {
    return response({ error: "Webhook event is invalid." }, 400);
  }
  if (!event) return response({ received: true, result: "ignored" }, 200);

  const adminClient = createAdminClient(projectUrl, secretKey);
  const { data, error } = await adminClient.rpc("record_email_provider_event", {
    provider_event_id: webhookHeaders.id,
    provider_event_type: event.eventType,
    provider_identifier: event.providerIdentifier,
    provider_event_created_at: event.eventCreatedAt,
  });
  if (error) return response({ error: "Email provider event could not be processed." }, 500);
  return response({ received: true, result: data?.result || "processed" }, 200);
});
