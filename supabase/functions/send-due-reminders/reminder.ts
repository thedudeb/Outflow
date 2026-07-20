export const MAX_RESEND_ERROR_BYTES = 4 * 1024;
const RESEND_ERROR_NAMES = new Set([
  "invalid_idempotency_key",
  "validation_error",
  "missing_api_key",
  "restricted_api_key",
  "invalid_api_key",
  "not_found",
  "method_not_allowed",
  "invalid_idempotent_request",
  "concurrent_idempotent_requests",
  "invalid_attachment",
  "invalid_from_address",
  "invalid_access",
  "invalid_parameter",
  "invalid_region",
  "missing_required_field",
  "monthly_quota_exceeded",
  "daily_quota_exceeded",
  "rate_limit_exceeded",
  "security_error",
  "application_error",
  "internal_server_error",
]);

export async function resendFailureCode(response: Response) {
  const status = Number.isInteger(response.status) && response.status >= 400 && response.status <= 599
    ? response.status
    : 0;
  const fallback = status ? `resend_${status}` : "resend_error";
  if (!status) return fallback;
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_RESEND_ERROR_BYTES) return fallback;

  const reader = response.body?.getReader();
  if (!reader) return fallback;
  const decoder = new TextDecoder();
  let source = "";
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_RESEND_ERROR_BYTES) {
        await reader.cancel();
        return fallback;
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
  } catch {
    return fallback;
  }

  try {
    const body = source ? JSON.parse(source) : {};
    const name = typeof body?.name === "string" ? body.name : "";
    return RESEND_ERROR_NAMES.has(name) ? `${fallback}_${name}` : fallback;
  } catch {
    return fallback;
  }
}
