import { createClient } from "@supabase/supabase-js";

export function opaqueSecretFetch(secretKey, baseFetch = fetch) {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.get("authorization") === `Bearer ${secretKey}`) headers.delete("authorization");
    headers.set("apikey", secretKey);
    return baseFetch(input, { ...init, headers });
  };
}

export function createAcceptanceClient(projectUrl, key, options = {}, createClientImpl = createClient) {
  const global = { ...options.global };
  if (key.startsWith("sb_secret_")) {
    global.fetch = opaqueSecretFetch(key, global.fetch || fetch);
  }
  return createClientImpl(projectUrl, key, {
    ...options,
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
      ...options.auth,
    },
    ...(Object.keys(global).length ? { global } : {}),
  });
}
