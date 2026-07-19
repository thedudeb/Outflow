# Outflow Ledger Backup Contract

Outflow's full-ledger backup is the portable boundary between today's active local ledger and future account synchronization. It preserves that ledger's subscription records, identity metadata, and application-level alert settings without including other local ledgers, browser permissions, or notification history.

## Envelope

```json
{
  "product": "Outflow",
  "schemaVersion": 1,
  "exportedAt": "2026-07-19T12:00:00.000Z",
  "ledger": {
    "id": "c3a68ac1-1ae5-4b50-9d38-f8b78614474c",
    "name": "Personal",
    "kind": "personal",
    "storage": "local",
    "createdAt": "2026-07-19T11:00:00.000Z",
    "updatedAt": "2026-07-19T12:00:00.000Z"
  },
  "alertSettings": {
    "deviceEnabled": false,
    "includePausedSchedules": false
  },
  "subscriptions": []
}
```

Subscription objects use the same normalized fields documented in [csv-format.md](csv-format.md), plus stable `id`, `revision`, `updatedAt`, `createdBy`, and `updatedBy` values. `tags` and `reminderLeadDays` are JSON arrays rather than delimited strings.
Bounded custom reminder values use the same 0-through-365-day, 12-timing limit and survive merge or replacement without being reduced to presets.

## Restore Rules

- Files must identify Outflow, use a supported schema version, remain under 2 MB, and contain no more than 500 subscriptions.
- Ledger and subscription identifiers accept only ASCII letters, numbers, and hyphens; subscription identifiers must be unique within the file.
- Every subscription is sanitized using the same limits as records created inside the tracker. A backup containing an invalid record is rejected as a unit.
- A trial's `nextBillingDate` is its expected first paid charge and cannot precede `trialEndDate`.
- Restore always presents a preview before changing the current ledger.
- **Merge** keeps the current ledger and settings, then adds records whose ID and normalized name/amount/currency/cycle key are both new, up to the remaining 500-record ledger capacity.
- **Replace all** replaces the active ledger's subscriptions, name, and application-level alert settings with the validated backup. Its local workspace slot keeps its existing ID, kind, and storage mode so another ledger cannot be overwritten or impersonated by an imported file.
- Restored active billing dates are advanced to their next valid cycle when necessary. Paused dates remain unchanged.
- Browser notification permission is never granted or transferred by a backup.

## Excluded Data

- Browser permission state
- Previously delivered notification IDs
- Install state and service-worker caches
- CSV import sessions or temporary files
- Other ledgers in the local workspace
- Account credentials, authentication tokens, payment data, and bank information

## Guest-To-Account Migration

A future account migration should consume this envelope through a transactional server operation:

1. Authenticate the user without changing or deleting the local ledger.
2. Validate the local envelope and create the remote personal ledger.
3. Upload records with their stable IDs and receive a server revision for the complete ledger.
4. Compare the acknowledged server record count and revision with the submitted envelope.
5. Mark the ledger as synchronized only after the server acknowledgement succeeds.
6. Retain the local copy for offline use; never clear guest data merely because account creation began.

Account deletion must remove account-held copies without deleting an independent local ledger unless the user separately confirms that local action.

## Automated Backup Contract

Run `npm run test:e2e` to verify backup and restore behavior in desktop and mobile Chromium profiles. The browser suite proves:

- Downloads contain the complete versioned active-ledger envelope, normalized records, alert settings, and unique stable identifiers without browser permission or notification-history data.
- Merge skips both identifier duplicates and normalized content duplicates, adds only new records, preserves the active ledger and alert settings, and survives a reload.
- Replace restores subscriptions, ledger name, and application-level alert settings while retaining the current local slot's identifier, kind, and storage mode.
- A requested device-alert state is not restored when the browser has not granted notification permission.
- Duplicate identifiers and unsupported schema versions produce connected accessible errors and leave the active ledger unchanged.
