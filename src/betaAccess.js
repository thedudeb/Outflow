const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const codePattern = /^OUTFLOW-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}$/;
const redemptionStatuses = new Set(["redeemed", "already_redeemed", "already_pro", "invalid", "rate_limited"]);

function validTimestamp(value, nullable = false) {
  if (nullable && value === null) return true;
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function validOptionalText(value, maximum) {
  return value === null || (typeof value === "string" && value.length <= maximum);
}

function sanitizeRedemption(value) {
  if (
    !value
    || typeof value !== "object"
    || !(value.userId === null || (typeof value.userId === "string" && uuidPattern.test(value.userId)))
    || !validOptionalText(value.email, 254)
    || !validOptionalText(value.displayName, 60)
    || !validTimestamp(value.redeemedAt)
  ) {
    throw new Error("Outflow returned an invalid beta redemption record.");
  }
  return {
    userId: value.userId,
    email: value.email || "",
    displayName: value.displayName || "",
    redeemedAt: value.redeemedAt,
  };
}

function sanitizeCodeSummary(value) {
  if (
    !value
    || typeof value !== "object"
    || typeof value.id !== "string"
    || !uuidPattern.test(value.id)
    || typeof value.label !== "string"
    || value.label.length < 1
    || value.label.length > 60
    || typeof value.codeSuffix !== "string"
    || !/^[A-F0-9]{5}$/.test(value.codeSuffix)
    || !Number.isInteger(value.maxRedemptions)
    || value.maxRedemptions < 1
    || value.maxRedemptions > 20
    || !Number.isInteger(value.redemptionCount)
    || value.redemptionCount < 0
    || value.redemptionCount > value.maxRedemptions
    || !Number.isInteger(value.remaining)
    || value.remaining !== value.maxRedemptions - value.redemptionCount
    || !validTimestamp(value.expiresAt, true)
    || !validTimestamp(value.disabledAt, true)
    || !validTimestamp(value.createdAt)
    || (value.redemptions !== undefined && !Array.isArray(value.redemptions))
  ) {
    throw new Error("Outflow returned an invalid beta access code.");
  }
  return {
    id: value.id,
    label: value.label,
    codeSuffix: value.codeSuffix,
    maxRedemptions: value.maxRedemptions,
    redemptionCount: value.redemptionCount,
    remaining: value.remaining,
    expiresAt: value.expiresAt,
    disabledAt: value.disabledAt,
    createdAt: value.createdAt,
    redemptions: (value.redemptions || []).map(sanitizeRedemption),
  };
}

export function sanitizeBetaAccessReport(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || !Array.isArray(value.codes) || value.codes.length > 100) {
    throw new Error("Outflow returned an invalid beta access report.");
  }
  return value.codes.map(sanitizeCodeSummary);
}

export function sanitizeCreatedBetaAccessCode(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || typeof value.code !== "string" || !codePattern.test(value.code)) {
    throw new Error("Outflow returned an invalid beta access secret.");
  }
  return { ...sanitizeCodeSummary(value), code: value.code };
}

export function sanitizeBetaRedemptionResult(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || !redemptionStatuses.has(value.status)) {
    throw new Error("Outflow returned an invalid beta redemption result.");
  }
  if (value.status === "redeemed") {
    if (typeof value.label !== "string" || value.label.length < 1 || value.label.length > 60 || !validTimestamp(value.redeemedAt)) {
      throw new Error("Outflow returned an invalid beta redemption result.");
    }
    return { status: value.status, label: value.label, redeemedAt: value.redeemedAt };
  }
  return { status: value.status };
}

export function normalizeBetaAccessCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 64);
}
