import { createAdminClient, resolveSupabaseRuntime } from "../_shared/supabase-runtime.ts";
import { calendarBody, validPayload } from "./calendar.ts";

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const { projectUrl, secretKey } = resolveSupabaseRuntime();
  if (!projectUrl || !secretKey) return jsonResponse({ error: "Calendar feeds are not configured." }, 503);

  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) return jsonResponse({ error: "Calendar feed not found." }, 404);

  const adminClient = createAdminClient(projectUrl, secretKey);
  const { data, error } = await adminClient.rpc("resolve_calendar_feed", { target_token_hash: await sha256(token) });
  if (error) return jsonResponse({ error: "Calendar feed is temporarily unavailable." }, 503);
  if (!validPayload(data)) return jsonResponse({ error: "Calendar feed not found." }, 404);

  try {
    const body = calendarBody(data);
    const bodyHash = await sha256(body);
    const etag = `"${bodyHash}"`;
    const headers = {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="outflow-${data.ledger.id}.ics"`,
      "Cache-Control": "private, no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
    };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
  } catch {
    return jsonResponse({ error: "Calendar feed could not be generated." }, 500);
  }
});
