import { createClient } from "npm:@supabase/supabase-js@2.75.0";
import { createAdminClient, resolveSupabaseRuntime } from "../_shared/supabase-runtime.ts";

const PRODUCT = "Outflow";
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

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

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405, origin);
  if (Number(request.headers.get("content-length") || 0) > 4096) return response({ error: "Request is too large." }, 413, origin);

  const { projectUrl, publishableKey, secretKey } = resolveSupabaseRuntime();
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  const inviteFrom = Deno.env.get("OUTFLOW_INVITE_FROM") || "";
  const appUrl = Deno.env.get("OUTFLOW_APP_URL") || "";
  const authorization = request.headers.get("authorization") || "";
  if (!projectUrl || !publishableKey || !secretKey || !resendKey || !inviteFrom || !validAppUrl(appUrl) || !authorization.startsWith("Bearer ")) {
    return response({ error: "List invitations are not configured." }, 503, origin);
  }

  let body: { ledgerId?: unknown; email?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return response({ error: "A valid JSON request is required." }, 400, origin);
  }

  const ledgerId = typeof body.ledgerId === "string" ? body.ledgerId.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role === "editor" || body.role === "viewer" ? body.role : "";
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(ledgerId) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !role) {
    return response({ error: "Invitation details are invalid." }, 400, origin);
  }

  const userClient = createClient(projectUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return response({ error: "Authentication is required." }, 401, origin);

  const { data: permission, error: permissionError } = await userClient.rpc("can_invite_to_ledger", {
    target_ledger_id: ledgerId,
  });
  if (permissionError || !permission?.ledgerId) return response({ error: "A Pro list owner is required." }, 403, origin);

  const adminClient = createAdminClient(projectUrl, secretKey);
  const { count: pendingCount, error: countError } = await adminClient
    .from("ledger_invitations")
    .select("id", { count: "exact", head: true })
    .eq("ledger_id", ledgerId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString());
  if (countError) return response({ error: "Invitation could not be prepared." }, 500, origin);
  if ((pendingCount || 0) >= 25) return response({ error: "This list has reached its pending invitation limit." }, 409, origin);

  const { data: existing, error: existingError } = await adminClient
    .from("ledger_invitations")
    .select("id, created_at")
    .eq("ledger_id", ledgerId)
    .eq("email", email)
    .is("accepted_at", null)
    .maybeSingle();
  if (existingError) return response({ error: "Invitation could not be prepared." }, 500, origin);
  if (existing && Date.now() - Date.parse(existing.created_at) < RESEND_COOLDOWN_MS) {
    return response({ error: "Wait one minute before sending another invitation to this address." }, 429, origin);
  }
  if (existing) {
    const { error: removeError } = await adminClient.from("ledger_invitations").delete().eq("id", existing.id);
    if (removeError) return response({ error: "Invitation could not be replaced." }, 500, origin);
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITE_LIFETIME_MS).toISOString();
  const { data: invitation, error: insertError } = await adminClient
    .from("ledger_invitations")
    .insert({
      ledger_id: ledgerId,
      email,
      role,
      token_hash: await sha256(token),
      invited_by: userData.user.id,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (insertError || !invitation) return response({ error: "Invitation could not be created." }, 500, origin);

  const joinUrl = new URL(appUrl);
  joinUrl.hash = `app?invite=${encodeURIComponent(token)}`;
  const ledgerName = String(permission.ledgerName || "Shared list");
  const sender = userData.user.email || "An Outflow member";
  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: inviteFrom,
      to: [email],
      subject: `${sender} invited you to ${ledgerName} in ${PRODUCT}`,
      text: `${sender} invited you to the ${ledgerName} subscription list as ${role}. Open this private link within 7 days: ${joinUrl.toString()}`,
      html: `<p><strong>${escapeHtml(sender)}</strong> invited you to the <strong>${escapeHtml(ledgerName)}</strong> subscription list as ${escapeHtml(role)}.</p><p><a href="${escapeHtml(joinUrl.toString())}">Accept the Outflow invitation</a></p><p>This private link expires in 7 days.</p>`,
    }),
  });

  if (!resendResponse.ok) {
    await adminClient.from("ledger_invitations").delete().eq("id", invitation.id);
    return response({ error: "Invitation email could not be delivered." }, 502, origin);
  }

  return response({ id: invitation.id, email, role, expiresAt }, 201, origin);
});
