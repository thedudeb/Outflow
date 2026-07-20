import { createAdminClient, resolveSupabaseRuntime } from "../_shared/supabase-runtime.ts";
import { resendFailureCode } from "./reminder.ts";

type Delivery = {
  delivery_id: string;
  recipient_email: string;
  subscription_name: string;
  amount: number | string;
  currency: string;
  billing_date: string;
  ledger_name: string;
  ledger_kind: string;
  reminder_kind: "charge" | "trial";
  lead_days: number;
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] || character);
}

async function secretsMatch(received: string, expected: string) {
  const encoder = new TextEncoder();
  const [receivedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const receivedBytes = new Uint8Array(receivedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= receivedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0 && received.length === expected.length;
}

function validAppUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  } catch {
    return false;
  }
}

function validBearerSecret(value: string) {
  return value.length >= 32
    && value.length <= 512
    && !/\s/.test(value)
    && new Set(value).size >= 12;
}

function formattedAmount(amount: number | string, currency: string) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !/^[A-Z]{3}$/.test(currency)) return "Amount unavailable";
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(numericAmount);
}

function formattedDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(parsed);
}

function timingCopy(leadDays: number) {
  if (leadDays === 0) return "today";
  if (leadDays === 1) return "tomorrow";
  return `in ${leadDays} days`;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
  if (Number(request.headers.get("content-length") || 0) > 1024) return response({ error: "Request is too large." }, 413);

  const { projectUrl, secretKey } = resolveSupabaseRuntime();
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  const cronSecret = Deno.env.get("OUTFLOW_CRON_SECRET") || "";
  const operationsSecret = Deno.env.get("OUTFLOW_OPERATIONS_SECRET") || "";
  const reminderFrom = Deno.env.get("OUTFLOW_REMINDER_FROM") || "";
  const appUrl = Deno.env.get("OUTFLOW_APP_URL") || "";
  const deploymentCommit = Deno.env.get("OUTFLOW_DEPLOYMENT_COMMIT") || "";
  if (
    !projectUrl
    || !secretKey
    || !resendKey
    || !validBearerSecret(cronSecret)
    || !validBearerSecret(operationsSecret)
    || operationsSecret === cronSecret
    || !reminderFrom
    || !validAppUrl(appUrl)
    || !/^[a-f0-9]{40}$/.test(deploymentCommit)
  ) {
    return response({ error: "Email reminders are not configured." }, 503);
  }

  let body: { action?: unknown; batchSize?: unknown; expectedCommit?: unknown } = {};
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 1024) return response({ error: "Request is too large." }, 413);
    const parsedBody = rawBody ? JSON.parse(rawBody) : {};
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return response({ error: "A JSON object is required." }, 400);
    }
    body = parsedBody;
  } catch {
    return response({ error: "A valid JSON request is required." }, 400);
  }

  const healthRequest = body.action === "health";
  const allowedKeys = healthRequest ? ["action", "expectedCommit"] : ["batchSize"];
  if (body.action !== undefined && !healthRequest) return response({ error: "Unsupported worker action." }, 400);
  if (Object.keys(body).some((key) => !allowedKeys.includes(key))) return response({ error: "Unsupported request field." }, 400);

  const authorization = request.headers.get("authorization") || "";
  const receivedSecret = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedSecret = healthRequest ? operationsSecret : cronSecret;
  if (!receivedSecret || receivedSecret.length > 512 || !(await secretsMatch(receivedSecret, expectedSecret))) {
    return response({ error: "Worker authentication failed." }, 401);
  }

  const adminClient = createAdminClient(projectUrl, secretKey);
  if (healthRequest) {
    const expectedCommit = typeof body.expectedCommit === "string" ? body.expectedCommit : "";
    if (!/^[a-f0-9]{40}$/.test(expectedCommit)) return response({ error: "Expected commit is invalid." }, 400);
    const { data: health, error: healthError } = await adminClient.rpc("reminder_operational_health", {
      expected_deployment_commit: expectedCommit,
    });
    if (healthError || !health) return response({ error: "Reminder health is unavailable." }, 500);
    return response(health);
  }

  const requestedBatchSize = body.batchSize === undefined ? 25 : Number(body.batchSize);
  if (!Number.isInteger(requestedBatchSize) || requestedBatchSize < 1 || requestedBatchSize > 100) {
    return response({ error: "Batch size must be between 1 and 100." }, 400);
  }

  const workerStartedAt = new Date().toISOString();
  const claimToken = crypto.randomUUID();
  const { data, error: claimError } = await adminClient.rpc("claim_due_email_notifications", {
    requested_batch_size: requestedBatchSize,
    worker_claim_token: claimToken,
  });
  if (claimError) {
    await adminClient.rpc("record_reminder_worker_run", {
      worker_started_at: workerStartedAt,
      worker_deployment_commit: deploymentCommit,
      worker_claimed: 0,
      worker_sent: 0,
      worker_failed: 0,
      worker_completion_errors: 1,
    });
    return response({ error: "Due reminders could not be claimed." }, 500);
  }

  const deliveries = (Array.isArray(data) ? data : []) as Delivery[];
  let sent = 0;
  let failed = 0;
  let completionErrors = 0;

  for (const delivery of deliveries) {
    const amount = formattedAmount(delivery.amount, delivery.currency);
    const billingDate = formattedDate(delivery.billing_date);
    const eventLabel = delivery.reminder_kind === "trial" ? "trial ends" : "charge is due";
    const subject = `${delivery.subscription_name} ${eventLabel} ${timingCopy(delivery.lead_days)}`.slice(0, 180);
    const text = [
      `${delivery.subscription_name} ${eventLabel} ${timingCopy(delivery.lead_days)}.`,
      `${amount} on ${billingDate}.`,
      `Ledger: ${delivery.ledger_name} (${delivery.ledger_kind}).`,
      `Open Outflow: ${appUrl}`,
    ].join("\n");
    const html = [
      `<p><strong>${escapeHtml(delivery.subscription_name)}</strong> ${escapeHtml(eventLabel)} ${escapeHtml(timingCopy(delivery.lead_days))}.</p>`,
      `<p><strong>${escapeHtml(amount)}</strong> on ${escapeHtml(billingDate)}.</p>`,
      `<p>Ledger: ${escapeHtml(delivery.ledger_name)} (${escapeHtml(delivery.ledger_kind)}).</p>`,
      `<p><a href="${escapeHtml(appUrl)}">Open Outflow</a></p>`,
    ].join("");

    let succeeded = false;
    let providerIdentifier = "";
    let errorCode = "delivery_failed";
    try {
      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `outflow-reminder/${delivery.delivery_id}`,
          "User-Agent": "outflow-reminder-worker/1.0",
        },
        body: JSON.stringify({
          from: reminderFrom,
          to: [delivery.recipient_email],
          subject,
          text,
          html,
        }),
      });
      if (resendResponse.ok) {
        const providerBody = await resendResponse.json().catch(() => ({}));
        providerIdentifier = typeof providerBody?.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(providerBody.id)
          ? providerBody.id
          : "";
        succeeded = Boolean(providerIdentifier);
        errorCode = succeeded ? "" : "resend_invalid_response";
      } else {
        errorCode = await resendFailureCode(resendResponse);
      }
    } catch {
      errorCode = "resend_network_error";
    }

    const { data: completed, error: completionError } = await adminClient.rpc("complete_email_notification", {
      target_delivery_id: delivery.delivery_id,
      worker_claim_token: claimToken,
      delivery_succeeded: succeeded,
      provider_identifier: providerIdentifier || null,
      error_code: errorCode || null,
    });
    if (completionError || completed !== true) completionErrors += 1;
    if (succeeded) sent += 1;
    else failed += 1;
  }

  const { data: runRecorded, error: runRecordError } = await adminClient.rpc("record_reminder_worker_run", {
    worker_started_at: workerStartedAt,
    worker_deployment_commit: deploymentCommit,
    worker_claimed: deliveries.length,
    worker_sent: sent,
    worker_failed: failed,
    worker_completion_errors: completionErrors,
  });
  if (runRecordError || runRecorded !== true) completionErrors += 1;

  return response({ claimed: deliveries.length, sent, failed, completionErrors, deploymentCommit });
});
