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
- Optional display names use a normalized self-scoped database function. Shared-profile RLS exposes names but not account emails, and authenticated Realtime refreshes attribution when a collaborator changes a name.
- Cloud writes use ledger revisions, idempotent operation IDs, transactional snapshots, and explicit conflict results.
- Realtime observes active ledger, membership, and subscription changes and defers refresh while a local edit is open.
- Account data export runs through one authenticated, self-scoped database function and returns only portable user-visible records; browser validation blocks private service fields before download.
- Account deletion runs in an authenticated Edge Function because deleting an Auth user requires a server-only secret.
- Direct-web Pro uses an authenticated Checkout function and a separate signature-verified Stripe webhook. The browser cannot write billing entitlements; direct-web access is fulfilled only by the webhook.
- Hosted calendars use database-generated one-time secrets, hashed token storage, service-only resolution, and live Pro/membership checks on every fetch. The public feed endpoint never trusts a ledger identifier from the URL.
- Pro integrations use revocable personal access tokens whose plaintext is shown once and whose digest is stored in Postgres. The `integrations-api` Edge Function authenticates every request, rechecks entitlement and ledger membership, enforces scoped database functions and rate limits, and never exposes account session credentials. The optional local MCP server delegates to that API, so any external MCP host can receive the subscription data requested through its tools.
- A public read-only service-status RPC exposes one maintenance boolean and timestamp. Only a verified account with the server-assigned `app_metadata.outflow_role=admin` claim can change it; direct table access and the append-only operator audit log remain private. See [Maintenance Mode](maintenance-mode.md).

References: [Supabase Auth](https://supabase.com/docs/guides/auth), [frontend data security](https://supabase.com/docs/guides/database/secure-data), [Row Level Security](https://supabase.com/features/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions), [Realtime Postgres changes](https://supabase.com/docs/guides/realtime/postgres-changes), and [server-only user deletion](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser).

### Resend

- Resend supplies Supabase authentication email through its managed integration.
- Charge and trial reminders are claimed from a durable, RLS-protected delivery ledger by the cron-authenticated `send-due-reminders` Edge Function. Resend idempotency keys protect provider retries, non-2xx responses retain only a bounded status/error-name class for backoff and operations, and successful worker responses attest their exact deployed Git commit.
- Each authenticated worker invocation records a 30-day de-identified aggregate run. A service-only RPC and opt-in hourly workflow classify stale/mismatched workers, completion errors, exhaustion, stuck claims, retry/failure spikes, and suppression growth without exposing financial or identity rows. The monitor uses a dedicated health bearer while the broad database credential remains inside the Edge Function runtime. Critical results synchronize one assigned, privacy-bounded GitHub incident; a healthy result resolves the same incident. See [Reminder Operations](reminder-operations.md).
- A separate raw-body-signature-verified `resend-webhook` records bounded delivery events. Permanent bounces, complaints, and provider suppressions disable the account email channel and refresh the signed-in UI over RLS-filtered Realtime; raw recipients, subjects, and diagnostics are discarded.
- The browser never receives a Resend API key or webhook signing secret.

References: [Resend with Supabase](https://resend.com/docs/knowledge-base/getting-started-with-resend-and-supabase), [webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests), and [email suppressions](https://resend.com/docs/dashboard/emails/email-suppressions).

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
2. A guest explicitly chooses account creation or returning-user sign-in, then requests a passwordless PKCE email link. Only creation may set `create_user`; sign-in and private-invitation entry fail closed against implicit account creation. No ledger data is included in either request.
3. A returned or recovered session is accepted only after Supabase Auth verifies its access token and user.
4. After authentication, the user sees the number of local ledgers and records that can be uploaded.
5. Upload is explicit. The client calls `migrate_guest_workspace` with the validated versioned workspace.
6. The database validates the entire payload, applies it transactionally, and returns an idempotent receipt.
7. The browser keeps its local workspace. A migration receipt proves only that a cloud copy exists; the user explicitly opens that cloud ledger before synchronization begins.
8. A cloud ledger loads its authoritative revision and exposes a visible sync state. Before a Pro editor calls `replace_ledger_snapshot`, the browser stores one bounded account/ledger-bound snapshot with its expected revision and operation UUID. Ambiguous failures retain that exact operation for foreground retry; successful or conflicting responses clear it, and stale writes are rejected without changing server data. The outbox contains no account email, session credential, provider response, or server-only field.
9. An account can optionally set or remove a shared display name without Pro. Collaborators resolve that name only while they share a ledger; account emails remain private, and profile Realtime updates refresh member and change-attribution labels. A Pro owner can then invite an editor or viewer through the authenticated `send-ledger-invite` Edge Function. Acceptance is transactional and restricted to the invited account email. A stateful multi-engine browser contract verifies profile refresh, role changes, invitation creation and revocation, member removal after entitlement loss, and private recipient acceptance without local-data mutation.
10. A signed-in free user can review the configured one-time Price and open Stripe-hosted Checkout. The success return polls the server entitlement; only a verified paid webhook activates Pro. Browser coverage proves a pending success remains Free and no client entitlement write occurs.
11. Signing in on another browser restores Pro by reading the durable entitlement without creating checkout. A full Stripe refund revokes only its matching purchase.
12. The same verified entitlement controls reviewed CSV import, new non-USD records, and multiple or custom reminder lead times. Free gates are contextual and do not mutate local data; a downgrade retains existing advanced values but prevents expanding them.
13. A Pro account can independently opt into email reminders, choose its timezone, and include or exclude paused schedules. Subscription lead days drive charge and trial delivery; the scheduler rechecks Pro, membership, and preference state before every claim. Signed provider bounce, complaint, and suppression events stop email automatically; the configured browser contract verifies live suppression, local device-channel isolation, visible suspension after refund, explicit recovery, and an always-available opt-out.
14. A Pro member can publish or rotate a private feed URL for a cloud ledger. Calendar clients see current recurring events while entitlement and membership remain active; the user can change paused scope without rotating or revoke the URL immediately. Browser coverage verifies one-time plaintext disclosure, token-free metadata reloads, suspension, and revocation without local-workspace mutation.
15. A Pro account can create a time-limited personal access token for the documented REST API and local MCP server. Token plaintext is shown once; the account surface retains only its label, hint, scopes, expiry, status, and last-use time, and supports immediate revocation. API writes preserve authenticated attribution and shared-ledger roles.
16. Every signed-in user can download a versioned JSON archive of identity/profile data, entitlement state, accessible cloud ledgers and subscriptions, collaboration metadata, reminder preferences and history, and hosted-calendar metadata. The function excludes authentication, invitation, calendar, integration, payment, delivery-provider, and idempotency secrets. See [Account Data Export](account-data-export.md).
17. Signing out closes the cloud ledger and returns to the untouched local workspace. A pending cloud operation must first synchronize or be explicitly discarded so cloud snapshot data is not silently orphaned after logout.
18. Account deletion invokes the authenticated `delete-account` Edge Function. Deleting the Auth user cascades through profiles, memberships, owned ledgers, subscriptions, invitations, entitlements, notification preferences and delivery history, hosted calendar feeds, integration tokens, checkout reservations, purchase-to-user links, sync operations, and migration receipts while leaving browser-local data untouched. The configured browser contract verifies two-step deletion from an active cloud ledger, local session removal, and exact local-workspace restoration. De-identified provider event and purchase identifiers remain for payment reconciliation.

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
4. Deploy `stripe-webhook`, `send-due-reminders`, `resend-webhook`, `calendar-feed`, and `integrations-api` with their function-specific JWT exceptions in `supabase/config.toml`; the provider webhooks verify exact raw-body signatures, the reminder worker verifies its dedicated cron bearer secret, the calendar endpoint verifies a database-generated private URL token, and the integration endpoint verifies a hashed personal access token before every request.
5. Configure the server values documented in `supabase/functions/.env.example`, including strict origins, the public app URL, verified invitation/reminder senders, a high-entropy cron secret, both provider webhook secrets, and an active fixed one-time Stripe Price.
6. Connect a verified Resend sending domain to Supabase Auth and register the reminder-event endpoint for delivered, delayed, failed, bounced, complained, and suppressed events.
7. Configure permitted Auth redirect URLs for production and local development.
8. Run the public staging boundary probe and retain its pass result with the deployment commit.
9. Run migration, RLS cross-user isolation, sign-out, and deletion tests against a non-production project.
10. Pass the protected account-plane disconnect, stale-conflict, authoritative catch-up, and post-reconnect delivery sequence, then pass **Staging Browser Sync** durable write persistence, exact reload replay and cleanup, conflict recovery, and reconnect catch-up in desktop Chromium, mobile Chromium, desktop Firefox, and desktop WebKit before describing synchronization as available publicly; complete the branded-browser checks in [Browser Compatibility Contract](browser-compatibility.md) before broad support claims.
11. Pass the protected signed-event billing-plane workflow, then complete the actual Stripe-hosted payment and provider-originated delivery matrix in [One-Time Pro Billing](pro-billing.md) before enabling the production Price.
12. Create the hourly reminder invocation with Supabase Cron and Vault, then pass the exact-commit deployment, concurrent-worker isolation, delivery, planned provider-failure/retry, signed bounce/complaint suppression, recovery, and aggregate operations matrix in [Durable Email Reminders](email-reminders.md); prove the named operator-notification path before production.
13. Complete the private-token and client refresh matrix in [Hosted Calendar Feeds](hosted-calendar-feeds.md), with query-token redaction enabled in operational logs.
14. Complete the authenticated personal-token API and MCP matrix in [API and MCP Integrations](integrations.md), including expiry, revocation, rate limiting, maintenance mode, shared-role enforcement, and external-client privacy disclosure.
