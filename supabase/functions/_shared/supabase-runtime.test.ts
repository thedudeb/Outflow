import { type FetchImplementation, opaqueSecretFetch, resolveSupabaseRuntime } from "./supabase-runtime.ts";

function assertEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

function reader(values: Record<string, string>) {
  return (name: string) => values[name];
}

function legacyKey(role: string) {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.test-signature`;
}

Deno.test("hosted named key collections take precedence over local and legacy fallbacks", () => {
  const publishableKey = `sb_publishable_${"p".repeat(24)}`;
  const secretKey = `sb_secret_${"s".repeat(24)}`;
  assertEqual(resolveSupabaseRuntime(reader({
    SUPABASE_URL: "https://outflow-stage.supabase.co",
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: publishableKey }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: secretKey }),
    SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"l".repeat(24)}`,
    SUPABASE_SECRET_KEY: `sb_secret_${"l".repeat(24)}`,
  })), {
    projectUrl: "https://outflow-stage.supabase.co",
    publishableKey,
    secretKey,
  });
});

Deno.test("malformed hosted collections fail over to local then legacy keys", () => {
  const publishableKey = `sb_publishable_${"l".repeat(24)}`;
  const secretKey = legacyKey("service_role");
  assertEqual(resolveSupabaseRuntime(reader({
    SUPABASE_URL: " https://local.example.test ",
    SUPABASE_PUBLISHABLE_KEYS: "not-json",
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "wrong-prefix" }),
    SUPABASE_PUBLISHABLE_KEY: ` ${publishableKey} `,
    SUPABASE_SERVICE_ROLE_KEY: ` ${secretKey} `,
  })), {
    projectUrl: "https://local.example.test",
    publishableKey,
    secretKey,
  });
});

Deno.test("malformed local keys and swapped legacy roles fail closed", () => {
  assertEqual(resolveSupabaseRuntime(reader({
    SUPABASE_URL: "https://outflow-stage.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "not-a-publishable-key",
    SUPABASE_SECRET_KEY: "not-a-secret-key",
    SUPABASE_ANON_KEY: legacyKey("service_role"),
    SUPABASE_SERVICE_ROLE_KEY: legacyKey("anon"),
  })), {
    projectUrl: "https://outflow-stage.supabase.co",
    publishableKey: "",
    secretKey: "",
  });
});

Deno.test("opaque secret fetch keeps the secret out of the bearer header", async () => {
  const secretKey = `sb_secret_${"s".repeat(24)}`;
  let receivedHeaders = new Headers();
  const baseFetch: FetchImplementation = (_input, init) => {
    receivedHeaders = new Headers((init as { headers?: HeadersInit } | undefined)?.headers);
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const secureFetch = opaqueSecretFetch(secretKey, baseFetch);

  await secureFetch("https://outflow-stage.supabase.co/rest/v1/ledgers", {
    headers: { Authorization: `Bearer ${secretKey}`, "X-Outflow-Test": "preserved" },
  });
  assertEqual(receivedHeaders.get("authorization"), null);
  assertEqual(receivedHeaders.get("apikey"), secretKey);
  assertEqual(receivedHeaders.get("x-outflow-test"), "preserved");

  await secureFetch("https://outflow-stage.supabase.co/auth/v1/user", {
    headers: { Authorization: "Bearer a-user-session" },
  });
  assertEqual(receivedHeaders.get("authorization"), "Bearer a-user-session");
  assertEqual(receivedHeaders.get("apikey"), secretKey);
});
