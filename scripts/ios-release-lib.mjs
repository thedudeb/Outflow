import { execFileSync } from "node:child_process";
import { X509Certificate, createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

export const IOS_BUNDLE_ID = "com.thedudeb.outflow";
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

function environmentWithoutSigningSecrets(env = process.env) {
  const sanitized = { ...env };
  delete sanitized.IOS_CERTIFICATE;
  delete sanitized.IOS_CERTIFICATE_PASSWORD;
  delete sanitized.IOS_MOBILE_PROVISION;
  return sanitized;
}

export function normalizeFingerprint(input) {
  return String(input || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

export function decodeCanonicalBase64(input, { name, minimum, maximum }) {
  const compact = String(input || "").replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
    throw new Error(`${name}: expected canonical base64.`);
  }
  const decoded = Buffer.from(compact, "base64");
  if (decoded.toString("base64") !== compact) throw new Error(`${name}: expected canonical base64.`);
  if (decoded.length < minimum || decoded.length > maximum) {
    throw new Error(`${name}: decoded size is outside the accepted boundary.`);
  }
  return decoded;
}

export function parseCertificateIdentity(certificate) {
  const teamId = certificate.subject.match(/(?:^|\n)OU=([A-Z0-9]{10})(?:\n|$)/)?.[1] || "";
  const commonName = certificate.subject.match(/(?:^|\n)CN=([^\n]+)(?:\n|$)/)?.[1] || "";
  return { teamId, commonName };
}

export function validateCertificate(certificate, expectedTeamId, expectedFingerprint, now = Date.now()) {
  const errors = [];
  const { teamId, commonName } = parseCertificateIdentity(certificate);
  if (!/^(?:Apple|iPhone) Distribution: .+ \([A-Z0-9]{10}\)$/.test(commonName)) {
    errors.push("IOS_CERTIFICATE: expected an Apple Distribution certificate.");
  }
  if (teamId !== expectedTeamId || !commonName.endsWith(`(${expectedTeamId})`)) {
    errors.push("IOS_CERTIFICATE: certificate Team ID does not match the independent pin.");
  }
  if (!/Apple Worldwide Developer Relations/i.test(certificate.issuer)) {
    errors.push("IOS_CERTIFICATE: certificate issuer is not Apple Worldwide Developer Relations.");
  }
  if (normalizeFingerprint(certificate.fingerprint256) !== expectedFingerprint) {
    errors.push("OUTFLOW_IOS_EXPECTED_CERT_SHA256: certificate does not match the independent pin.");
  }
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || now < validFrom || now >= validTo) {
    errors.push("IOS_CERTIFICATE: distribution certificate is not currently valid.");
  } else if (validTo - now < THIRTY_DAYS_MS) {
    errors.push("IOS_CERTIFICATE: distribution certificate expires within 30 days.");
  }
  return errors;
}

function profileCertificate(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value && value.type === "Buffer" && Array.isArray(value.data)) return Buffer.from(value.data);
  return Buffer.from(String(value || ""), "base64");
}

export function validateProvisioningProfile(profile, expectedTeamId, expectedFingerprint, options = {}) {
  const errors = [];
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const entitlements = profile?.Entitlements || {};
  const applicationIdentifier = `${expectedTeamId}.${IOS_BUNDLE_ID}`;
  const allowedEntitlements = new Set([
    "application-identifier",
    "beta-reports-active",
    "com.apple.developer.team-identifier",
    "get-task-allow",
    "keychain-access-groups",
  ]);

  if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(String(profile?.UUID || ""))) {
    errors.push("IOS_MOBILE_PROVISION: profile UUID is invalid.");
  }
  if (!String(profile?.Name || "").trim()) errors.push("IOS_MOBILE_PROVISION: profile name is missing.");
  if (!Array.isArray(profile?.TeamIdentifier) || profile.TeamIdentifier.length !== 1 || profile.TeamIdentifier[0] !== expectedTeamId) {
    errors.push("IOS_MOBILE_PROVISION: profile Team ID does not match the independent pin.");
  }
  if (!Array.isArray(profile?.ApplicationIdentifierPrefix)
    || profile.ApplicationIdentifierPrefix.length !== 1
    || profile.ApplicationIdentifierPrefix[0] !== expectedTeamId) {
    errors.push("IOS_MOBILE_PROVISION: application identifier prefix does not match the Team ID.");
  }
  if (entitlements["application-identifier"] !== applicationIdentifier) {
    errors.push("IOS_MOBILE_PROVISION: profile is not restricted to the Outflow bundle identifier.");
  }
  if (entitlements["com.apple.developer.team-identifier"] !== expectedTeamId) {
    errors.push("IOS_MOBILE_PROVISION: profile entitlement Team ID does not match the independent pin.");
  }
  if (entitlements["get-task-allow"] !== false) errors.push("IOS_MOBILE_PROVISION: development debugging must be disabled.");
  if (entitlements["beta-reports-active"] !== true) errors.push("IOS_MOBILE_PROVISION: expected an App Store distribution profile.");
  if (!Array.isArray(entitlements["keychain-access-groups"])
    || entitlements["keychain-access-groups"].length !== 1
    || entitlements["keychain-access-groups"][0] !== `${expectedTeamId}.*`) {
    errors.push("IOS_MOBILE_PROVISION: keychain access group is outside the expected Team ID.");
  }
  if (profile && Object.hasOwn(profile, "ProvisionedDevices")) {
    errors.push("IOS_MOBILE_PROVISION: expected an App Store Connect profile without registered devices.");
  }
  if (profile && Object.hasOwn(profile, "ProvisionsAllDevices")) errors.push("IOS_MOBILE_PROVISION: enterprise profiles are not accepted.");
  for (const key of Object.keys(entitlements)) {
    if (!allowedEntitlements.has(key)) errors.push(`IOS_MOBILE_PROVISION: unapproved entitlement ${key}.`);
  }

  const created = Date.parse(profile?.CreationDate);
  const expires = Date.parse(profile?.ExpirationDate);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now || expires <= now) {
    errors.push("IOS_MOBILE_PROVISION: profile is not currently valid.");
  } else if (expires - now < THIRTY_DAYS_MS) {
    errors.push("IOS_MOBILE_PROVISION: profile expires within 30 days.");
  }

  const parseCertificate = options.parseCertificate || ((entry) => new X509Certificate(profileCertificate(entry)));
  const profileFingerprints = (profile?.DeveloperCertificates || []).flatMap((entry) => {
    try {
      return [normalizeFingerprint(parseCertificate(entry).fingerprint256)];
    } catch {
      return [];
    }
  });
  if (!profileFingerprints.includes(expectedFingerprint)) {
    errors.push("IOS_MOBILE_PROVISION: profile does not contain the independently pinned distribution certificate.");
  }
  return errors;
}

export function readProvisioningProfile(path, options = {}) {
  const execute = options.execute || execFileSync;
  const commandOptions = {
    encoding: "utf8",
    env: environmentWithoutSigningSecrets({ ...process.env, ...(options.env || {}) }),
    maxBuffer: 5 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  };
  const plist = execute("/usr/bin/security", ["cms", "-D", "-i", path], commandOptions);
  const plistPath = `${path}.plist`;
  writeFileSync(plistPath, plist, { mode: 0o600 });
  try {
    return JSON.parse(execute("/usr/bin/plutil", ["-convert", "json", "-o", "-", plistPath], commandOptions));
  } finally {
    rmSync(plistPath, { force: true });
  }
}

export function readPlist(path, options = {}) {
  const execute = options.execute || execFileSync;
  return JSON.parse(execute("/usr/bin/plutil", ["-convert", "json", "-o", "-", path], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

export function readCertificateFromPkcs12(path, env, options = {}) {
  const execute = options.execute || execFileSync;
  const childEnvironment = environmentWithoutSigningSecrets({ ...process.env, ...env });
  childEnvironment.IOS_CERTIFICATE_PASSWORD = String(env.IOS_CERTIFICATE_PASSWORD || "");
  const pem = execute("/usr/bin/openssl", [
    "pkcs12", "-in", path, "-clcerts", "-nokeys", "-passin", "env:IOS_CERTIFICATE_PASSWORD",
  ], {
    encoding: "utf8",
    env: childEnvironment,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const privateKeyPem = execute("/usr/bin/openssl", [
    "pkcs12", "-in", path, "-nocerts", "-nodes", "-passin", "env:IOS_CERTIFICATE_PASSWORD",
  ], {
    encoding: "utf8",
    env: childEnvironment,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const certificate = new X509Certificate(pem);
  const certificatePublicKey = certificate.publicKey.export({ type: "spki", format: "der" });
  const privateKeyPublicKey = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "der" });
  if (!certificatePublicKey.equals(privateKeyPublicKey)) throw new Error("PKCS #12 private key does not match its certificate.");
  return certificate;
}

export function assertMachOArm64(path) {
  const header = readFileSync(path).subarray(0, 8);
  const magic = header.subarray(0, 4).toString("hex");
  if (magic !== "cffaedfe") throw new Error("iOS executable is not a 64-bit little-endian Mach-O binary.");
  if (header.readUInt32LE(4) !== 0x0100000c) throw new Error("iOS executable is not ARM64.");
}
