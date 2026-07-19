import { createClient } from "npm:@supabase/supabase-js@2.75.0";
import { createEvents } from "npm:ics@3.12.0";

type FeedSubscription = {
  id: string;
  name: string;
  amount: number | string;
  currency: string;
  cycle: "weekly" | "monthly" | "yearly";
  nextBillingDate: string;
  category: string;
  paused: boolean;
  revision: number;
  updatedAt: string;
};

type FeedPayload = {
  feedId: string;
  includePaused: boolean;
  ledger: {
    id: string;
    name: string;
    kind: "personal" | "household" | "team";
  };
  subscriptions: FeedSubscription[];
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function dateParts(value: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError("Invalid calendar date.");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function nextDateParts(value: string): [number, number, number] {
  const [year, month, day] = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
}

function timestampParts(value: string): [number, number, number, number, number] {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid calendar timestamp.");
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()];
}

function money(amount: number | string, currency: string) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !/^[A-Z]{3}$/.test(currency)) {
    throw new TypeError("Invalid calendar amount.");
  }
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(numericAmount);
}

function calendarText(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

function validPayload(value: unknown): value is FeedPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<FeedPayload>;
  if (!payload.ledger || !Array.isArray(payload.subscriptions) || payload.subscriptions.length > 500) return false;
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(payload.ledger.id || "") || !String(payload.ledger.name || "").trim()) return false;
  if (!["personal", "household", "team"].includes(payload.ledger.kind || "")) return false;
  return payload.subscriptions.every((subscription) => (
    /^[a-zA-Z0-9-]{1,100}$/.test(subscription.id || "")
    && typeof subscription.name === "string"
    && subscription.name.trim().length > 0
    && subscription.name.length <= 100
    && ["weekly", "monthly", "yearly"].includes(subscription.cycle)
    && /^\d{4}-\d{2}-\d{2}$/.test(subscription.nextBillingDate || "")
    && Number.isInteger(Number(subscription.revision))
    && Number(subscription.revision) >= 0
    && typeof subscription.category === "string"
    && Number.isFinite(Date.parse(subscription.updatedAt))
  ));
}

function calendarBody(payload: FeedPayload) {
  const { error, value } = createEvents(payload.subscriptions.map((subscription) => ({
    productId: "Outflow Subscription Tracker",
    calName: `Outflow / ${calendarText(payload.ledger.name)}`,
    uid: `${subscription.id}.${payload.ledger.id}@outflow.local`,
    sequence: Number(subscription.revision),
    start: dateParts(subscription.nextBillingDate),
    end: nextDateParts(subscription.nextBillingDate),
    title: `${calendarText(subscription.name)} / ${money(subscription.amount, subscription.currency)}`,
    description: `${subscription.paused ? "Paused schedule / " : ""}${subscription.cycle} charge / ${calendarText(payload.ledger.name)} / ${payload.ledger.kind} cloud ledger`,
    categories: ["Outflow", calendarText(subscription.category)],
    status: subscription.paused ? "TENTATIVE" : "CONFIRMED",
    busyStatus: "FREE",
    transp: "TRANSPARENT",
    classification: "PRIVATE",
    recurrenceRule: {
      weekly: "FREQ=WEEKLY",
      monthly: "FREQ=MONTHLY",
      yearly: "FREQ=YEARLY",
    }[subscription.cycle],
    lastModified: timestampParts(subscription.updatedAt),
  })), {
    productId: "Outflow Subscription Tracker",
    calName: `Outflow / ${calendarText(payload.ledger.name)}`,
    method: "PUBLISH",
  });
  if (error || !value) throw error || new Error("Calendar generation failed.");
  return value;
}

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const projectUrl = Deno.env.get("SUPABASE_URL") || "";
  const secretKey = Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!projectUrl || !secretKey) return jsonResponse({ error: "Calendar feeds are not configured." }, 503);

  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) return jsonResponse({ error: "Calendar feed not found." }, 404);

  const adminClient = createClient(projectUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await adminClient.rpc("resolve_calendar_feed", { target_token_hash: await sha256(token) });
  if (error) return jsonResponse({ error: "Calendar feed is temporarily unavailable." }, 503);
  if (!validPayload(data)) return jsonResponse({ error: "Calendar feed not found." }, 404);

  try {
    const body = calendarBody(data);
    const bodyHash = await sha256(body);
    const etag = `"${bodyHash}"`;
    const headers = {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="outflow-${data.ledger.id}.ics"`,
      "Cache-Control": "private, no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
    };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
  } catch {
    return jsonResponse({ error: "Calendar feed could not be generated." }, 500);
  }
});
