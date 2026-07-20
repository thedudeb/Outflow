# Subscription List Synchronization

**Status:** Implemented runtime plus protected hosted service/browser acceptance harnesses; external staging deployment pending

Outflow keeps lists on this device and synchronized lists as separate data sources. Opening a synchronized list is explicit, and its totals never merge into the active list on this device. The header always identifies the active storage source, member role, version, and synchronization state.

Signing in does not synchronize or upload the local workspace. A recovered browser session is accepted only after Supabase Auth verifies its access token; the separate **Create cloud copy** action performs the transactional migration, and the local workspace remains unchanged afterward.

## Write Contract

- Every cloud subscription write sends the complete active-list snapshot, its expected list version, and a random idempotency key.
- `replace_ledger_snapshot` locks the ledger, verifies authenticated membership and Pro write access, validates the complete payload, and applies additions, edits, pauses, and deletions in one transaction.
- Replaying an idempotency key returns the original result without advancing the revision again.
- A stale expected revision returns `conflict` and changes no subscription data.
- Synchronized-list renames use the same version and idempotency rules and remain owner-only.
- Before sending a subscription write, the browser durably stores the exact account-bound snapshot, expected revision, and idempotency key. The optimistic snapshot remains visible if the response is lost, and the same immutable operation is retried after an online event, Realtime recovery, reopening the ledger, or an explicit retry.
- A confirmed application clears the local recovery operation. A stale expected revision clears the rejected operation, loads the authoritative server winner, and requires review before another edit.
- Ledger renames retain their immediate online-only boundary; they are never mixed into the subscription-snapshot outbox.
- If the transaction commits but its confirmation read fails, Outflow preserves the committed browser snapshot, marks it `stale`, and blocks another edit until an authoritative refresh succeeds.

## Access And Entitlements

- Members retain cloud read access when an entitlement is refunded or revoked.
- Personal cloud-ledger writes require the signed-in user's lifetime Pro entitlement.
- Household and team writes require the ledger owner's lifetime Pro entitlement plus an `owner` or `editor` member role.
- Viewers cannot write. Editors can change subscriptions but cannot rename the ledger or manage ownership.

## Realtime And Editing

Supabase Realtime watches the active list, subscriptions, membership rows, and readable shared-profile updates. A separate self-filtered account channel watches notification-preference changes so provider suppression can stop and update email controls without a reload. List events refresh automatically when no local edit is active; profile and notification changes never advance the list version. If a list edit or write is in progress, Outflow marks the list `stale` and requires an explicit refresh so an unfinished form is never silently discarded.

Channel errors, timeouts, and unexpected closures visibly mark the cloud connection `offline`. When the channel resubscribes, Outflow performs an authoritative snapshot refresh; a reconnect during an active edit follows the same `stale` path instead of replacing the form.

The visible runtime states are:

| State | Meaning |
| --- | --- |
| `loading` | Opening the selected synchronized list |
| `synced` | Browser and server revisions agree and writes are allowed |
| `read-only` | The list is readable, but role or entitlement blocks writes |
| `syncing` | A transactional write is in flight |
| `refreshing` | A newer server revision is being loaded |
| `queued` | One exact subscription snapshot is saved on this device for idempotent retry or explicit discard |
| `stale` | A remote change arrived during a local edit |
| `conflict` | A stale write was rejected; refresh is required before retrying |
| `offline` | A cloud request or Realtime channel failed; lists on this device remain available |

## Automated Browser Contract

`npm run test:account-service` runs stateful PostgREST- and Phoenix-compatible fixtures in desktop Chromium, mobile Chromium, desktop Firefox, and desktop WebKit. It verifies that:

- Opening a cloud team ledger replaces, rather than combines with, the active local totals while leaving the serialized local workspace unchanged.
- Shared records display distinct server-resolved creator and updater identities.
- A normalized self-profile update reaches a second isolated collaborator over Realtime, updates shared attribution, exposes no account email, and leaves both local workspaces byte-for-byte unchanged.
- A write sends the full snapshot, expected revision, and a fresh operation UUID, then adopts the confirmed authoritative revision.
- A failed write remains visible and survives reload, replays the same operation UUID, commits once, and removes its browser recovery record.
- A queued retry that races a remote revision fails closed to the authoritative server copy; sign-out is blocked until the operation is synchronized or explicitly discarded.
- A conflict rejects the optimistic value, loads the server winner, announces the conflict, and blocks another write until refresh.
- Two isolated browser contexts receive protocol-level Realtime changes, refresh to the same server revision, and keep local workspaces separate.
- A remote change during an unfinished edit preserves the form, marks the peer stale, blocks commit, and requires an explicit refresh.
- A dropped Realtime socket becomes visibly offline and an automatic resubscription refreshes changes that occurred during the disconnect.
- Signing out closes the cloud session and restores the untouched list and totals on this device.

The database half of the same contract runs through `npm run test:account-foundation`, covering RLS, roles, idempotent replay, stale revision rejection, attribution storage, and entitlement changes against every migration. These fixtures are a deterministic preflight; the multi-engine two-browser matrix must still pass against provisioned Supabase Realtime before public synchronization is enabled. See [Browser Compatibility Contract](browser-compatibility.md) for engine-specific evidence boundaries.

## Protected Hosted Contract

`npm run test:staging-account-plane` validates the hosted acceptance harness without network access. Once the protected Supabase staging project is provisioned, **Staging Account Plane** uses separate authenticated owner and editor clients against the deployed database and Realtime service. After the initial insert reaches the owner, the harness explicitly removes that channel, commits revision 2 through the editor, rejects the owner's revision-1 write without changing server data, and reloads the authoritative revision-2 amount and updater. It then subscribes a fresh filtered channel, commits revision 3, requires the exact `UPDATE` event, reloads the matching revision-3 snapshot, and closes the channel before account teardown.

The fixed workflow report records only named checks and deployment metadata. It does not record account IDs, row payloads, operation IDs, session credentials, or Realtime messages. This proves the hosted authorization, revision, catch-up, and transport sequence through two service clients.

`npm run test:staging-browser-sync` validates the protected browser harness without network access. After the account plane passes, manually dispatch **Staging Browser Sync** from `main`. It creates a fresh owner/editor pair and shared list per profile, recovers each real session inside an isolated browser context, and runs the deployed UI in desktop Chromium, mobile Chromium, desktop Firefox, and desktop WebKit. The sequence aborts one subscription write before it reaches Supabase, requires the exact bounded operation to persist without credentials or identity data, reloads the deployed UI, replays the same operation UUID and snapshot, verifies one server application, and requires local cleanup. It then proves hosted refresh, unfinished-form preservation with visible `stale`, explicit recovery, server-rejected `conflict`, visible `offline` after closing the browser Realtime transport, missed-write catch-up after automatic resubscription, and a final `synced` state. The harness disables browser artifacts and writes only a fixed, identity-free summary. No passing external staging run is recorded in the repository yet, and Playwright WebKit does not replace a branded Safari release pass.

## Offline Boundary

The installable guest tracker and lists on this device remain usable offline. Cloud subscription writes use a deliberately narrow browser outbox rather than a general merge queue:

- At most eight account/ledger-bound operations may exist in the browser, with a 2 MiB total serialized ceiling and no session tokens, emails, provider errors, or service fields.
- Each list can hold only one immutable pending operation. Additional editing, list switching, cloud closing, and sign-out are blocked until that operation synchronizes or the user confirms discard.
- Retry always reuses the original operation UUID and expected revision. The database therefore returns the original applied result or a non-mutating conflict; Outflow never rebases or silently merges the snapshot.
- Explicit discard removes the browser operation and returns to the untouched list on this device. Account deletion removes matching recovery operations after the server deletion succeeds.
- A committed write whose confirmation snapshot cannot be loaded is marked `stale`; this is separate from an ambiguous request whose exact operation remains `queued`.

The outbox retries while Outflow is open and when its synchronized list is reopened. It is not a background-sync promise, and synchronized-list renames remain online-only.
