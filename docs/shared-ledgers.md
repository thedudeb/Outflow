# Shared Ledger Access

**Status:** Implemented contract, service deployment pending

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

## Invitation Lifecycle

1. A signed-in Pro owner submits an email and `editor` or `viewer` role to the `send-ledger-invite` Edge Function.
2. The function verifies the caller with their bearer token, then asks the RLS-backed `can_invite_to_ledger` function to verify ledger ownership and entitlement.
3. A 256-bit random token is generated server-side. Only its SHA-256 hash is stored in Postgres.
4. Resend sends a private link that expires after seven days. Failed email delivery removes the pending database record.
5. The recipient signs in with the invited email and explicitly accepts the link. `accept_ledger_invitation` verifies the hash, email, expiry, unused state, ledger kind, and owner's current entitlement in one transaction.
6. Acceptance creates or updates the collaborator membership and consumes the invitation. Tokens cannot be reused.

Owners can view invitation metadata but cannot select token hashes. Browsers cannot create or mark invitations accepted directly. A ledger is limited to 25 live invitations, and the same address has a one-minute resend cooldown.

## Current Boundary

The browser can list cloud ledger access, open a cloud ledger, synchronize Pro-authorized changes, manage members, send invitations, revoke pending invitations, and accept private invite links when Supabase and Resend are configured. The runtime is implemented but the services are not deployed, and the default build remains fully local. See [Cloud Ledger Synchronization](cloud-sync.md) for revision and conflict behavior.
