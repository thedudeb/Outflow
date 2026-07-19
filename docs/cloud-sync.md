# Cloud Ledger Synchronization

**Status:** Implemented runtime, service deployment pending

Outflow keeps browser-local and cloud ledgers as separate data sources. Opening a cloud ledger is explicit, and its totals never merge into the active local ledger. The header always identifies the active storage source, member role, revision, and synchronization state.

Signing in does not synchronize or upload the local workspace. A recovered browser session is accepted only after Supabase Auth verifies its access token; the separate **Create cloud copy** action performs the transactional migration, and the local workspace remains unchanged afterward.

## Write Contract

- Every cloud subscription write sends the complete active ledger snapshot, its expected ledger revision, and a random idempotency key.
- `replace_ledger_snapshot` locks the ledger, verifies authenticated membership and Pro write access, validates the complete payload, and applies additions, edits, pauses, and deletions in one transaction.
- Replaying an idempotency key returns the original result without advancing the revision again.
- A stale expected revision returns `conflict` and changes no subscription data.
- Cloud ledger renames use the same revision and idempotency rules and remain owner-only.
- The browser optimistically renders a write while it is in flight. A network or authorization failure before commit restores the prior snapshot; a conflict rejects the stale write and asks the user to refresh and retry.
- If the transaction commits but its confirmation read fails, Outflow preserves the committed browser snapshot, marks it `stale`, and blocks another edit until an authoritative refresh succeeds.

## Access And Entitlements

- Members retain cloud read access when an entitlement is refunded or revoked.
- Personal cloud-ledger writes require the signed-in user's lifetime Pro entitlement.
- Household and team writes require the ledger owner's lifetime Pro entitlement plus an `owner` or `editor` member role.
- Viewers cannot write. Editors can change subscriptions but cannot rename the ledger or manage ownership.

## Realtime And Editing

Supabase Realtime watches the active ledger, subscriptions, and membership rows. Remote events refresh automatically when no local edit is active. If an edit or write is in progress, Outflow marks the ledger `stale` and requires an explicit refresh so an unfinished form is never silently discarded.

Channel errors, timeouts, and unexpected closures visibly mark the cloud connection `offline`. When the channel resubscribes, Outflow performs an authoritative snapshot refresh; a reconnect during an active edit follows the same `stale` path instead of replacing the form.

The visible runtime states are:

| State | Meaning |
| --- | --- |
| `loading` | Opening the selected cloud ledger |
| `synced` | Browser and server revisions agree and writes are allowed |
| `read-only` | The ledger is readable, but role or entitlement blocks writes |
| `syncing` | A transactional write is in flight |
| `refreshing` | A newer server revision is being loaded |
| `stale` | A remote change arrived during a local edit |
| `conflict` | A stale write was rejected; refresh is required before retrying |
| `offline` | A cloud request or Realtime channel failed; local ledgers remain available |

## Automated Browser Contract

`npm run test:account-service` runs stateful PostgREST- and Phoenix-compatible fixtures at desktop and narrow mobile widths. It verifies that:

- Opening a cloud team ledger replaces, rather than combines with, the active local totals while leaving the serialized local workspace unchanged.
- Shared records display distinct server-resolved creator and updater identities.
- A write sends the full snapshot, expected revision, and a fresh operation UUID, then adopts the confirmed authoritative revision.
- A conflict rejects the optimistic value, loads the server winner, announces the conflict, and blocks another write until refresh.
- Two isolated browser contexts receive protocol-level Realtime changes, refresh to the same server revision, and keep local workspaces separate.
- A remote change during an unfinished edit preserves the form, marks the peer stale, blocks commit, and requires an explicit refresh.
- A dropped Realtime socket becomes visibly offline and an automatic resubscription refreshes changes that occurred during the disconnect.
- Signing out closes the cloud session and restores the untouched local ledger and totals.

The database half of the same contract runs through `npm run test:account-foundation`, covering RLS, roles, idempotent replay, stale revision rejection, attribution storage, and entitlement changes against every migration. These fixtures are a deterministic preflight; the two-browser matrix must still pass against provisioned Supabase Realtime before public synchronization is enabled.

## Offline Boundary

The installable guest tracker and local ledgers remain usable offline. Cloud writes are not queued in this release: failures before commit roll back visibly instead of creating an ambiguous offline mutation queue. A committed write whose confirmation cannot be loaded is retained and marked stale. Durable queued cloud writes require a future operation log, background retry policy, and conflict UX before they can be enabled safely.
