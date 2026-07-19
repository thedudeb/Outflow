import { createClient } from "npm:@supabase/supabase-js@2.75.0";
import { createAdminClient, resolveSupabaseRuntime } from "../_shared/supabase-runtime.ts";

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

  const { projectUrl, publishableKey, secretKey } = resolveSupabaseRuntime();
  const authorization = request.headers.get("authorization") || "";
  if (!projectUrl || !publishableKey || !secretKey || !authorization.startsWith("Bearer ")) {
    return response({ error: "Account deletion is not configured." }, 503, origin);
  }

  const userClient = createClient(projectUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return response({ error: "Authentication is required." }, 401, origin);

  const adminClient = createAdminClient(projectUrl, secretKey);
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userData.user.id, false);
  if (deleteError) return response({ error: "Account deletion failed." }, 500, origin);

  return response({ deleted: true }, 200, origin);
});
