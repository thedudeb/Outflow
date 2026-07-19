import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnvFile } from "./check-service-readiness.mjs";

const protectedFunctions = Object.freeze([
  { name: "delete-account", method: "POST", allowedMethods: ["POST", "OPTIONS"] },
  { name: "send-ledger-invite", method: "POST", allowedMethods: ["POST", "OPTIONS"] },
  { name: "create-pro-checkout", method: "GET", allowedMethods: ["GET", "POST", "OPTIONS"] },
]);

function legacyKeyHasRole(value, expectedRole) {
  try {
    const parts = value.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload?.role === expectedRole;
  } catch {
    return false;
  }
}

function namedPublishableKey(rawValue, errors) {
  if (!rawValue) return "";
  try {
    const values = JSON.parse(rawValue);
    const value = typeof values?.default === "string" ? values.default.trim() : "";
    if (!/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(value)) throw new Error("invalid");
    return value;
  } catch {
    errors.push("SUPABASE_PUBLISHABLE_KEYS: expected a JSON object containing a valid default key.");
    return "";
  }
}

export function resolvePublicStagingConfig(env) {
  const errors = [];
  const serverUrl = String(env.SUPABASE_URL || "").trim();
  const browserUrl = String(env.VITE_SUPABASE_URL || "").trim();
  const projectUrl = serverUrl || browserUrl;
  const namedKey = namedPublishableKey(String(env.SUPABASE_PUBLISHABLE_KEYS || "").trim(), errors);
  const localKey = String(env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  const browserKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
  const legacyKey = String(env.SUPABASE_ANON_KEY || "").trim();
  if (localKey && !/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(localKey)) {
    errors.push("SUPABASE_PUBLISHABLE_KEY: expected a Supabase publishable key.");
  }
  if (browserKey && !/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(browserKey)) {
    errors.push("VITE_SUPABASE_PUBLISHABLE_KEY: expected a Supabase publishable key.");
  }
  if (legacyKey && !legacyKeyHasRole(legacyKey, "anon")) {
    errors.push("SUPABASE_ANON_KEY: expected a legacy JWT with the anon role.");
  }
  const publishableKey = namedKey || localKey || browserKey || legacyKey;
  if (!publishableKey) errors.push("Supabase publishable credentials are required for the staging probe.");
  if (browserKey && publishableKey && browserKey !== publishableKey) {
    errors.push("VITE_SUPABASE_PUBLISHABLE_KEY: must match the resolved publishable key.");
  }
  if (serverUrl && browserUrl && serverUrl !== browserUrl) {
    errors.push("VITE_SUPABASE_URL: must match SUPABASE_URL.");
  }

  try {
    const url = new URL(projectUrl);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") || url.origin !== projectUrl) throw new Error("invalid");
  } catch {
    errors.push("SUPABASE_URL: expected an exact HTTPS project origin on supabase.co.");
  }

  let appOrigin = "";
  try {
    const appUrl = new URL(String(env.OUTFLOW_APP_URL || "").trim());
    if (appUrl.protocol !== "https:" || appUrl.username || appUrl.password || appUrl.search || appUrl.hash) throw new Error("invalid");
    appOrigin = appUrl.origin;
  } catch {
    errors.push("OUTFLOW_APP_URL: expected the staging application's HTTPS URL.");
  }
  const allowedOrigins = String(env.OUTFLOW_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (allowedOrigins.includes("*")) errors.push("OUTFLOW_ALLOWED_ORIGINS: wildcard origins are forbidden.");
  for (const origin of allowedOrigins) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.origin !== origin) throw new Error("invalid");
    } catch {
      errors.push("OUTFLOW_ALLOWED_ORIGINS: every entry must be an exact HTTPS origin.");
      break;
    }
  }
  if (appOrigin && allowedOrigins.length && !allowedOrigins.includes(appOrigin)) {
    errors.push("OUTFLOW_ALLOWED_ORIGINS: must include the staging application origin.");
  }

  return { errors, projectUrl, publishableKey, appOrigin };
}

function includesHeaderToken(value, expected) {
  return String(value || "").split(",").map((token) => token.trim().toLowerCase()).includes(expected.toLowerCase());
}

function includesMethod(value, expected) {
  return String(value || "").split(",").map((method) => method.trim().toUpperCase()).includes(expected);
}

export async function probeStagingBoundaries({ projectUrl, publishableKey, appOrigin, fetchImpl = fetch, timeoutMs = 10_000 }) {
  const completed = [];
  const request = async (name, path, init, expectedStatus, validate = () => {}) => {
    let response;
    try {
      response = await fetchImpl(`${projectUrl}/functions/v1/${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error(`${name}: request failed.`);
    }
    if (response.status !== expectedStatus) {
      await response.body?.cancel();
      throw new Error(`${name}: expected HTTP ${expectedStatus}, received ${response.status}.`);
    }
    try {
      validate(response);
    } finally {
      await response.body?.cancel();
    }
    completed.push(name);
  };

  for (const boundary of protectedFunctions) {
    await request(`${boundary.name} CORS`, boundary.name, {
      method: "OPTIONS",
      headers: { apikey: publishableKey, Origin: appOrigin },
    }, 204, (response) => {
      if (response.headers.get("access-control-allow-origin") !== appOrigin) throw new Error(`${boundary.name} CORS: exact origin was not returned.`);
      if (!includesHeaderToken(response.headers.get("vary"), "origin")) throw new Error(`${boundary.name} CORS: Vary must include Origin.`);
      const headers = response.headers.get("access-control-allow-headers");
      if (!["authorization", "apikey", "content-type", "x-client-info"].every((header) => includesHeaderToken(headers, header))) {
        throw new Error(`${boundary.name} CORS: allowed headers are incomplete.`);
      }
      const methods = response.headers.get("access-control-allow-methods");
      if (!boundary.allowedMethods.every((method) => includesMethod(methods, method))) throw new Error(`${boundary.name} CORS: allowed methods are incomplete.`);
    });
    await request(`${boundary.name} JWT`, boundary.name, {
      method: boundary.method,
      headers: {
        apikey: publishableKey,
        Authorization: "Bearer invalid.outflow.staging-probe",
        Origin: appOrigin,
        ...(boundary.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(boundary.method === "POST" ? { body: "{}" } : {}),
    }, 401);
  }

  await request("stripe-webhook signature", "stripe-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": "t=1,v1=invalid-outflow-probe" },
    body: "{}",
  }, 400, (response) => {
    if (response.headers.get("cache-control") !== "no-store") throw new Error("stripe-webhook signature: Outflow response headers were not returned.");
  });
  await request("send-due-reminders cron secret", "send-due-reminders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer invalid-outflow-cron-secret-value" },
    body: "{}",
  }, 401, (response) => {
    if (response.headers.get("cache-control") !== "no-store") throw new Error("send-due-reminders cron secret: Outflow response headers were not returned.");
  });
  await request("calendar-feed private token", `calendar-feed?token=${"A".repeat(43)}`, { method: "GET" }, 404, (response) => {
    if (
      response.headers.get("cache-control") !== "no-store"
      || response.headers.get("referrer-policy") !== "no-referrer"
      || response.headers.get("x-content-type-options") !== "nosniff"
    ) throw new Error("calendar-feed private token: Outflow privacy headers were not returned.");
  });

  return completed;
}

async function main() {
  const args = process.argv.slice(2);
  const envFileIndex = args.indexOf("--env-file");
  const file = envFileIndex >= 0 ? args[envFileIndex + 1] : "";
  if (!file) {
    console.error("- --env-file: expected a path to an ignored staging environment file.");
    process.exitCode = 1;
    return;
  }
  const env = parseEnvFile(await readFile(resolve(process.cwd(), file), "utf8"));
  const config = resolvePublicStagingConfig(env);
  if (config.errors.length) {
    for (const error of config.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  try {
    const completed = await probeStagingBoundaries(config);
    console.log(`Staging boundary probe passed: ${completed.length} non-destructive checks across 6 functions.`);
  } catch (error) {
    console.error(`- ${error instanceof Error ? error.message : "Staging boundary probe failed."}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
