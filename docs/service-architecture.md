# Outflow Service Architecture

**Status:** Implemented and deployment-checked; external services not provisioned
**Decision date:** July 19, 2026

Outflow's account layer uses Supabase for identity, Postgres data, row-level authorization, transactional functions, Realtime, and Edge Functions; Resend for authentication and reminder email; and Stripe Checkout for the direct-web one-time Pro purchase. Guest mode remains fully local and none of these services are required to use the tracker.

## Service Decisions

### Supabase

- Passwordless email sign-in uses Supabase Auth and PKCE through `signInWithOtp`.
- A session recovered from browser storage is treated as untrusted until Supabase Auth verifies its access token through `getUser`; the server-verified user replaces the stored user object, and rejected sessions are cleared locally.
- Personal and shared data lives in Postgres with Row Level Security enabled on every exposed table.
- Membership authorization is enforced in database policies, not inferred from client UI.
- Guest migration runs as one authenticated database function and returns an idempotent receipt.
- Shared-ledger invitations use server-generated one-use tokens, database-enforced email matching, and fixed owner/editor/viewer permissions.
- Cloud writes use ledger revisions, idempotent operation IDs, transactional snapshots, and explicit conflict results.
- Realtime observes active ledger, membership, and subscription changes and defers refresh while a local edit is open.
- Account deletion runs in an authenticated Edge Function because deleting an Auth user requires a server-only secret.
- Direct-web Pro uses an authenticated Checkout function and a separate signature-verified Stripe webhook. The browser cannot write billing entitlements; direct-web access is fulfilled only by the webhook.
- Hosted calendars use database-generated one-time secrets, hashed token storage, service-only resolution, and live Pro/membership checks on every fetch. The public feed endpoint never trusts a ledger identifier from the URL.

References: [Supabase Auth](https://supabase.com/docs/guides/auth), [frontend data security](https://supabase.com/docs/guides/database/secure-data), [Row Level Security](https://supabase.com/features/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions), [Realtime Postgres changes](https://supabase.com/docs/guides/realtime/postgres-changes), and [server-only user deletion](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser).

### Resend

- Resend supplies Supabase authentication email through its managed integration.
- Charge and trial reminders are claimed from a durable, RLS-protected delivery ledger by the cron-authenticated `send-due-reminders` Edge Function. Resend idempotency keys protect provider retries.
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

Edge Functions resolve current hosted `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` collections first, singular local-development keys second, and legacy anon/service-role JWTs only as a migration fallback. Modern opaque secret keys are sent only through the `apikey` header; the shared runtime removes the invalid bearer-key header added by the pinned generic client. The readiness check validates the hosted JSON shape and legacy JWT roles without logging key values.

When browser configuration is absent, the Supabase client is not downloaded or initialized. The account surface reports `Not configured`, and all Free-core functionality continues unchanged.

## Account Lifecycle

1. Dismissible account checkpoints can appear after meaningful local activity, backup, sharing, or installation moments. They store only local cadence state and never upload data or block the triggering action. See [Optional Account Onboarding](optional-account-onboarding.md).
2. A guest requests a passwordless email link. No ledger data is included in that request.
3. A returned or recovered session is accepted only after Supabase Auth verifies its access token and user.
4. After authentication, the user sees the number of local ledgers and records that can be uploaded.
5. Upload is explicit. The client calls `migrate_guest_workspace` with the validated versioned workspace.
6. The database validates the entire payload, applies it transactionally, and returns an idempotent receipt.
7. The browser keeps its local workspace. A migration receipt proves only that a cloud copy exists; the user explicitly opens that cloud ledger before synchronization begins.
8. A cloud ledger loads its authoritative revision and exposes a visible sync state. Pro editors write through `replace_ledger_snapshot`; stale writes are rejected without changing server data.
9. A Pro owner can invite an editor or viewer through the authenticated `send-ledger-invite` Edge Function. Acceptance is transactional and restricted to the invited account email. A stateful desktop/mobile browser contract verifies role changes, invitation creation and revocation, member removal after entitlement loss, and private recipient acceptance without local-data mutation.
10. A signed-in free user can review the configured one-time Price and open Stripe-hosted Checkout. The success return polls the server entitlement; only a verified paid webhook activates Pro. Browser coverage proves a pending success remains Free and no client entitlement write occurs.
11. Signing in on another browser restores Pro by reading the durable entitlement without creating checkout. A full Stripe refund revokes only its matching purchase.
12. The same verified entitlement controls reviewed CSV import, new non-USD records, and multiple or custom reminder lead times. Free gates are contextual and do not mutate local data; a downgrade retains existing advanced values but prevents expanding them.
13. A Pro account can independently opt into email reminders, choose its timezone, and include or exclude paused schedules. Subscription lead days drive charge and trial delivery; the scheduler rechecks Pro, membership, and preference state before every claim. The configured browser contract verifies persistence, local device-channel isolation, visible suspension after refund, and an always-available opt-out.
14. A Pro member can publish or rotate a private feed URL for a cloud ledger. Calendar clients see current recurring events while entitlement and membership remain active; the user can change paused scope without rotating or revoke the URL immediately. Browser coverage verifies one-time plaintext disclosure, token-free metadata reloads, suspension, and revocation without local-workspace mutation.
15. Signing out closes the cloud ledger and returns to the untouched local workspace.
16. Account deletion invokes the authenticated `delete-account` Edge Function. Deleting the Auth user cascades through profiles, memberships, owned ledgers, subscriptions, invitations, entitlements, notification preferences and delivery history, hosted calendar feeds, checkout reservations, purchase-to-user links, sync operations, and migration receipts while leaving browser-local data untouched. The configured browser contract verifies two-step deletion from an active cloud ledger, local session removal, and exact local-workspace restoration. De-identified provider event and purchase identifiers remain for payment reconciliation.

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

1. Complete the ordered, secret-safe [Service Provisioning Runbook](service-provisioning.md).
2. Provision Supabase and apply every migration under `supabase/migrations`.
3. Deploy `delete-account`, `send-ledger-invite`, and `create-pro-checkout` with JWT verification enabled.
4. Deploy `stripe-webhook`, `send-due-reminders`, and `calendar-feed` with their function-specific JWT exceptions in `supabase/config.toml`; the webhook verifies Stripe's raw-body signature, the reminder worker verifies its dedicated cron bearer secret, and the calendar endpoint verifies a database-generated private URL token.
5. Configure the server values documented in `supabase/functions/.env.example`, including strict origins, the public app URL, verified invitation/reminder senders, a high-entropy cron secret, and an active fixed one-time Stripe Price.
6. Connect a verified Resend sending domain to Supabase Auth.
7. Configure permitted Auth redirect URLs for production and local development.
8. Run the public staging boundary probe and retain its pass result with the deployment commit.
9. Run migration, RLS cross-user isolation, sign-out, and deletion tests against a non-production project.
10. Repeat the fixture-backed two-browser revision conflict, idempotent replay, Realtime refresh, stale-edit, and reconnect matrix against the provisioned project before describing synchronization as available publicly.
11. Complete the Stripe test-mode matrix in [One-Time Pro Billing](pro-billing.md) before enabling the production Price.
12. Create the hourly reminder invocation with Supabase Cron and Vault, then complete the delivery and retry matrix in [Durable Email Reminders](email-reminders.md).
13. Complete the private-token and client refresh matrix in [Hosted Calendar Feeds](hosted-calendar-feeds.md), with query-token redaction enabled in operational logs.
