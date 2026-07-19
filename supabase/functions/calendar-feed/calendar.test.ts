import { calendarBody, type FeedPayload, validPayload } from "./calendar.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const payload: FeedPayload = {
  feedId: "11111111-1111-4111-8111-111111111111",
  includePaused: false,
  ledger: {
    id: "accept-team",
    name: "Acceptance Team",
    kind: "team",
  },
  subscriptions: [{
    id: "accept-editor",
    name: "Editor Acceptance",
    amount: 33,
    currency: "USD",
    cycle: "monthly",
    nextBillingDate: "2026-08-19",
    category: "Acceptance",
    paused: false,
    revision: 2,
    updatedAt: "2026-07-19T12:34:00.000Z",
  }],
};

Deno.test("calendar serialization is byte-stable for a stored subscription revision", () => {
  assert(validPayload(payload), "fixture should satisfy the calendar payload boundary");
  const first = calendarBody(payload);
  const second = calendarBody(structuredClone(payload));
  assert(first === second, "identical stored payloads generated different calendar bodies");
  assert(first.includes("DTSTAMP:20260719T123400Z\r\n"), "DTSTAMP was not derived from the stored update timestamp");
  assert(first.includes("LAST-MODIFIED:20260719T123400Z\r\n"), "LAST-MODIFIED was not derived from the stored update timestamp");
  assert(first.includes("SEQUENCE:2\r\n"), "subscription revision was not preserved");
});

Deno.test("calendar payload validation rejects invalid timestamps before serialization", () => {
  const invalid = structuredClone(payload);
  invalid.subscriptions[0].updatedAt = "not-a-timestamp";
  assert(!validPayload(invalid), "invalid timestamp passed the calendar payload boundary");
});
