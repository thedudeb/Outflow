# Shared Ledger Access

**Status:** Implemented contract and protected provider acceptance; external staging deployment pending

Outflow uses three fixed shared-ledger roles. Database Row Level Security and transactional functions enforce the same contract shown by the account UI.

## Permission Matrix

| Capability | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| Read ledger, members, subscriptions, and schedule | Yes | Yes | Yes |
| Add, edit, pause, or delete subscriptions | Yes | Yes | No |
| Rename or delete the ledger | Yes | No | No |
| Invite or remove members | Yes | No | No |
| Change editor/viewer roles | Yes | No | No |
| Leave the ledger | No; transfer is not supported | Yes | Yes |

- Each ledger has exactly one authoritative owner: `ledgers.owner_id`.
- The owner's membership row must retain the `owner` role. Other members can only be `editor` or `viewer`.
- Creating shared ledgers, sending invitations, and changing collaborator roles require the owner's active lifetime Pro entitlement.
- Existing members retain read access if Pro is later refunded or revoked. The owner can still remove members so data control is never gated.
- Shared subscription cards show both the member who originally added the record and the member who last updated it. The configured-service browser contract resolves two distinct member profiles and verifies this attribution in desktop Chromium, mobile Chromium, desktop Firefox, and desktop WebKit.
- Every account can optionally set or remove a 60-character shared display name without Pro. `save_account_profile` normalizes whitespace and can modify only `auth.uid()`; direct browser table updates are not permitted.
- Shared-profile RLS exposes display names, opaque member IDs, roles, and join times to current collaborators. Sign-in emails are never part of the member/profile query, and a missing name falls back to a shortened member identifier rather than an email.
- Profile updates are published through authenticated Realtime. An open shared ledger refreshes member lists and creator/updater labels without advancing the ledger revision or changing browser-local data.

## Invitation Lifecycle

1. A signed-in Pro owner submits an email and `editor` or `viewer` role to the `send-ledger-invite` Edge Function.
2. The function verifies the caller with their bearer token, then asks the RLS-backed `can_invite_to_ledger` function to verify ledger ownership and entitlement.
3. A 256-bit random token is generated server-side. Only its SHA-256 hash is stored in Postgres.
4. Resend sends a private link that expires after seven days. Failed email delivery removes the pending database record.
5. The recipient signs in with the invited email and explicitly accepts the link. `accept_ledger_invitation` verifies the hash, email, expiry, unused state, ledger kind, and owner's current entitlement in one transaction.
6. Acceptance creates or updates the collaborator membership and consumes the invitation. Tokens cannot be reused.

Owners can view invitation metadata but cannot select token hashes. Browsers cannot create or mark invitations accepted directly. A ledger is limited to 25 live invitations, and the same address has a one-minute resend cooldown.

## Automated Browser Contract

`npm run test:account-service` exercises the configured collaboration UI against a stateful PostgREST-compatible fixture at desktop and narrow mobile widths. It proves that:

- A Pro owner can change an editor/viewer role, send a normalized email invitation, revoke it with confirmation, and remove a member; each mutation is reloaded from authoritative service state.
- After a Pro refund, invitation and role controls remain locked while member removal stays available so data control is never paywalled.
- A signed-in recipient can explicitly accept a valid private token, see the newly granted shared-ledger access, and retain the exact serialized local workspace.
- A member can change an optional display name and a second isolated account receives the new shared attribution over Realtime without receiving the member's email or changing either local workspace.
- The authenticated member and invitation panel passes the automated WCAG 2.0, 2.1, and 2.2 A/AA ruleset in both viewport profiles.

The database contract independently verifies owner/editor/viewer RLS, owner invariants, entitlement checks, hashed-token acceptance, recipient-email matching, expiry, one-time use, and deletion behavior through `npm run test:account-foundation`.

`npm run test:staging-messaging-plane` verifies the protected provider harness without network access. Once the staging environment is provisioned, **Staging Messaging Plane** creates two randomized accounts using Resend's labeled delivered test-address contract, calls the deployed invitation function through the owner's real session, retrieves the exact delivered message, checks its bounded content, extracts the private application link, and accepts it as the invited account. Both identities and all database rows are then cascade-deleted. The workflow summary never records an address, account ID, link, token, message body, provider ID, or credential.

## Current Boundary

The browser can list cloud ledger access, manage its email-private shared display name, open a cloud ledger, synchronize Pro-authorized changes, manage members, send invitations, revoke pending invitations, and accept private invite links when Supabase and Resend are configured. The runtime and protected provider acceptance are implemented, but no passing external staging run is recorded and the default build remains fully local. A test-address pass proves the deployed invitation path and one-use acceptance; delivery to human mailbox providers remains a release check. See [Cloud Ledger Synchronization](cloud-sync.md) for revision and conflict behavior.
