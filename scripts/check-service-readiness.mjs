import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const FUNCTION_POLICIES = Object.freeze({
  "delete-account": { verifyJwt: true, supabase: ["publishable", "secret"], env: ["SUPABASE_URL", "OUTFLOW_ALLOWED_ORIGINS"] },
  "send-ledger-invite": { verifyJwt: true, supabase: ["publishable", "secret"], env: ["SUPABASE_URL", "RESEND_API_KEY", "OUTFLOW_ALLOWED_ORIGINS", "OUTFLOW_APP_URL", "OUTFLOW_INVITE_FROM"] },
  "create-pro-checkout": { verifyJwt: true, supabase: ["publishable"], env: ["SUPABASE_URL", "STRIPE_SECRET_KEY", "STRIPE_PRO_PRICE_ID", "OUTFLOW_ALLOWED_ORIGINS", "OUTFLOW_APP_URL"] },
  "stripe-webhook": { verifyJwt: false, supabase: ["secret"], env: ["SUPABASE_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRO_PRICE_ID"] },
  "send-due-reminders": { verifyJwt: false, supabase: ["secret"], env: ["SUPABASE_URL", "RESEND_API_KEY", "OUTFLOW_CRON_SECRET", "OUTFLOW_REMINDER_FROM", "OUTFLOW_APP_URL"] },
  "resend-webhook": { verifyJwt: false, supabase: ["secret"], env: ["SUPABASE_URL", "RESEND_WEBHOOK_SECRET"] },
  "calendar-feed": { verifyJwt: false, supabase: ["secret"], env: ["SUPABASE_URL"] },
});

const supabaseKeyModes = Object.freeze({
  publishable: ["SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"],
  secret: ["SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
});
const browserKeys = new Set(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
const serverKeyPattern = /(SECRET|SERVICE_ROLE|STRIPE|RESEND|WEBHOOK|CRON)/;
const allowedEnvAliases = new Set(Object.values(supabaseKeyModes).flat());

export function parseEnvFile(source) {
  const env = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    env[match[1]] = value;
  }
  return env;
}

function parseFunctionConfig(source) {
  const policies = new Map();
  let current = "";
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const section = line.match(/^\[functions\.([a-z0-9-]+)]$/);
    if (section) {
      current = section[1];
      continue;
    }
    const jwt = line.match(/^verify_jwt\s*=\s*(true|false)$/);
    if (jwt && current) policies.set(current, jwt[1] === "true");
  }
  return policies;
}

function envNamesFromSource(source) {
  return [
    ...source.matchAll(/(?:Deno\.env\.get|read)\(["']([A-Z0-9_]+)["']\)/g),
    ...source.matchAll(/environmentValue\(read,\s*["']([A-Z0-9_]+)["']\)/g),
  ].map((match) => match[1]);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export async function validateRepository(root = process.cwd()) {
  const errors = [];
  const functionRoot = resolve(root, "supabase/functions");
  const functionNames = (await readdir(functionRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
  const expectedFunctions = Object.keys(FUNCTION_POLICIES).sort();
  if (JSON.stringify(functionNames) !== JSON.stringify(expectedFunctions)) {
    errors.push(`Edge Function inventory must be exactly: ${expectedFunctions.join(", ")}.`);
  }

  const configSource = await readFile(resolve(root, "supabase/config.toml"), "utf8");
  const configuredPolicies = parseFunctionConfig(configSource);
  for (const [name, policy] of Object.entries(FUNCTION_POLICIES)) {
    if (!configuredPolicies.has(name)) errors.push(`${name}: verify_jwt must be explicit in supabase/config.toml.`);
    else if (configuredPolicies.get(name) !== policy.verifyJwt) errors.push(`${name}: verify_jwt must be ${policy.verifyJwt}.`);
  }
  for (const name of configuredPolicies.keys()) {
    if (!FUNCTION_POLICIES[name]) errors.push(`${name}: config has no matching function policy.`);
  }

  const functionExample = parseEnvFile(await readFile(resolve(functionRoot, ".env.example"), "utf8"));
  const browserExample = parseEnvFile(await readFile(resolve(root, ".env.example"), "utf8"));
  for (const key of Object.keys(browserExample)) {
    if (!browserKeys.has(key)) errors.push(`${key}: browser example contains an unsupported public variable.`);
    if (serverKeyPattern.test(key)) errors.push(`${key}: server credentials must never use the VITE_ prefix.`);
  }
  for (const key of browserKeys) {
    if (!(key in browserExample)) errors.push(`${key}: browser example is missing this required value.`);
  }
  for (const key of uniqueSorted(Object.values(FUNCTION_POLICIES).flatMap((policy) => policy.env))) {
    if (!(key in functionExample)) errors.push(`${key}: function environment example is missing this required value.`);
  }
  for (const key of ["SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_SECRET_KEYS"]) {
    if (!(key in functionExample)) errors.push(`${key}: function environment example must document the hosted key collection.`);
  }
  for (const key of Object.keys(functionExample)) {
    if (key.startsWith("VITE_")) errors.push(`${key}: server function example must not contain browser variables.`);
  }

  const sharedSource = await readFile(resolve(functionRoot, "_shared/supabase-runtime.ts"), "utf8");
  for (const key of allowedEnvAliases) {
    if (!envNamesFromSource(sharedSource).includes(key)) errors.push(`Shared Supabase runtime does not read ${key}.`);
  }
  for (const name of expectedFunctions) {
    const source = await readFile(resolve(functionRoot, name, "index.ts"), "utf8");
    const completeSource = `${source}\n${sharedSource}`;
    const environmentReads = envNamesFromSource(completeSource);
    if (FUNCTION_POLICIES[name].supabase.length && !source.includes("../_shared/supabase-runtime.ts")) {
      errors.push(`${name}: must use the shared Supabase runtime boundary.`);
    }
    for (const key of environmentReads) {
      if (!(key in functionExample) && !allowedEnvAliases.has(key)) errors.push(`${name}: ${key} is undocumented.`);
    }
    for (const key of FUNCTION_POLICIES[name].env) {
      if (!environmentReads.includes(key)) {
        errors.push(`${name}: declared environment value ${key} is not read by the function.`);
      }
    }
  }

  const migrations = (await readdir(resolve(root, "supabase/migrations")))
    .filter((name) => name.endsWith(".sql"));
  if (!migrations.length) errors.push("At least one database migration is required.");
  if (migrations.some((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name))) {
    errors.push("Every migration must use a 14-digit timestamp and snake_case name.");
  }
  if (new Set(migrations.map((name) => name.slice(0, 14))).size !== migrations.length) {
    errors.push("Migration timestamps must be unique.");
  }

  return {
    errors,
    functionCount: functionNames.length,
    migrationCount: migrations.length,
    jwtProtectedCount: Object.values(FUNCTION_POLICIES).filter((policy) => policy.verifyJwt).length,
    publicBoundaryCount: Object.values(FUNCTION_POLICIES).filter((policy) => !policy.verifyJwt).length,
  };
}

function required(env, name, errors) {
  const value = String(env[name] || "").trim();
  if (!value) errors.push(`${name}: required value is missing.`);
  return value;
}

function validUrl(value, { allowLocal = false } = {}) {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    return !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === "https:" || (allowLocal && local && url.protocol === "http:"));
  } catch {
    return false;
  }
}

function namedSupabaseKey(env, name, prefix, errors) {
  const rawValue = String(env[name] || "").trim();
  if (!rawValue) return "";
  try {
    const values = JSON.parse(rawValue);
    const value = typeof values?.default === "string" ? values.default.trim() : "";
    if (!value.startsWith(prefix) || value.length < prefix.length + 16 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid");
    return value;
  } catch {
    errors.push(`${name}: expected a JSON object containing a valid default key.`);
    return "";
  }
}

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

export function resolveSupabaseKeys(env, errors = []) {
  const namedPublishable = namedSupabaseKey(env, "SUPABASE_PUBLISHABLE_KEYS", "sb_publishable_", errors);
  const namedSecret = namedSupabaseKey(env, "SUPABASE_SECRET_KEYS", "sb_secret_", errors);
  const localPublishable = String(env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  const localSecret = String(env.SUPABASE_SECRET_KEY || "").trim();
  const legacyPublishable = String(env.SUPABASE_ANON_KEY || "").trim();
  const legacySecret = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (localPublishable && !/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(localPublishable)) {
    errors.push("SUPABASE_PUBLISHABLE_KEY: expected a Supabase publishable key.");
  }
  if (localSecret && !/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(localSecret)) {
    errors.push("SUPABASE_SECRET_KEY: expected a Supabase secret key.");
  }
  if (legacyPublishable && !legacyKeyHasRole(legacyPublishable, "anon")) {
    errors.push("SUPABASE_ANON_KEY: expected a legacy JWT with the anon role.");
  }
  if (legacySecret && !legacyKeyHasRole(legacySecret, "service_role")) {
    errors.push("SUPABASE_SERVICE_ROLE_KEY: expected a legacy JWT with the service_role role.");
  }

  const publishableKey = namedPublishable || localPublishable || legacyPublishable;
  const secretKey = namedSecret || localSecret || legacySecret;
  if (!publishableKey) errors.push("Supabase publishable credentials: one hosted, local, or legacy key mode is required.");
  if (!secretKey) errors.push("Supabase secret credentials: one hosted, local, or legacy key mode is required.");
  if (publishableKey && secretKey && publishableKey === secretKey) errors.push("Supabase secret credentials must differ from publishable credentials.");
  return { publishableKey, secretKey };
}

export function validateServiceEnvironment(env, { allowLocal = false } = {}) {
  const errors = [];
  const values = {};
  for (const name of uniqueSorted(Object.values(FUNCTION_POLICIES).flatMap((policy) => policy.env))) {
    values[name] = required(env, name, errors);
  }
  const { publishableKey } = resolveSupabaseKeys(env, errors);

  if (values.SUPABASE_URL && (!validUrl(values.SUPABASE_URL) || !new URL(values.SUPABASE_URL).hostname.endsWith(".supabase.co") || new URL(values.SUPABASE_URL).origin !== values.SUPABASE_URL)) {
    errors.push("SUPABASE_URL: expected an exact HTTPS project origin on supabase.co.");
  }
  if (values.RESEND_API_KEY && !/^re_[A-Za-z0-9_-]{16,}$/.test(values.RESEND_API_KEY)) errors.push("RESEND_API_KEY: expected a Resend API key.");
  if (values.RESEND_WEBHOOK_SECRET && !/^whsec_[A-Za-z0-9+/_=-]{16,}$/.test(values.RESEND_WEBHOOK_SECRET)) errors.push("RESEND_WEBHOOK_SECRET: expected a Resend webhook signing secret.");
  if (values.STRIPE_SECRET_KEY && !/^sk_(test|live)_[A-Za-z0-9]{16,}$/.test(values.STRIPE_SECRET_KEY)) errors.push("STRIPE_SECRET_KEY: expected a Stripe secret key.");
  if (values.STRIPE_WEBHOOK_SECRET && !/^whsec_[A-Za-z0-9]{16,}$/.test(values.STRIPE_WEBHOOK_SECRET)) errors.push("STRIPE_WEBHOOK_SECRET: expected a Stripe webhook signing secret.");
  if (values.STRIPE_PRO_PRICE_ID && !/^price_[A-Za-z0-9]{8,}$/.test(values.STRIPE_PRO_PRICE_ID)) errors.push("STRIPE_PRO_PRICE_ID: expected a Stripe Price ID.");
  if (values.OUTFLOW_CRON_SECRET && (values.OUTFLOW_CRON_SECRET.length < 32 || /\s/.test(values.OUTFLOW_CRON_SECRET) || new Set(values.OUTFLOW_CRON_SECRET).size < 12)) {
    errors.push("OUTFLOW_CRON_SECRET: expected at least 32 high-entropy, whitespace-free characters.");
  }

  const appUrl = values.OUTFLOW_APP_URL;
  if (appUrl && !validUrl(appUrl, { allowLocal })) errors.push("OUTFLOW_APP_URL: expected an HTTPS URL without credentials, query, or fragment.");
  const origins = values.OUTFLOW_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean);
  if (!origins.length) errors.push("OUTFLOW_ALLOWED_ORIGINS: expected at least one exact origin.");
  if (origins.includes("*")) errors.push("OUTFLOW_ALLOWED_ORIGINS: wildcard origins are forbidden.");
  for (const origin of origins) {
    if (!validUrl(origin, { allowLocal }) || new URL(origin).origin !== origin) {
      errors.push("OUTFLOW_ALLOWED_ORIGINS: every entry must be an exact HTTPS origin without a path.");
      break;
    }
  }
  if (appUrl && validUrl(appUrl, { allowLocal }) && !origins.includes(new URL(appUrl).origin)) {
    errors.push("OUTFLOW_ALLOWED_ORIGINS: must include the application origin.");
  }

  for (const name of ["OUTFLOW_INVITE_FROM", "OUTFLOW_REMINDER_FROM"]) {
    if (values[name] && !/^[^<>\r\n]{1,80}\s<[^@\s<>]+@[^@\s<>]+>$/.test(values[name])) {
      errors.push(`${name}: expected a named sender in the form Outflow <name@example.com>.`);
    }
  }

  for (const key of Object.keys(env)) {
    if (key.startsWith("VITE_") && serverKeyPattern.test(key)) errors.push(`${key}: server credentials must never use the VITE_ prefix.`);
  }
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_URL !== values.SUPABASE_URL) errors.push("VITE_SUPABASE_URL: must match SUPABASE_URL when provided together.");
  if (env.VITE_SUPABASE_PUBLISHABLE_KEY && env.VITE_SUPABASE_PUBLISHABLE_KEY !== publishableKey) {
    errors.push("VITE_SUPABASE_PUBLISHABLE_KEY: must match the resolved Supabase publishable key when provided together.");
  }

  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  const envFileIndex = args.indexOf("--env-file");
  const repository = await validateRepository(process.cwd());
  const errors = [...repository.errors];
  if (envFileIndex >= 0) {
    const file = args[envFileIndex + 1];
    if (!file) errors.push("--env-file: expected a path.");
    else {
      const env = parseEnvFile(await readFile(resolve(process.cwd(), file), "utf8"));
      errors.push(...validateServiceEnvironment(env, { allowLocal: args.includes("--allow-local") }));
    }
  }
  if (errors.length) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Service readiness passed: ${repository.functionCount} functions (${repository.jwtProtectedCount} JWT / ${repository.publicBoundaryCount} independently authenticated), ${repository.migrationCount} migrations.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
