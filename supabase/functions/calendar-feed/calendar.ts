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

export type FeedPayload = {
  feedId: string;
  includePaused: boolean;
  ledger: {
    id: string;
    name: string;
    kind: "personal" | "household" | "team";
  };
  subscriptions: FeedSubscription[];
};

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

function calendarTimestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid calendar timestamp.");
  return date.getTime();
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

export function validPayload(value: unknown): value is FeedPayload {
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

export function calendarBody(payload: FeedPayload) {
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
    // ics supports this runtime field although its 3.12 declaration omits it.
    timestamp: calendarTimestamp(subscription.updatedAt),
    lastModified: calendarTimestamp(subscription.updatedAt),
  })), {
    productId: "Outflow Subscription Tracker",
    calName: `Outflow / ${calendarText(payload.ledger.name)}`,
    method: "PUBLISH",
  });
  if (error || !value) throw error || new Error("Calendar generation failed.");
  return value;
}
