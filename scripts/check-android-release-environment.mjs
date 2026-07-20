import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function value(env, name) {
  return String(env[name] || "").trim();
}

function secretValue(env, name) {
  return String(env[name] || "");
}

function normalizeFingerprint(input) {
  return String(input || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

export function validateAndroidReleaseEnvironment(env, options = {}) {
  const root = resolve(options.root || process.cwd());
  const inspectPath = options.inspectPath || ((path) => {
    const resolved = resolve(path);
    if (!existsSync(resolved)) return { exists: false, file: false, mode: 0, size: 0, path: resolved };
    const stats = statSync(resolved);
    return { exists: true, file: stats.isFile(), mode: stats.mode, size: stats.size, path: resolved };
  });
  const errors = [];
  const keystorePath = value(env, "OUTFLOW_ANDROID_KEYSTORE_PATH");
  const keystorePassword = secretValue(env, "OUTFLOW_ANDROID_KEYSTORE_PASSWORD");
  const keyAlias = value(env, "OUTFLOW_ANDROID_KEY_ALIAS");
  const keyPassword = secretValue(env, "OUTFLOW_ANDROID_KEY_PASSWORD");
  const expectedFingerprint = normalizeFingerprint(env.OUTFLOW_ANDROID_EXPECTED_CERT_SHA256);

  if (!keystorePath) {
    errors.push("OUTFLOW_ANDROID_KEYSTORE_PATH: a production upload keystore is required.");
  } else {
    const keystore = inspectPath(keystorePath);
    if (!keystore.exists || !keystore.file) {
      errors.push("OUTFLOW_ANDROID_KEYSTORE_PATH: expected a readable regular file.");
    } else {
      if (!Number.isSafeInteger(keystore.size) || keystore.size < 1_000 || keystore.size > 20 * 1024 * 1024) {
        errors.push("OUTFLOW_ANDROID_KEYSTORE_PATH: file size is outside the accepted boundary.");
      }
      const repositoryRelative = relative(root, keystore.path);
      if (!repositoryRelative.startsWith("..") || repositoryRelative === "") {
        errors.push("OUTFLOW_ANDROID_KEYSTORE_PATH: keystore must be stored outside the repository.");
      }
      if ((keystore.mode & 0o077) !== 0) {
        errors.push("OUTFLOW_ANDROID_KEYSTORE_PATH: permissions must exclude group and other access.");
      }
    }
  }

  if (keystorePassword.length < 16 || keystorePassword.length > 256) {
    errors.push("OUTFLOW_ANDROID_KEYSTORE_PASSWORD: expected 16 to 256 characters.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(keyAlias)) {
    errors.push("OUTFLOW_ANDROID_KEY_ALIAS: expected a bounded alphanumeric alias.");
  }
  if (keyPassword.length < 16 || keyPassword.length > 256) {
    errors.push("OUTFLOW_ANDROID_KEY_PASSWORD: expected 16 to 256 characters.");
  }
  if (!/^[A-F0-9]{64}$/.test(expectedFingerprint)) {
    errors.push("OUTFLOW_ANDROID_EXPECTED_CERT_SHA256: expected a 32-byte certificate fingerprint.");
  }

  const expectedCommit = value(env, "OUTFLOW_ANDROID_EXPECTED_COMMIT");
  if (expectedCommit) {
    if (!/^[a-f0-9]{40}$/.test(expectedCommit)) {
      errors.push("OUTFLOW_ANDROID_EXPECTED_COMMIT: expected an exact lowercase Git commit SHA.");
    }
    if (value(env, "GITHUB_SHA") !== expectedCommit) {
      errors.push("GITHUB_SHA: must match the pinned Android release commit.");
    }
    if (value(env, "GITHUB_REF") !== "refs/heads/main") {
      errors.push("GITHUB_REF: production Android signing acceptance must run from main.");
    }
  }

  return { valid: errors.length === 0, expectedFingerprint, errors };
}

export function verifyAndroidReleaseEnvironment(env, options = {}) {
  const validation = validateAndroidReleaseEnvironment(env, options);
  if (!validation.valid) return validation;

  const keytool = options.keytool || (env.JAVA_HOME
    ? join(env.JAVA_HOME, "bin", process.platform === "win32" ? "keytool.exe" : "keytool")
    : "keytool");
  const execute = options.execute || execFileSync;
  const parseCertificate = options.parseCertificate || ((pem) => new X509Certificate(pem));
  let entry;
  let certificate;
  try {
    const commandOptions = {
      encoding: "utf8",
      env: { ...process.env, ...env },
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    };
    entry = execute(keytool, [
      "-list",
      "-v",
      "-keystore", value(env, "OUTFLOW_ANDROID_KEYSTORE_PATH"),
      "-storepass:env", "OUTFLOW_ANDROID_KEYSTORE_PASSWORD",
      "-alias", value(env, "OUTFLOW_ANDROID_KEY_ALIAS"),
    ], commandOptions);
    const pem = execute(keytool, [
      "-exportcert",
      "-rfc",
      "-keystore", value(env, "OUTFLOW_ANDROID_KEYSTORE_PATH"),
      "-storepass:env", "OUTFLOW_ANDROID_KEYSTORE_PASSWORD",
      "-alias", value(env, "OUTFLOW_ANDROID_KEY_ALIAS"),
    ], commandOptions);
    certificate = parseCertificate(pem);
  } catch {
    return {
      ...validation,
      valid: false,
      errors: ["OUTFLOW_ANDROID_KEYSTORE_PATH: keytool could not open the configured private-key entry."],
    };
  }

  const actualFingerprint = normalizeFingerprint(certificate.fingerprint256);
  const errors = [];
  if (!/Entry type:\s*PrivateKeyEntry/i.test(String(entry))) {
    errors.push("OUTFLOW_ANDROID_KEY_ALIAS: configured entry is not a private key.");
  }
  if (actualFingerprint !== validation.expectedFingerprint) {
    errors.push("OUTFLOW_ANDROID_EXPECTED_CERT_SHA256: keystore certificate does not match the independent pin.");
  }
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || now < validFrom || now >= validTo) {
    errors.push("OUTFLOW_ANDROID_KEY_ALIAS: upload certificate is not currently valid.");
  } else if (validTo - now < 30 * 24 * 60 * 60 * 1_000) {
    errors.push("OUTFLOW_ANDROID_KEY_ALIAS: upload certificate expires within 30 days.");
  }

  return { ...validation, valid: errors.length === 0, errors };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = verifyAndroidReleaseEnvironment(process.env);
  if (!result.valid) {
    result.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
  } else {
    console.log("Validated the Outflow Android production upload-key and exact-commit boundary");
  }
}
