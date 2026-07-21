import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectIosPrivacyManifest } from "./check-ios-privacy.mjs";
import {
  readNativeProductionEnvironmentFiles,
  validateNativeGuestBuildInputs,
} from "./native-guest-boundary.mjs";

export const disclosurePath = "store-disclosures/native-local-guest.json";
export const privacyPolicyUrl = "https://thedudeb.github.io/Outflow/?view=privacy";
export const privacyPolicyVersion = "2026-07-21";

const expectedCapabilities = {
  accounts: false,
  hostedSync: false,
  hostedEmail: false,
  hostedCalendar: false,
  payments: false,
  analytics: false,
  advertising: false,
  tracking: false,
  bankConnections: false,
  storeManagedUpdates: true,
};

const expectedReviewTriggers = [
  "account or hosted-service configuration",
  "analytics, advertising, or tracking code",
  "app permission or entitlement changes",
  "data export or notification behavior changes",
  "new native or webview network destinations",
  "new third-party libraries or SDKs",
  "privacy policy or release version changes",
];

const expectedSources = {
  appleAppPrivacy: "https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy",
  appleReviewGuidelines: "https://developer.apple.com/app-store/review/guidelines/",
  googlePlayDataSafety: "https://support.google.com/googleplay/android-developer/answer/10787469",
  googlePlayFinancialFeatures: "https://support.google.com/googleplay/android-developer/answer/13849271",
  googlePlayInAppUpdates: "https://developer.android.com/guide/playcore/in-app-updates",
};

const expectedFinancialDescription = "Local subscription and recurring-charge tracking only; no bank connection, payment execution, lending, financial advice, investing, insurance, credit reporting, or money transfer.";

function same(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected);
}

function exactKeys(value, expected) {
  return value && !Array.isArray(value) && typeof value === "object"
    && same(Object.keys(value).sort(), [...expected].sort());
}

export function validateNativeStoreDisclosures(value, expectedApp = {}) {
  const errors = [];
  if (!exactKeys(value, [
    "schemaVersion", "releaseBoundary", "effectiveDate", "operatorStatus",
    "submissionRequiresCandidateReview", "app", "privacy", "sourceEvidence", "releaseCapabilities",
    "apple", "googlePlay", "reviewTriggers", "sources",
  ])) return ["native store disclosures: top-level shape changed."];

  if (value.schemaVersion !== 1) errors.push("native store disclosures: schema version must remain 1.");
  if (value.releaseBoundary !== "native-local-guest") errors.push("native store disclosures: release boundary must remain local guest.");
  if (value.effectiveDate !== privacyPolicyVersion) errors.push("native store disclosures: effective date must match the privacy policy version.");
  if (value.operatorStatus !== "draft-not-submitted") errors.push("native store disclosures: repository evidence must not claim store submission.");
  if (value.submissionRequiresCandidateReview !== true) errors.push("native store disclosures: candidate review must remain required.");

  if (!exactKeys(value.app, ["name", "version", "identifier"])) {
    errors.push("native store disclosures: app identity shape changed.");
  } else {
    if (value.app.name !== (expectedApp.name || "Outflow")) errors.push("native store disclosures: app name does not match the release configuration.");
    if (value.app.version !== expectedApp.version) errors.push("native store disclosures: app version does not match package.json.");
    if (value.app.identifier !== expectedApp.identifier) errors.push("native store disclosures: app identifier does not match Tauri.");
  }

  if (!exactKeys(value.privacy, ["policyVersion", "policyUrl", "privacyChoicesUrl"])) {
    errors.push("native store disclosures: privacy-link shape changed.");
  } else {
    if (value.privacy.policyVersion !== privacyPolicyVersion) errors.push("native store disclosures: policy version changed.");
    if (value.privacy.policyUrl !== privacyPolicyUrl) errors.push("native store disclosures: privacy policy URL changed.");
    if (value.privacy.privacyChoicesUrl !== privacyPolicyUrl) errors.push("native store disclosures: privacy choices URL changed.");
  }

  if (!exactKeys(value.sourceEvidence, [
    "dependencyLockSha256", "androidGradleSha256", "iosPrivacyManifestSha256", "androidManifestSha256", "androidNetworkSecuritySha256",
  ]) || Object.values(value.sourceEvidence || {}).some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
    errors.push("native store disclosures: source evidence must contain the five exact SHA-256 pins.");
  }

  if (!same(value.releaseCapabilities, expectedCapabilities)) errors.push("native store disclosures: guest release capabilities changed.");

  if (!exactKeys(value.apple, ["appPrivacy"])
    || !exactKeys(value.apple?.appPrivacy, ["response", "collectsData", "dataTypes", "tracking"])) {
    errors.push("native store disclosures: Apple App Privacy shape changed.");
  } else {
    if (value.apple.appPrivacy.response !== "No, we do not collect data from this app") errors.push("native store disclosures: Apple collection response changed.");
    if (value.apple.appPrivacy.collectsData !== false) errors.push("native store disclosures: Apple guest response must declare no collection.");
    if (!same(value.apple.appPrivacy.dataTypes, [])) errors.push("native store disclosures: Apple guest data-type list must be empty.");
    if (value.apple.appPrivacy.tracking !== false) errors.push("native store disclosures: Apple tracking must remain false.");
  }

  const dataSafety = value.googlePlay?.dataSafety;
  const financial = value.googlePlay?.financialFeatures;
  if (!exactKeys(value.googlePlay, ["dataSafety", "financialFeatures"])
    || !exactKeys(dataSafety, [
      "collectsOrSharesRequiredUserData", "dataTypes", "dataShared", "accountCreationAvailable",
      "independentSecurityReview", "familiesPolicyBadge",
    ])) {
    errors.push("native store disclosures: Google Play Data safety shape changed.");
  } else {
    if (dataSafety.collectsOrSharesRequiredUserData !== false) errors.push("native store disclosures: Play guest response must declare no collection or sharing.");
    if (!same(dataSafety.dataTypes, [])) errors.push("native store disclosures: Play guest data-type list must be empty.");
    if (dataSafety.dataShared !== false) errors.push("native store disclosures: Play guest data sharing must remain false.");
    if (dataSafety.accountCreationAvailable !== false) errors.push("native store disclosures: the native guest candidate must not claim account creation.");
    if (dataSafety.independentSecurityReview !== false) errors.push("native store disclosures: an independent security review must not be claimed.");
    if (dataSafety.familiesPolicyBadge !== false) errors.push("native store disclosures: a Families badge must not be claimed.");
  }
  if (!exactKeys(financial, ["selections", "description"])) {
    errors.push("native store disclosures: Google Play financial-features shape changed.");
  } else {
    if (!same(financial.selections, ["Other"])) errors.push("native store disclosures: Play financial feature must remain Other for subscription expense tracking.");
    if (financial.description !== expectedFinancialDescription) errors.push("native store disclosures: Play financial-feature boundary changed.");
  }

  if (!same(value.reviewTriggers, expectedReviewTriggers)) errors.push("native store disclosures: candidate review triggers changed.");
  if (!same(value.sources, expectedSources)) errors.push("native store disclosures: authoritative source inventory changed.");
  return errors;
}

function activeAndroidPermissions(manifest) {
  return [...String(manifest).matchAll(/<uses-permission\b([^>]+)\/>/g)]
    .filter(([, attributes]) => !/tools:node="remove"/.test(attributes))
    .map(([, attributes]) => attributes.match(/android:name="([^"]+)"/)?.[1])
    .filter(Boolean)
    .sort();
}

export function inspectNativeStoreDisclosureSources(cwd = process.cwd(), env = process.env) {
  const errors = [];
  const read = (path) => readFileSync(resolve(cwd, path), "utf8");
  const path = resolve(cwd, disclosurePath);
  if (!existsSync(path)) return [`native store disclosures: missing at ${path}.`];
  if (statSync(path).size < 1_000 || statSync(path).size > 20_000) return ["native store disclosures: file size is outside the accepted boundary."];

  let value;
  let packageJson;
  let tauri;
  try {
    value = JSON.parse(read(disclosurePath));
    packageJson = JSON.parse(read("package.json"));
    tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
  } catch {
    return ["native store disclosures: JSON source could not be parsed."];
  }
  errors.push(...validateNativeStoreDisclosures(value, {
    name: tauri.productName,
    version: packageJson.version,
    identifier: tauri.identifier,
  }));
  errors.push(...validateNativeGuestBuildInputs(env, readNativeProductionEnvironmentFiles(cwd)));

  const sha256 = (sourcePath) => createHash("sha256").update(readFileSync(resolve(cwd, sourcePath))).digest("hex");
  const sourceHashes = {
    dependencyLockSha256: sha256("package-lock.json"),
    androidGradleSha256: sha256("src-tauri/gen/android/app/build.gradle.kts"),
    iosPrivacyManifestSha256: sha256("src-tauri/PrivacyInfo.xcprivacy"),
    androidManifestSha256: sha256("src-tauri/gen/android/app/src/main/AndroidManifest.xml"),
    androidNetworkSecuritySha256: sha256("src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml"),
  };
  if (!same(value.sourceEvidence, sourceHashes)) errors.push("native store disclosures: pinned source evidence changed and requires candidate review.");

  const app = read("src/App.jsx");
  if (!app.includes(`const PRIVACY_POLICY_VERSION = "${privacyPolicyVersion}";`)) errors.push("native store disclosures: app policy version does not match.");
  if (!app.includes("No bank connections") || !app.includes("No ads or tracking") || !app.includes("No sale of personal data")) {
    errors.push("native store disclosures: public guest privacy summary changed.");
  }

  if (process.platform === "darwin") {
    const iosPrivacy = inspectIosPrivacyManifest(resolve(cwd, "src-tauri/PrivacyInfo.xcprivacy"));
    if (!iosPrivacy.valid) errors.push("native store disclosures: iOS privacy manifest no longer matches the local guest boundary.");
  }

  const androidManifest = read("src-tauri/gen/android/app/src/main/AndroidManifest.xml");
  if (!same(activeAndroidPermissions(androidManifest), [
    "android.permission.INTERNET",
    "android.permission.POST_NOTIFICATIONS",
  ])) errors.push("native store disclosures: Android source permission boundary changed.");
  if (!/android:allowBackup="false"/.test(androidManifest)) errors.push("native store disclosures: Android backup boundary changed.");

  const androidNetwork = read("src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml");
  if (!/cleartextTrafficPermitted="false"/.test(androidNetwork)) errors.push("native store disclosures: Android production cleartext policy changed.");
  return errors;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const errors = inspectNativeStoreDisclosureSources();
  if (errors.length) {
    errors.forEach((error) => console.error(error));
    process.exitCode = 1;
  } else {
    console.log("Verified the draft iOS App Privacy and Google Play Data safety answers for the native local guest boundary");
  }
}
