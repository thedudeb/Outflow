# Outflow Calendar Export Contract

Outflow exports a standards-based iCalendar (`.ics`) file containing one recurring all-day event per selected subscription. The file is generated locally and does not transmit ledger data to Outflow or a calendar provider.

## Event Mapping

| Outflow field | iCalendar field |
| --- | --- |
| Subscription and ledger IDs | `UID` |
| Subscription revision | `SEQUENCE` |
| Subscription update timestamp | `LAST-MODIFIED` |
| Next billing date | All-day `DTSTART` |
| Billing cycle | `RRULE` with `WEEKLY`, `MONTHLY`, or `YEARLY` frequency |
| Name and amount | `SUMMARY` |
| Cycle and ledger identity | `DESCRIPTION` |
| Outflow and subscription category | `CATEGORIES` |
| Active or paused state | `CONFIRMED` or `TENTATIVE` status |

Events are classified `PRIVATE`, marked `TRANSPARENT`, and use `FREE` busy status so projected charges do not block time on a user's calendar.

## Stable Updates

The event UID is stable for the life of a subscription and includes both its subscription ID and ledger ID:

```text
{subscriptionId}.{ledgerId}@outflow.local
```

Editing a subscription, changing its pause state, or automatically advancing a passed billing date increments its revision and updates its modification timestamp. A new export therefore carries the same UID with a higher sequence and the changed start date. Calendar clients that apply standard UID/sequence update semantics can update the existing recurring event rather than create a second identity.

A downloaded file is not a hosted subscription feed. Users must import the newer file for changes to reach an external calendar, and individual calendar products may handle repeated file imports differently. Automatic publishing and provider-side updates require the future account service.

## Paused Schedules

Paused subscriptions are excluded by default. Users may explicitly include them in the export preview; included paused schedules are marked `TENTATIVE` and remain identifiable in the description.

## Privacy Boundary

Calendar exports include only subscription name, amount, currency, cycle, category, next billing date, status, and local ledger identity. They exclude tags, trial dates, reminder rules, account credentials, browser permissions, payment details, and bank information.
