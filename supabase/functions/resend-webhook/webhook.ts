export const MAX_RESEND_WEBHOOK_BYTES = 64 * 1024;
export const RESEND_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

const supportedEventTypes = new Set([
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.bounced",
  "email.complained",
  "email.suppressed",
]);

function decodeBase64(value: string) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

export type ResendWebhookHeaders = {
  id: string;
  timestamp: string;
  signature: string;
};

export async function verifyResendWebhook(
  payload: string,
  headers: ResendWebhookHeaders,
  secret: string,
  nowMilliseconds = Date.now(),
) {
  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : "";
  const secretBytes = decodeBase64(encodedSecret);
  const timestamp = Number(headers.timestamp);
  if (
    !secretBytes?.length
    || !/^[A-Za-z0-9_-]{1,128}$/.test(headers.id)
    || !Number.isSafeInteger(timestamp)
    || Math.abs(Math.floor(nowMilliseconds / 1000) - timestamp) > RESEND_WEBHOOK_TOLERANCE_SECONDS
  ) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new TextEncoder().encode(`${headers.id}.${headers.timestamp}.${payload}`);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  return headers.signature
    .trim()
    .split(/\s+/)
    .some((candidate) => {
      const [version, encoded] = candidate.split(",", 2);
      const supplied = version === "v1" ? decodeBase64(encoded || "") : null;
      return supplied ? equalBytes(supplied, expected) : false;
    });
}

export type ResendProviderEvent = {
  eventType: string;
  providerIdentifier: string;
  eventCreatedAt: string;
};

export function parseResendProviderEvent(source: string): ResendProviderEvent | null {
  let event: unknown;
  try {
    event = JSON.parse(source);
  } catch {
    throw new Error("invalid-json");
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("invalid-event");
  const record = event as Record<string, unknown>;
  if (typeof record.type !== "string" || !supportedEventTypes.has(record.type)) return null;
  if (typeof record.created_at !== "string" || !Number.isFinite(Date.parse(record.created_at))) {
    throw new Error("invalid-event");
  }
  if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) throw new Error("invalid-event");
  const data = record.data as Record<string, unknown>;
  if (
    typeof data.email_id !== "string"
    || data.email_id.length < 1
    || data.email_id.length > 100
    || !/^[A-Za-z0-9_-]+$/.test(data.email_id)
  ) throw new Error("invalid-event");
  return {
    eventType: record.type,
    providerIdentifier: data.email_id,
    eventCreatedAt: new Date(record.created_at).toISOString(),
  };
}
