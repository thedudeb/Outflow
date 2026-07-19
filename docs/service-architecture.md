# Outflow Service Architecture

**Status:** Selected, not provisioned
**Decision date:** July 19, 2026

Outflow's account layer uses Supabase for identity, Postgres data, row-level authorization, transactional functions, Realtime, and Edge Functions; Resend for authentication and reminder email; and Stripe Checkout for the direct-web one-time Pro purchase. Guest mode remains fully local and none of these services are required to use the tracker.

## Service Decisions

### Supabase

- Passwordless email sign-in uses Supabase Auth and PKCE through `signInWithOtp`.
- Personal and shared data lives in Postgres with Row Level Security enabled on every exposed table.
- Membership authorization is enforced in database policies, not inferred from client UI.
- Guest migration runs as one authenticated database function and returns an idempotent receipt.
- Shared-ledger invitations use server-generated one-use tokens, database-enforced email matching, and fixed owner/editor/viewer permissions.
- Cloud writes use ledger revisions, idempotent operation IDs, transactional snapshots, and explicit conflict results.
- Realtime observes active ledger, membership, and subscription changes and defers refresh while a local edit is open.
- Account deletion runs in an authenticated Edge Function because deleting an Auth user requires a server-only secret.

References: [Supabase Auth](https://supabase.com/docs/guides/auth), [frontend data security](https://supabase.com/docs/guides/database/secure-data), [Row Level Security](https://supabase.com/features/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions), [Realtime Postgres changes](https://supabase.com/docs/guides/realtime/postgres-changes), and [server-only user deletion](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser).

### Resend

- Resend supplies Supabase authentication email through its managed integration.
- Future charge and trial reminders are sent from authenticated or scheduled Edge Functions.
- The browser never receives a Resend API key.

Reference: [Resend with Supabase](https://resend.com/docs/knowledge-base/getting-started-with-resend-and-supabase).

### Stripe

- Direct-web Pro uses a Stripe-hosted Checkout Session with `mode=payment`, never a Stripe subscription.
- Checkout metadata carries the Outflow user and product identifiers.
- A server webhook verifies the Stripe signature and writes the lifetime entitlement; the success redirect is not trusted as proof of payment.
- Entitlements retain provider and provider-reference fields so native store purchases can be reconciled later. Cross-store transfer remains a launch decision and is not implied by the web purchase.

References: [Stripe Checkout Sessions](https://docs.stripe.com/payments/checkout-sessions), [one-time Checkout](https://docs.stripe.com/payments/checkout/how-checkout-works), [webhook signature verification](https://docs.stripe.com/webhooks), and [fulfillment requirements](https://docs.stripe.com/checkout/fulfillment).

## Browser Configuration

Only these browser-safe values may use Vite's public environment prefix:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

`src/cloud.js` refuses known `sb_secret_` values and legacy JWTs with the `service_role` claim. Supabase secret/service-role keys, Resend keys, Stripe secret keys, and Stripe webhook secrets belong only in server-function secrets.

When browser configuration is absent, the Supabase client is not downloaded or initialized. The account surface reports `Not configured`, and all local functionality continues unchanged.

## Account Lifecycle

1. A guest requests a passwordless email link. No ledger data is included in that request.
2. After authentication, the user sees the number of local ledgers and records that can be uploaded.
3. Upload is explicit. The client calls `migrate_guest_workspace` with the validated versioned workspace.
4. The database validates the entire payload, applies it transactionally, and returns an idempotent receipt.
5. The browser keeps its local workspace. A migration receipt proves only that a cloud copy exists; the user explicitly opens that cloud ledger before synchronization begins.
6. A cloud ledger loads its authoritative revision and exposes a visible sync state. Pro editors write through `replace_ledger_snapshot`; stale writes are rejected without changing server data.
7. A Pro owner can invite an editor or viewer through the authenticated `send-ledger-invite` Edge Function. Acceptance is transactional and restricted to the invited account email.
8. Signing out closes the cloud ledger and returns to the untouched local workspace.
9. Account deletion invokes the authenticated `delete-account` Edge Function. Deleting the Auth user cascades through profiles, memberships, owned ledgers, subscriptions, invitations, entitlements, sync operations, and migration receipts while leaving browser-local data untouched.

## Authorization Model

- `owner`: manages ledger identity, members, invitations, subscriptions, and deletion.
- `editor`: reads the ledger and manages subscriptions.
- `viewer`: reads the ledger and upcoming schedule.
- The ledger owner is the only `owner`; collaborators cannot be promoted into ownership. See [Shared Ledger Access](shared-ledgers.md) for the complete matrix.
- Every remote subscription stores authenticated `created_by` and `updated_by` user IDs. Imported local labels remain separate source-attribution fields and cannot replace authenticated attribution. Those user references become null when an account is deleted so another owner's shared subscription can remain without retaining the deleted identity.
- Entitlements are readable by their owner but writable only by trusted server code.
- Creating or migrating household/team ledgers and issuing invitations requires an active lifetime Pro entitlement in database policy. Existing shared data remains readable after an entitlement is refunded or revoked so access to user-owned records is never held hostage.

## Provisioning Gate

Before enabling accounts in a public build:

1. Provision Supabase and apply the migration under `supabase/migrations`.
2. Deploy `supabase/functions/delete-account` and `supabase/functions/send-ledger-invite` with JWT verification enabled.
3. Configure the server values documented in `supabase/functions/.env.example`, including strict origins, the public app URL, and a verified invitation sender.
4. Connect a verified Resend sending domain to Supabase Auth.
5. Configure permitted Auth redirect URLs for production and local development.
6. Run migration, RLS cross-user isolation, sign-out, and deletion tests against a non-production project.
7. Run two-browser revision conflict, idempotent replay, Realtime refresh, stale-edit, and reconnect tests before describing synchronization as available publicly.
8. Provision Stripe only after account deletion and entitlement ownership tests pass.
