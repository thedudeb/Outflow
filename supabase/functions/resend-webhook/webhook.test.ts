import {
  parseResendProviderEvent,
  RESEND_WEBHOOK_TOLERANCE_SECONDS,
  verifyResendWebhook,
} from "./webhook.ts";

function assert(condition: unknown, message = "assertion failed") {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertThrows(callback: () => unknown, message: string) {
  try {
    callback();
  } catch (error) {
    if (error instanceof Error && error.message.includes(message)) return;
    throw error;
  }
  throw new Error(`expected function to throw ${message}`);
}

function encodeBase64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}

async function signedHeaders(payload: string, secret: string, timestamp: number, id = "msg_acceptance_123") {
  const keyBytes = Uint8Array.from(atob(secret.slice(6)), (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${payload}`),
  ));
  return { id, timestamp: String(timestamp), signature: `v1,${encodeBase64(signature)}` };
}

Deno.test("Resend signature verification authenticates the exact raw body and accepts rotated signatures", async () => {
  const secret = `whsec_${encodeBase64(crypto.getRandomValues(new Uint8Array(32)))}`;
  const now = Date.parse("2026-07-19T18:00:00.000Z");
  const timestamp = Math.floor(now / 1000);
  const payload = JSON.stringify({ type: "email.delivered", created_at: "2026-07-19T17:59:59Z", data: { email_id: "provider_123" } });
  const headers = await signedHeaders(payload, secret, timestamp);
  assert(await verifyResendWebhook(payload, headers, secret, now));
  assert(await verifyResendWebhook(payload, { ...headers, signature: `v1,invalid ${headers.signature}` }, secret, now));
  assertEquals(await verifyResendWebhook(`${payload} `, headers, secret, now), false);
});

Deno.test("Resend signature verification rejects stale, future, malformed, and incorrectly signed requests", async () => {
  const secret = `whsec_${encodeBase64(crypto.getRandomValues(new Uint8Array(32)))}`;
  const otherSecret = `whsec_${encodeBase64(crypto.getRandomValues(new Uint8Array(32)))}`;
  const now = Date.parse("2026-07-19T18:00:00.000Z");
  const payload = "{}";
  const timestamp = Math.floor(now / 1000);
  const headers = await signedHeaders(payload, secret, timestamp);
  assertEquals(await verifyResendWebhook(payload, headers, otherSecret, now), false);
  assertEquals(await verifyResendWebhook(payload, { ...headers, timestamp: String(timestamp - RESEND_WEBHOOK_TOLERANCE_SECONDS - 1) }, secret, now), false);
  assertEquals(await verifyResendWebhook(payload, { ...headers, timestamp: String(timestamp + RESEND_WEBHOOK_TOLERANCE_SECONDS + 1) }, secret, now), false);
  assertEquals(await verifyResendWebhook(payload, { ...headers, id: "bad id" }, secret, now), false);
  assertEquals(await verifyResendWebhook(payload, headers, "not-a-secret", now), false);
});

Deno.test("Resend event parsing keeps only bounded correlation metadata", () => {
  const parsed = parseResendProviderEvent(JSON.stringify({
    type: "email.bounced",
    created_at: "2026-07-19T18:00:00.000Z",
    data: {
      email_id: "provider-message_123",
      to: ["private@example.com"],
      subject: "Private subject",
      bounce: { message: "Private diagnostic" },
    },
  }));
  assertEquals(parsed, {
    eventType: "email.bounced",
    providerIdentifier: "provider-message_123",
    eventCreatedAt: "2026-07-19T18:00:00.000Z",
  });
  assertEquals(parseResendProviderEvent(JSON.stringify({
    type: "email.opened",
    created_at: "2026-07-19T18:00:00.000Z",
    data: { email_id: "provider-message_123" },
  })), null);
});

Deno.test("Resend event parsing rejects malformed supported events", () => {
  assertThrows(() => parseResendProviderEvent("not-json"), "invalid-json");
  assertThrows(() => parseResendProviderEvent(JSON.stringify({
    type: "email.failed",
    created_at: "not-a-date",
    data: { email_id: "provider-message_123" },
  })), "invalid-event");
});
