# Hosted Calendar Feeds

Outflow Pro accounts can publish one private iCalendar feed per cloud ledger. The feed is a pull-based subscription: calendar clients fetch the same URL again and receive current cloud subscription revisions without the user repeatedly importing a downloaded file.

## Security Contract

- Publishing requires an authenticated account with active lifetime Pro and current membership in the target ledger.
- The database generates a 256-bit random URL token and returns it only during publication or rotation. Only its SHA-256 hash is stored.
- Feed metadata never returns the token. A user who loses the URL rotates the feed and receives a new one; the old URL stops resolving immediately.
- The unauthenticated `calendar-feed` Edge Function accepts only `GET` and `HEAD`, hashes the supplied token, and resolves it through a service-only database function.
- Every fetch rechecks the publisher's active Pro entitlement and ledger membership. Membership removal also deletes that member's feed immediately, so a later re-invitation cannot reactivate the old URL. Refunds, revocation, feed revocation, ledger deletion, and account deletion all stop access without waiting for a client refresh.
- Feed URLs are credentials. They must not be placed in analytics, support logs, screenshots, or public links. Calendar clients necessarily receive the URL in order to refresh it.

`verify_jwt` is disabled only for this function because external calendar clients do not have an Outflow session. The random token is verified in the handler before any ledger data is returned. Invalid, rotated, suspended, and revoked tokens receive the same not-found response.

## Calendar Contract

The hosted feed preserves the local export identity model:

| Property | Value |
| --- | --- |
| `UID` | `<subscription-id>.<ledger-id>@outflow.local` |
| `SEQUENCE` | Subscription revision |
| `DTSTART` | Saved next billing date, as an all-day date |
| `DTEND` | Exclusive following date |
| `RRULE` | Weekly, monthly, or yearly billing cycle |
| `CLASS` | `PRIVATE` |
| `TRANSP` | `TRANSPARENT` |
| `STATUS` | `CONFIRMED`, or `TENTATIVE` for included paused schedules |

Stable UIDs and increasing subscription revisions allow clients to update an existing event when its amount, date, status, or other visible field changes. `DTSTAMP` and `LAST-MODIFIED` are both derived from the stored subscription update timestamp, so an unchanged revision serializes byte-for-byte identically across requests. The feed uses private, revalidated caching, emits a stable body-derived `ETag`, and honors `If-None-Match` so rotation and revocation are checked before cached data is reused. It includes only subscription name, amount/currency, cycle, category, date, pause state, and ledger name/kind. Tags, reminders, account identity, members, payment data, and bank data are excluded.

## User Lifecycle

1. Open a synchronized cloud ledger and choose calendar export.
2. Select whether paused schedules belong in the hosted feed.
3. Publish and save the one-time secret HTTPS URL in an external calendar's subscription field.
4. Change scope without changing the URL, or rotate the URL if it may have been exposed.
5. Revoke the feed to disable it immediately.

A downloaded `.ics` file remains available for local and cloud ledgers without publishing anything. Hosted feeds are never created automatically.

## Automated Browser Contract

`npm run test:account-service` exercises the hosted-calendar UI against a stateful RPC fixture in desktop and mobile Chromium profiles. It verifies explicit publication, a token-only private URL, WCAG A/AA compliance in the authenticated published state, scope changes without token rotation, deliberate rotation to a new token, and two-step revocation.

Closing and reopening the dialog recovers only feed metadata: the plaintext URL is absent and metadata requests contain neither the current nor prior token. After a simulated Pro refund, the feed is visibly suspended, mutation controls are locked, revocation remains available for data control, and the serialized browser-local workspace remains unchanged.

The PostgreSQL contract separately proves hashed-token storage, old-token invalidation, live entitlement and membership checks, scope behavior, and revocation through `npm run test:account-foundation`.

The pinned Edge runtime contract in `npm run test:function-runtime` proves unchanged payloads serialize byte-for-byte identically, with absolute UTC `DTSTAMP` and `LAST-MODIFIED` values derived from stored data. The protected staging account-plane workflow then verifies the deployed function's body-derived ETag, conditional `GET`, `HEAD`, token rotation, and revocation lifecycle without recording URLs or response bodies.

## Deployment Checks

1. Apply `20260720143000_hosted_calendar_feeds.sql` and deploy `calendar-feed` with its function-specific configuration in `supabase/config.toml`.
2. Publish in a test account and confirm the plaintext token is absent from `calendar_feeds` and application logs.
3. Validate initial import and update behavior in Apple Calendar, Google Calendar, Outlook, and a standards-focused iCalendar client.
4. Verify conditional `GET`, `HEAD`, empty feeds, paused scope, rotation, revocation, refund, membership removal, ledger deletion, and account deletion.
5. Confirm malformed and old tokens reveal no ledger metadata and that monitoring redacts the `token` query parameter.

References: [RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545) and [Supabase function configuration](https://supabase.com/docs/guides/functions/function-configuration).
