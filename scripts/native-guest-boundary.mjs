import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnvFile } from "./check-service-readiness.mjs";

export const hostedBrowserNames = [
  "VITE_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL",
];

export const nativeProductionEnvironmentPaths = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
];

export function readNativeProductionEnvironmentFiles(cwd = process.cwd()) {
  return nativeProductionEnvironmentPaths
    .map((path) => resolve(cwd, path))
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, "utf8"));
}

export function validateNativeGuestBuildInputs(env, environmentFiles = []) {
  const configured = new Set();
  for (const name of hostedBrowserNames) {
    if (String(env?.[name] || "").trim()) configured.add(name);
  }
  for (const source of environmentFiles) {
    const parsed = parseEnvFile(String(source || ""));
    for (const name of hostedBrowserNames) {
      if (String(parsed[name] || "").trim()) configured.add(name);
    }
  }
  return [...configured]
    .sort()
    .map((name) => `${name}: hosted native configuration is not covered by the local guest store disclosures.`);
}
