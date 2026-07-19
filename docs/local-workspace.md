# Outflow Local Workspace Contract

Outflow stores up to 12 isolated local ledgers in a versioned browser workspace. The workspace supports one personal ledger plus optional household and team ledgers without requiring an account or implying that browser-local data is synchronized.

## Envelope

The workspace is stored under `outflow:workspace`:

```json
{
  "schemaVersion": 1,
  "activeLedgerId": "personal-ledger-id",
  "ledgers": [
    {
      "ledger": {
        "id": "personal-ledger-id",
        "name": "Personal",
        "kind": "personal",
        "storage": "local",
        "createdAt": "2026-07-19T11:00:00.000Z",
        "updatedAt": "2026-07-19T12:00:00.000Z"
      },
      "subscriptions": []
    }
  ]
}
```

Every ledger has its own subscription array. Dashboard totals, forecasts, alerts, CSV operations, backups, and calendar exports read only from the active ledger; Outflow never combines personal and household/team totals implicitly.

Workspace loading requires a supported schema version, exactly one personal ledger, unique ASCII-safe ledger IDs, unique ASCII-safe subscription IDs within each ledger, no more than 12 ledgers, and no more than 500 valid subscriptions per ledger. The envelope is rejected as a unit when any of those invariants fail.

## Legacy Migration

On first launch after this schema ships, Outflow looks for the workspace envelope. If it does not exist, the prior `outflow:subscriptions` and `outflow:ledger-meta` records are validated and moved into a personal workspace ledger. The old records are left untouched as a recovery boundary, but the versioned workspace becomes authoritative for future writes.

If a stored workspace cannot be validated, Outflow attempts the legacy migration path rather than partially loading malformed ledger data.

## Local Collaboration Boundary

- Household and team ledgers are explicitly marked `Local` and `local only`.
- New local household/team ledgers start empty and can be switched from the ledger controls.
- Non-personal ledgers require a two-step confirmation before deletion; the personal ledger cannot be deleted locally.
- Local records attribute user changes to `Local guest`; automatic billing-date advances are attributed to `Outflow`.
- There are no invitations, remote members, permissions, cloud backups, or synchronization claims in this milestone.

## Account Migration Boundary

The selected account service uploads the complete workspace through one transactional migration function using stable ledger and subscription IDs. Server acknowledgement must identify every accepted ledger and revision before any local ledger is marked synchronized. Personal, household, and team membership must remain separate server-side, and remote totals must never be merged merely because the same account can access multiple ledgers. See [service-architecture.md](service-architecture.md).
