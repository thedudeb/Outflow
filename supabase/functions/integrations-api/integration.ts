export const INTEGRATION_TOKEN_PATTERN = /^outflow_pat_[A-Za-z0-9_-]{43}$/;
export const LIST_ID_PATTERN = /^[A-Za-z0-9-]{1,100}$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_INTEGRATION_BODY_BYTES = 32_768;

export type IntegrationRoute =
  | { kind: "service" }
  | { kind: "lists" }
  | { kind: "subscriptions"; listId: string }
  | { kind: "subscription"; listId: string; subscriptionId: string }
  | { kind: "missing" };

export function bearerToken(header: string | null) {
  const match = /^Bearer (outflow_pat_[A-Za-z0-9_-]{43})$/.exec(header || "");
  return match?.[1] || "";
}

function decodedSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export function integrationRoute(url: URL): IntegrationRoute {
  const parts = url.pathname.split("/").filter(Boolean);
  const functionIndex = parts.lastIndexOf("integrations-api");
  const route = functionIndex >= 0 ? parts.slice(functionIndex + 1) : parts;
  if (route.length === 1 && route[0] === "v1") return { kind: "service" };
  if (route.length === 2 && route[0] === "v1" && route[1] === "lists") return { kind: "lists" };
  if (route.length === 4 && route[0] === "v1" && route[1] === "lists" && route[3] === "subscriptions") {
    return { kind: "subscriptions", listId: decodedSegment(route[2]) };
  }
  if (route.length === 5 && route[0] === "v1" && route[1] === "lists" && route[3] === "subscriptions") {
    return {
      kind: "subscription",
      listId: decodedSegment(route[2]),
      subscriptionId: decodedSegment(route[4]),
    };
  }
  return { kind: "missing" };
}

export function validRouteIdentifiers(route: IntegrationRoute) {
  if (route.kind === "subscriptions") return LIST_ID_PATTERN.test(route.listId);
  if (route.kind === "subscription") {
    return LIST_ID_PATTERN.test(route.listId) && LIST_ID_PATTERN.test(route.subscriptionId);
  }
  return true;
}

export function allowedBrowserOrigin(origin: string, configuredOrigins: string) {
  if (!origin) return true;
  return configuredOrigins
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(origin);
}

export function validDueBefore(value: string | null) {
  if (!value) return true;
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function readJsonObjectBody(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(length) || length > MAX_INTEGRATION_BODY_BYTES || !request.body) return null;
  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_INTEGRATION_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    if (totalBytes === 0) return null;
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function withoutSubscriptionId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { id, ...payload } = value as Record<string, unknown>;
  if (id !== undefined && (typeof id !== "string" || !LIST_ID_PATTERN.test(id))) return null;
  return { id: typeof id === "string" ? id : "", payload };
}
