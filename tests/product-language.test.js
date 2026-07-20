import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("customer-facing product copy uses subscription-list language", () => {
  const app = read("src/App.jsx");
  const retiredPhrases = [
    "Ledger controls",
    "Local ledgers",
    "Cloud ledgers",
    "New ledger",
    "Cloud ledger name",
    "Ledger name",
    "Export full ledger",
    "Private ledger invitation",
    "Open your ledger",
    "cloud ledger access",
    "local ledger data",
    "local browser ledgers",
  ];

  retiredPhrases.forEach((phrase) => assert.ok(!app.includes(phrase), `retired phrase remains: ${phrase}`));
  [
    "Subscription lists",
    "On this device",
    "Synced lists",
    "Manage ${ledgerMeta.name} subscriptions",
  ].forEach((phrase) => assert.ok(app.includes(phrase), `preferred phrase is missing: ${phrase}`));
});

test("outbound calendar and email copy uses list and sync language", () => {
  const invitations = read("supabase/functions/send-ledger-invite/index.ts");
  const reminders = read("supabase/functions/send-due-reminders/index.ts");
  const calendar = read("supabase/functions/calendar-feed/calendar.ts");

  assert.match(invitations, /subscription list as/);
  assert.doesNotMatch(invitations, /invited you to the .* ledger as/);
  assert.match(reminders, /`List: /);
  assert.doesNotMatch(reminders, /`Ledger: /);
  assert.match(calendar, /\/ synced`/);
  assert.doesNotMatch(calendar, /cloud ledger/);
});
