# Outflow Account Data Export Contract

Outflow gives every signed-in account a free, versioned JSON export of its portable cloud data. This is separate from CSV and active-ledger backup: CSV is a subscription interchange format, ledger backup preserves one local ledger for restore, and account export captures the account's complete user-visible cloud footprint.

## Envelope

The `export_account_data()` RPC returns a `schemaVersion: 1` document containing:

- Account ID, email, display name, and account/profile timestamps.
- Lifetime-Pro product, status, provider, purchase date, and revocation date when present.
- Email-reminder preference state, timezone, and any current bounded provider-suppression reason.
- Every cloud ledger the account can currently access, including its role, revision, members, pending invitations visible to an owner, and complete subscription records.
- Hosted-calendar metadata owned by the account.
- Email-reminder delivery history with schedule, amount, worker status, provider delivery status, attempt count, and timestamps.

The browser downloads the result as `outflow-account-data-YYYY-MM-DD.json`. Export does not mutate cloud or local data and does not require Pro.

## Privacy Boundary

The database function derives the caller exclusively from `auth.uid()`. It is `security definer` with an empty search path, rejects unauthenticated calls, and manually restricts ledgers to current membership. Pending invitation addresses are included only for ledgers owned by the caller.

The document never contains:

- Authentication or refresh tokens.
- Invitation secrets or hashes.
- Hosted-calendar URL secrets or hashes.
- Stripe checkout, payment-intent, or provider-reference identifiers.
- Resend provider IDs, webhook event IDs, recipient addresses, raw diagnostics, claim tokens, or delivery error codes.
- Idempotency operation IDs, migration hashes, or internal reconciliation events.
- Browser-local ledgers, permissions, alert-delivery deduplication state, or service-worker data.
- Bank or card credentials; Outflow does not collect them.

The browser rejects malformed envelopes and any response containing a prohibited private-service key. Local ledgers remain available through canonical CSV and the [Ledger Backup Contract](ledger-backup.md).

## Verification

`npm run test:account-foundation` proves anonymous rejection, caller isolation after shared-membership removal, complete accessible-ledger coverage, portable subscription/preferences/calendar data, and secret exclusion at the database boundary.

`npm run test:account-service` proves the signed-in account control downloads the JSON envelope across the configured Chromium, Firefox, and WebKit profiles, preserves the exact local workspace, and excludes the private calendar token and service-only fields.
