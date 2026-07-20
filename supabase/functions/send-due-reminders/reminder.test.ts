import { MAX_RESEND_ERROR_BYTES, resendFailureCode } from "./reminder.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected ${String(expected)}, received ${String(actual)}`);
}

Deno.test("Resend failure classification retains only a bounded provider error name", async () => {
  const response = Response.json({
    name: "invalid_idempotent_request",
    message: "Private provider diagnostic for private@example.com",
  }, { status: 409 });
  assertEquals(await resendFailureCode(response), "resend_409_invalid_idempotent_request");
});

Deno.test("Resend failure classification falls back for malformed or unsafe bodies", async () => {
  assertEquals(await resendFailureCode(new Response("not-json", { status: 500 })), "resend_500");
  assertEquals(await resendFailureCode(Response.json({ name: "unsafe-name!" }, { status: 422 })), "resend_422");
  assertEquals(await resendFailureCode(Response.json({ name: "unknown_but_safe_name" }, { status: 422 })), "resend_422");
  assertEquals(await resendFailureCode(new Response("x", {
    status: 429,
    headers: { "Content-Length": String(MAX_RESEND_ERROR_BYTES + 1) },
  })), "resend_429");
  assertEquals(await resendFailureCode(new Response("x".repeat(MAX_RESEND_ERROR_BYTES + 1), {
    status: 500,
  })), "resend_500");
  assertEquals(await resendFailureCode(Response.json({ name: "internal_server_error" }, { status: 200 })), "resend_error");
});
