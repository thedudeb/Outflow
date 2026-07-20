import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeCanonicalBase64,
  normalizeFingerprint,
  readCertificateFromPkcs12,
  readProvisioningProfile,
  validateCertificate,
  validateProvisioningProfile,
} from "./ios-release-lib.mjs";

function value(env, name) {
  return String(env[name] || "").trim();
}

function secretValue(env, name) {
  return String(env[name] || "");
}

export function validateIosReleaseEnvironment(env) {
  const errors = [];
  const expectedTeamId = value(env, "OUTFLOW_IOS_EXPECTED_TEAM_ID");
  const expectedFingerprint = normalizeFingerprint(env.OUTFLOW_IOS_EXPECTED_CERT_SHA256);
  const buildNumber = value(env, "OUTFLOW_IOS_BUILD_NUMBER");
  const password = secretValue(env, "IOS_CERTIFICATE_PASSWORD");
  if (!/^[A-Z0-9]{10}$/.test(expectedTeamId)) errors.push("OUTFLOW_IOS_EXPECTED_TEAM_ID: expected a 10-character Apple Team ID.");
  if (!/^[A-F0-9]{64}$/.test(expectedFingerprint)) errors.push("OUTFLOW_IOS_EXPECTED_CERT_SHA256: expected a 32-byte certificate fingerprint.");
  if (!/^[1-9][0-9]{0,17}$/.test(buildNumber)) errors.push("OUTFLOW_IOS_BUILD_NUMBER: expected a positive, bounded numeric build number.");
  if (password.length < 16 || password.length > 256) errors.push("IOS_CERTIFICATE_PASSWORD: expected 16 to 256 characters.");
  try {
    decodeCanonicalBase64(env.IOS_CERTIFICATE, { name: "IOS_CERTIFICATE", minimum: 1_000, maximum: 1024 * 1024 });
  } catch (error) {
    errors.push(error.message);
  }
  try {
    decodeCanonicalBase64(env.IOS_MOBILE_PROVISION, { name: "IOS_MOBILE_PROVISION", minimum: 1_000, maximum: 5 * 1024 * 1024 });
  } catch (error) {
    errors.push(error.message);
  }

  const expectedCommit = value(env, "OUTFLOW_IOS_EXPECTED_COMMIT");
  if (expectedCommit) {
    if (!/^[a-f0-9]{40}$/.test(expectedCommit)) errors.push("OUTFLOW_IOS_EXPECTED_COMMIT: expected an exact lowercase Git commit SHA.");
    if (value(env, "GITHUB_SHA") !== expectedCommit) errors.push("GITHUB_SHA: must match the pinned iOS release commit.");
    if (value(env, "GITHUB_REF") !== "refs/heads/main") errors.push("GITHUB_REF: production iOS signing acceptance must run from main.");
  }
  return { valid: errors.length === 0, errors, expectedTeamId, expectedFingerprint, buildNumber };
}

export function verifyIosReleaseEnvironment(env, options = {}) {
  const validation = validateIosReleaseEnvironment(env);
  if (!validation.valid) return validation;
  let inspected;
  try {
    if (options.inspectMaterials) {
      inspected = options.inspectMaterials(validation);
    } else {
      const directory = mkdtempSync(join(tmpdir(), "outflow-ios-signing-"));
      try {
        const certificatePath = join(directory, "distribution.p12");
        const profilePath = join(directory, "distribution.mobileprovision");
        writeFileSync(certificatePath, decodeCanonicalBase64(env.IOS_CERTIFICATE, {
          name: "IOS_CERTIFICATE", minimum: 1_000, maximum: 1024 * 1024,
        }), { mode: 0o600 });
        writeFileSync(profilePath, decodeCanonicalBase64(env.IOS_MOBILE_PROVISION, {
          name: "IOS_MOBILE_PROVISION", minimum: 1_000, maximum: 5 * 1024 * 1024,
        }), { mode: 0o600 });
        inspected = {
          certificate: readCertificateFromPkcs12(certificatePath, env, options),
          profile: readProvisioningProfile(profilePath, options),
        };
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  } catch {
    return { ...validation, valid: false, errors: ["iOS signing material: certificate or provisioning profile could not be inspected."] };
  }

  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const errors = [
    ...validateCertificate(inspected.certificate, validation.expectedTeamId, validation.expectedFingerprint, now),
    ...validateProvisioningProfile(inspected.profile, validation.expectedTeamId, validation.expectedFingerprint, {
      now,
      parseCertificate: options.parseProfileCertificate,
    }),
  ];
  return { ...validation, valid: errors.length === 0, errors };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = verifyIosReleaseEnvironment(process.env);
  if (!result.valid) {
    result.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
  } else {
    console.log("Validated the Outflow iOS distribution certificate, App Store profile, and exact-commit boundary");
  }
}
