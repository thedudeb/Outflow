import { existsSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiNames = ["APPLE_API_KEY", "APPLE_API_ISSUER", "APPLE_API_KEY_PATH"];
const appleIdNames = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"];

function value(env, name) {
  return String(env[name] || "").trim();
}

export function validateMacosReleaseEnvironment(env, options = {}) {
  const root = resolve(options.root || process.cwd());
  const inspectPath = options.inspectPath || ((path) => {
    const resolved = resolve(path);
    if (!existsSync(resolved)) return { exists: false, file: false, mode: 0, size: 0, path: resolved };
    const stats = statSync(resolved);
    return { exists: true, file: stats.isFile(), mode: stats.mode, size: stats.size, path: resolved };
  });
  const errors = [];
  const identity = value(env, "APPLE_SIGNING_IDENTITY");
  const expectedTeamId = value(env, "OUTFLOW_MACOS_EXPECTED_TEAM_ID");
  const identityTeamId = identity.match(/^Developer ID Application: .+ \(([A-Z0-9]{10})\)$/)?.[1] || "";

  if (!identityTeamId) errors.push("APPLE_SIGNING_IDENTITY: expected a canonical Developer ID Application identity.");
  if (!/^[A-Z0-9]{10}$/.test(expectedTeamId)) errors.push("OUTFLOW_MACOS_EXPECTED_TEAM_ID: expected a 10-character Apple Team ID.");
  if (identityTeamId && expectedTeamId && identityTeamId !== expectedTeamId) {
    errors.push("APPLE_SIGNING_IDENTITY: certificate Team ID must match the pinned expected Team ID.");
  }

  const certificate = value(env, "APPLE_CERTIFICATE");
  const certificatePassword = value(env, "APPLE_CERTIFICATE_PASSWORD");
  const requireCertificate = value(env, "OUTFLOW_MACOS_REQUIRE_CERTIFICATE");
  if (requireCertificate && !/^(?:true|false)$/.test(requireCertificate)) {
    errors.push("OUTFLOW_MACOS_REQUIRE_CERTIFICATE: expected true or false.");
  }
  if (Boolean(certificate) !== Boolean(certificatePassword)) {
    errors.push("APPLE_CERTIFICATE: certificate and password must be provided together when importing a CI identity.");
  }
  if (requireCertificate === "true" && (!certificate || !certificatePassword)) {
    errors.push("APPLE_CERTIFICATE: a certificate and password are required for this release environment.");
  }

  const expectedCommit = value(env, "OUTFLOW_MACOS_EXPECTED_COMMIT");
  if (expectedCommit) {
    if (!/^[a-f0-9]{40}$/.test(expectedCommit)) {
      errors.push("OUTFLOW_MACOS_EXPECTED_COMMIT: expected an exact lowercase Git commit SHA.");
    }
    if (value(env, "GITHUB_SHA") !== expectedCommit) {
      errors.push("GITHUB_SHA: must match the pinned macOS release commit.");
    }
    if (value(env, "GITHUB_REF") !== "refs/heads/main") {
      errors.push("GITHUB_REF: production macOS releases must run from main.");
    }
  }

  const requireUpdater = value(env, "OUTFLOW_MACOS_REQUIRE_UPDATER");
  if (requireUpdater && !/^(?:true|false)$/.test(requireUpdater)) {
    errors.push("OUTFLOW_MACOS_REQUIRE_UPDATER: expected true or false.");
  }
  if (requireUpdater === "true") {
    if (value(env, "OUTFLOW_MACOS_TARGET") !== "universal-apple-darwin") {
      errors.push("OUTFLOW_MACOS_TARGET: signed updates require the universal macOS target.");
    }
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value(env, "OUTFLOW_MACOS_EXPECTED_VERSION"))) {
      errors.push("OUTFLOW_MACOS_EXPECTED_VERSION: expected an exact semantic version.");
    }
    const updaterPublicKey = value(env, "OUTFLOW_UPDATER_PUBLIC_KEY");
    const updaterPrivateKey = value(env, "TAURI_SIGNING_PRIVATE_KEY");
    const updaterPassword = String(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || "");
    if (updaterPublicKey.length < 40 || updaterPublicKey.length > 2_000) {
      errors.push("OUTFLOW_UPDATER_PUBLIC_KEY: expected the Tauri updater public key content.");
    }
    if (updaterPrivateKey.length < 40) {
      errors.push("TAURI_SIGNING_PRIVATE_KEY: expected the encrypted Tauri updater private key content.");
    }
    if (updaterPassword.length < 16) {
      errors.push("TAURI_SIGNING_PRIVATE_KEY_PASSWORD: expected at least 16 characters.");
    }
  }

  const apiPresent = apiNames.filter((name) => value(env, name));
  const appleIdPresent = appleIdNames.filter((name) => value(env, name));
  if (apiPresent.length && appleIdPresent.length) {
    errors.push("Apple notarization: configure exactly one authentication mode.");
  } else if (apiPresent.length && apiPresent.length !== apiNames.length) {
    errors.push("Apple notarization API: key ID, issuer, and private-key path must all be provided.");
  } else if (appleIdPresent.length && appleIdPresent.length !== appleIdNames.length) {
    errors.push("Apple notarization account: Apple ID, app password, and Team ID must all be provided.");
  } else if (!apiPresent.length && !appleIdPresent.length) {
    errors.push("Apple notarization: one complete authentication mode is required.");
  }

  let mode = null;
  if (apiPresent.length === apiNames.length) {
    if (!appleIdPresent.length) mode = "app-store-connect-api";
    if (!/^[A-Z0-9]{10}$/.test(value(env, "APPLE_API_KEY"))) {
      errors.push("APPLE_API_KEY: expected a 10-character App Store Connect key ID.");
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value(env, "APPLE_API_ISSUER"))) {
      errors.push("APPLE_API_ISSUER: expected an App Store Connect issuer UUID.");
    }
    const key = inspectPath(value(env, "APPLE_API_KEY_PATH"));
    if (!key.exists || !key.file) {
      errors.push("APPLE_API_KEY_PATH: expected a readable private-key file.");
    } else {
      if (!Number.isSafeInteger(key.size) || key.size < 100 || key.size > 20_000) {
        errors.push("APPLE_API_KEY_PATH: private-key file size is outside the accepted boundary.");
      }
      const repositoryRelative = relative(root, key.path);
      if (!repositoryRelative.startsWith("..") || repositoryRelative === "") {
        errors.push("APPLE_API_KEY_PATH: private key must be stored outside the repository.");
      }
      if ((key.mode & 0o077) !== 0) errors.push("APPLE_API_KEY_PATH: private key permissions must exclude group and other access.");
    }
  }

  if (appleIdPresent.length === appleIdNames.length) {
    if (!apiPresent.length) mode = "apple-id";
    if (!/^\S+@\S+\.\S+$/.test(value(env, "APPLE_ID"))) errors.push("APPLE_ID: expected an account email address.");
    if (value(env, "APPLE_PASSWORD").length < 8) errors.push("APPLE_PASSWORD: expected an app-specific or indirect password reference.");
    if (value(env, "APPLE_TEAM_ID") !== expectedTeamId) errors.push("APPLE_TEAM_ID: must match the pinned expected Team ID.");
  }

  return { valid: errors.length === 0, mode, errors };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = validateMacosReleaseEnvironment(process.env);
  if (!result.valid) {
    result.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
  } else {
    console.log(`Validated the Outflow macOS Developer ID and ${result.mode} notarization boundary`);
  }
}
