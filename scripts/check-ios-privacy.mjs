import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPlist } from "./ios-release-lib.mjs";
import { parseEnvFile } from "./check-service-readiness.mjs";

const expectedRootKeys = [
  "NSPrivacyAccessedAPITypes",
  "NSPrivacyCollectedDataTypes",
  "NSPrivacyTracking",
  "NSPrivacyTrackingDomains",
];
const hostedBrowserNames = ["VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL"];

export function validateIosGuestBuildInputs(env, environmentFiles = []) {
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
  return [...configured].sort().map((name) => `${name}: hosted native configuration is not covered by the guest privacy manifest.`);
}

export function validateIosPrivacyManifest(manifest) {
  const errors = [];
  if (!manifest || Array.isArray(manifest) || typeof manifest !== "object") {
    return ["PrivacyInfo.xcprivacy: expected a property-list dictionary."];
  }
  const rootKeys = Object.keys(manifest).sort();
  if (JSON.stringify(rootKeys) !== JSON.stringify(expectedRootKeys)) {
    errors.push("PrivacyInfo.xcprivacy: root disclosure keys changed.");
  }
  if (manifest.NSPrivacyTracking !== false) errors.push("PrivacyInfo.xcprivacy: tracking must remain disabled.");
  if (!Array.isArray(manifest.NSPrivacyTrackingDomains) || manifest.NSPrivacyTrackingDomains.length !== 0) {
    errors.push("PrivacyInfo.xcprivacy: tracking domains must remain empty.");
  }
  if (!Array.isArray(manifest.NSPrivacyCollectedDataTypes) || manifest.NSPrivacyCollectedDataTypes.length !== 0) {
    errors.push("PrivacyInfo.xcprivacy: the local guest build must not declare off-device collection.");
  }

  const accessed = manifest.NSPrivacyAccessedAPITypes;
  if (!Array.isArray(accessed) || accessed.length !== 1) {
    errors.push("PrivacyInfo.xcprivacy: expected exactly one required-reason API category.");
  } else {
    const entry = accessed[0];
    if (!entry || Array.isArray(entry) || typeof entry !== "object"
      || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify([
        "NSPrivacyAccessedAPIType",
        "NSPrivacyAccessedAPITypeReasons",
      ])) {
      errors.push("PrivacyInfo.xcprivacy: required-reason entry shape changed.");
    }
    if (entry?.NSPrivacyAccessedAPIType !== "NSPrivacyAccessedAPICategoryFileTimestamp") {
      errors.push("PrivacyInfo.xcprivacy: required-reason category must match container file metadata access.");
    }
    if (!Array.isArray(entry?.NSPrivacyAccessedAPITypeReasons)
      || entry.NSPrivacyAccessedAPITypeReasons.length !== 1
      || entry.NSPrivacyAccessedAPITypeReasons[0] !== "C617.1") {
      errors.push("PrivacyInfo.xcprivacy: expected only Apple's C617.1 app-container reason.");
    }
  }
  return errors;
}

export function validateIosRequiredReasonSymbols(output) {
  const symbols = new Set(String(output || "")
    .split("\n")
    .map((line) => line.trim().split(/\s+/).at(-1))
    .filter(Boolean));
  const fileMetadata = [
    "_fgetattrlist", "_fstat", "_fstatat", "_getattrlist", "_getattrlistat", "_getattrlistbulk", "_lstat", "_stat",
  ];
  const errors = [];
  if (!fileMetadata.some((symbol) => symbols.has(symbol))) {
    errors.push("iOS executable: C617.1 file-metadata API use is no longer present.");
  }
  const undeclared = [
    ["system-boot-time", ["_mach_absolute_time"]],
    ["disk-space", ["_fstatfs", "_fstatvfs", "_statfs", "_statvfs"]],
    ["UserDefaults", [...symbols].filter((symbol) => symbol.includes("NSUserDefaults"))],
    ["active-keyboard", [...symbols].filter((symbol) => symbol.includes("activeInputModes"))],
  ];
  for (const [category, categorySymbols] of undeclared) {
    if (categorySymbols.some((symbol) => symbols.has(symbol))) {
      errors.push(`iOS executable: undeclared ${category} required-reason API use detected.`);
    }
  }
  return errors;
}

export function inspectIosPrivacyManifest(path, options = {}) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) return { valid: false, errors: [`PrivacyInfo.xcprivacy: missing at ${resolved}.`] };
  const size = statSync(resolved).size;
  if (size < 300 || size > 20_000) return { valid: false, errors: ["PrivacyInfo.xcprivacy: file size is outside the accepted boundary."] };
  try {
    const errors = validateIosPrivacyManifest(readPlist(resolved, options));
    return { valid: errors.length === 0, errors };
  } catch {
    return { valid: false, errors: ["PrivacyInfo.xcprivacy: property list could not be parsed."] };
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const sourcePath = process.env.OUTFLOW_IOS_PRIVACY_PATH || "src-tauri/PrivacyInfo.xcprivacy";
  const result = inspectIosPrivacyManifest(sourcePath);
  if (!result.valid) {
    result.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
  } else {
    console.log("Verified the Outflow iOS no-tracking guest privacy manifest and C617.1 container-file boundary");
  }
}
