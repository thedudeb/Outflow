const projectUrl = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const publishableKey = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "",
).trim();

function validProjectUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  } catch {
    return false;
  }
}

function jwtRole(value) {
  if (!value.includes(".")) return "";
  try {
    const payload = value.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    const decoded = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return typeof decoded.role === "string" ? decoded.role : "";
  } catch {
    return "";
  }
}

const secretKeyExposed = publishableKey.startsWith("sb_secret_") || jwtRole(publishableKey) === "service_role";
const hasPartialConfig = Boolean(projectUrl || publishableKey);

export const cloudConfigError = secretKeyExposed
  ? "A server-only Supabase secret was supplied to the browser. Use a publishable key instead."
  : hasPartialConfig && (!validProjectUrl(projectUrl) || !publishableKey)
    ? "Supabase cloud configuration is incomplete or invalid."
    : "";

export const cloudConfigured = Boolean(projectUrl && publishableKey && !cloudConfigError);

let cloudPromise;

export function getCloud() {
  if (!cloudConfigured) return Promise.resolve(null);
  if (!cloudPromise) {
    cloudPromise = import("@supabase/supabase-js").then(({ createClient }) => createClient(projectUrl, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        persistSession: true,
      },
      global: {
        headers: { "X-Client-Info": "outflow-web" },
      },
    }));
  }
  return cloudPromise;
}

export async function requestAccountLink(email) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const redirect = new URL(window.location.href);
  redirect.hash = "app";
  const { error } = await cloud.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirect.toString(),
      shouldCreateUser: true,
    },
  });
  if (error) throw error;
}

export async function uploadGuestWorkspace(workspace) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { data, error } = await cloud.rpc("migrate_guest_workspace", { workspace_payload: workspace });
  if (error) throw error;
  return data;
}

export async function readProEntitlement(userId) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { data, error } = await cloud
    .from("entitlements")
    .select("status, provider, purchased_at")
    .eq("user_id", userId)
    .eq("product", "outflow_pro_lifetime")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteCloudAccount() {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { data, error } = await cloud.functions.invoke("delete-account", { method: "POST" });
  if (error) throw error;
  return data;
}
