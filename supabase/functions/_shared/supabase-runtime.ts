import { createClient } from "npm:@supabase/supabase-js@2.75.0";

type EnvironmentReader = (name: string) => string | undefined;
export type FetchImplementation = typeof fetch;

function validOpaqueKey(value: string, prefix: string) {
  return value.startsWith(prefix)
    && value.length >= prefix.length + 16
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function valueFromCollection(rawValue: string | undefined, prefix: string) {
  if (!rawValue) return "";
  try {
    const values = JSON.parse(rawValue) as Record<string, unknown>;
    const value = typeof values?.default === "string" ? values.default.trim() : "";
    return validOpaqueKey(value, prefix) ? value : "";
  } catch {
    return "";
  }
}

function environmentValue(read: EnvironmentReader, name: string) {
  return String(read(name) || "").trim();
}

function legacyKeyHasRole(value: string, expectedRole: string) {
  try {
    const parts = value.split(".");
    if (parts.length !== 3) return false;
    const base64 = parts[1].replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { role?: unknown };
    return payload.role === expectedRole;
  } catch {
    return false;
  }
}

export function resolveSupabaseRuntime(read: EnvironmentReader = (name) => Deno.env.get(name)) {
  const localPublishable = environmentValue(read, "SUPABASE_PUBLISHABLE_KEY");
  const localSecret = environmentValue(read, "SUPABASE_SECRET_KEY");
  const legacyPublishable = environmentValue(read, "SUPABASE_ANON_KEY");
  const legacySecret = environmentValue(read, "SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = valueFromCollection(read("SUPABASE_PUBLISHABLE_KEYS"), "sb_publishable_")
    || (validOpaqueKey(localPublishable, "sb_publishable_") ? localPublishable : "")
    || (legacyKeyHasRole(legacyPublishable, "anon") ? legacyPublishable : "");
  const secretKey = valueFromCollection(read("SUPABASE_SECRET_KEYS"), "sb_secret_")
    || (validOpaqueKey(localSecret, "sb_secret_") ? localSecret : "")
    || (legacyKeyHasRole(legacySecret, "service_role") ? legacySecret : "");

  return {
    projectUrl: environmentValue(read, "SUPABASE_URL"),
    publishableKey,
    secretKey,
  };
}

export function opaqueSecretFetch(secretKey: string, baseFetch: FetchImplementation = fetch): FetchImplementation {
  return async (input, init) => {
    const headers = new Headers((init as { headers?: HeadersInit } | undefined)?.headers);
    if (headers.get("authorization") === `Bearer ${secretKey}`) headers.delete("authorization");
    headers.set("apikey", secretKey);
    return baseFetch(input, { ...init, headers });
  };
}

export function createAdminClient(projectUrl: string, secretKey: string) {
  return createClient(projectUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(secretKey.startsWith("sb_secret_") ? { global: { fetch: opaqueSecretFetch(secretKey) } } : {}),
  });
}
