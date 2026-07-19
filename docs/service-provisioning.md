# Outflow Service Provisioning Runbook

**Status:** Repository preflight ready; external staging project required

Use this runbook for a non-production environment before accounts, hosted calendars, email, or purchases are enabled publicly. Guest mode does not depend on these services.

## 1. Local Release Checks

Install Node dependencies, install Deno 2.8.1, and run:

```sh
npm ci
npm run test:service-readiness
npm run test:function-types
npm run test:account-foundation
```

`test:service-readiness` enforces the six-function inventory, explicit JWT policy, documented environment names, and ordered migration naming. It reports variable names and validation failures, never values.

## 2. Prepare The Environment

Create an ignored environment file outside source control from `supabase/functions/.env.example`. Use a 32-character-or-longer random cron secret, exact HTTPS origins, verified sender addresses, a test-mode Stripe Price, and test-mode provider keys.

Validate the complete runtime contract before entering values in provider dashboards:

```sh
node scripts/check-service-readiness.mjs --env-file /absolute/path/to/outflow-stage.env
```

Add `--allow-local` only for a local file that uses `http://localhost` or `http://127.0.0.1`. Never use that switch to approve staging or production configuration.

Supabase injects its reserved `SUPABASE_*` runtime values. Do not include those names in `supabase secrets set`. Upload only the custom `OUTFLOW_*`, `RESEND_*`, and `STRIPE_*` entries through the dashboard or a second ignored provider-secrets file.

## 3. Provision Supabase

1. Create a non-production project and link the Supabase CLI to it.
2. Confirm the project exposes its URL, publishable/anon key, and secret/service-role key to Edge Functions.
3. Apply every migration in `supabase/migrations` in filename order.
4. Confirm Row Level Security is enabled on every exposed table.
5. Configure the production app origin and explicit local callback in Auth redirect URLs.
6. Configure Realtime for the tables named in `docs/cloud-sync.md`.

Do not enable a public account entry point until the cross-user isolation matrix passes.

## 4. Configure Providers

1. Verify the Resend sending domain and connect Resend to Supabase Auth email.
2. Create a fixed, one-time Stripe test Price and configure its ID.
3. Add the Stripe webhook endpoint for `stripe-webhook` and subscribe to the payment/refund events in `docs/pro-billing.md`.
4. Put the Stripe webhook signing secret, provider keys, senders, app URL, exact origins, and cron secret in Edge Function secrets.
5. Store the reminder endpoint and cron bearer secret in Supabase Vault; schedule the worker hourly.

No provider key belongs in a `VITE_*` variable, browser bundle, test fixture, log, issue, or commit.

## 5. Deploy Functions

Deploy from the repository root so `supabase/config.toml` supplies the reviewed policy:

| Function | Gateway JWT | Independent authentication |
| --- | --- | --- |
| `delete-account` | Required | Verified user plus server-side admin action |
| `send-ledger-invite` | Required | Verified user plus database authorization |
| `create-pro-checkout` | Required | Verified user plus database entitlement checks |
| `stripe-webhook` | Disabled | Stripe raw-body signature |
| `send-due-reminders` | Disabled | Dedicated cron bearer secret |
| `calendar-feed` | Disabled | Hashed, revocable feed token |

After deployment, run the repository readiness and function type checks again. A JWT change must update both `supabase/config.toml` and `scripts/check-service-readiness.mjs` in the same review.

## 6. Staging Acceptance

Complete these tests with synthetic accounts and Stripe test mode:

- Cross-user RLS isolation, guest migration replay, sign-out restoration, and account deletion.
- Owner/editor/viewer invitation, acceptance, revocation, removal, and Pro downgrade behavior.
- Two-browser conflict, idempotent write replay, Realtime refresh, stale edit, and reconnect behavior.
- Reminder opt-in/out, timezone boundaries, retry/idempotency, pause scope, and refund suspension.
- Checkout success without webhook, signed fulfillment, duplicate webhook, restore, and full refund revocation.
- Hosted calendar publication, one-time URL disclosure, refresh, rotation, pause scope, refund suspension, and revocation.

Record the project, deployment commit, migration list, tester, date, and pass/fail result without recording tokens or customer data. Promote only after every applicable matrix is green.

References: [Supabase Edge Function environment variables](https://supabase.com/docs/guides/functions/secrets), [Supabase function configuration](https://supabase.com/docs/guides/functions/function-configuration), and [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth).
