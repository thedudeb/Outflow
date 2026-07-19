# Outflow Service Provisioning Runbook

**Status:** Repository preflight and protected acceptance workflows ready; external staging project required

Use this runbook for a non-production environment before accounts, hosted calendars, email, or purchases are enabled publicly. Guest mode does not depend on these services.

## 1. Local Release Checks

Install Node dependencies, install Deno 2.8.1, and run:

```sh
npm ci
npm run test:service-readiness
npm run test:function-types
npm run test:function-runtime
npm run test:account-foundation
npm run test:staging-billing-plane
```

`test:service-readiness` enforces the six-function inventory, explicit JWT policy, hosted/local/legacy Supabase key modes, documented environment names, and ordered migration naming. It reports variable names and validation failures, never values. `test:function-runtime` proves named-key precedence, fallback behavior, and opaque-secret header handling without contacting Supabase.

## 2. Prepare The Environment

Create an ignored environment file outside source control from `supabase/functions/.env.example`. Use a 32-character-or-longer random cron secret, exact HTTPS origins, verified sender addresses, a test-mode Stripe Price, and test-mode provider keys.

Validate the complete runtime contract before entering values in provider dashboards:

```sh
node scripts/check-service-readiness.mjs --env-file /absolute/path/to/outflow-stage.env
```

Add `--allow-local` only for a local file that uses `http://localhost` or `http://127.0.0.1`. Never use that switch to approve staging or production configuration.

Supabase injects its reserved `SUPABASE_*` runtime values. Hosted projects should expose JSON key collections named `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS`, each with the selected key under `default`. The local CLI may expose singular keys instead; legacy anon/service-role JWTs remain a migration fallback. Do not include reserved names in `supabase secrets set`. Upload only the custom `OUTFLOW_*`, `RESEND_*`, and `STRIPE_*` entries through the dashboard or a second ignored provider-secrets file.

## 3. Provision Supabase

1. Create a non-production project and link the Supabase CLI to it.
2. Confirm the project exposes its URL plus the named `default` publishable and secret keys to Edge Functions. Use legacy keys only while migrating an existing project.
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

After deployment, run the repository readiness, function type, and function runtime checks again. A JWT or Supabase key-mode change must update both the shared runtime and `scripts/check-service-readiness.mjs` in the same review.

## 6. Probe The Deployed Boundary

After migrations, secrets, and all six functions are deployed, run the non-destructive public boundary probe with the same ignored full-runtime environment file:

```sh
npm run test:staging-boundaries
node scripts/check-staging-boundaries.mjs --env-file /absolute/path/to/outflow-stage.env
```

For durable repository-side records, configure the protected GitHub `staging` environment with these values, then dispatch only the applicable manual workflow:

| GitHub environment entry | Kind | Value |
| --- | --- | --- |
| `OUTFLOW_SUPABASE_URL` | Variable | Exact hosted Supabase project origin |
| `OUTFLOW_APP_URL` | Variable | Staging application HTTPS URL |
| `OUTFLOW_ALLOWED_ORIGINS` | Variable | Comma-separated exact HTTPS origins |
| `OUTFLOW_SUPABASE_PROJECT_REF` | Variable | Exact 20-character staging project reference |
| `OUTFLOW_STRIPE_PRO_PRICE_ID` | Variable | Active fixed one-time Stripe test Price ID |
| `OUTFLOW_SUPABASE_PUBLISHABLE_KEY` | Secret | Browser-safe Supabase publishable key |
| `OUTFLOW_SUPABASE_SECRET_KEY` | Secret | Server-only key used only by authenticated acceptance setup and cleanup |
| `OUTFLOW_STRIPE_SECRET_KEY` | Secret | Stripe test-mode secret used only by billing acceptance |
| `OUTFLOW_STRIPE_WEBHOOK_SECRET` | Secret | Signing secret for the deployed staging webhook endpoint |

The **Staging Boundary** workflow has read-only repository permissions, does not receive the Supabase secret/service-role, Resend, Stripe, webhook, or cron credentials, and runs only by manual dispatch against the protected environment. A successful run writes the commit, actor, project host, app origin, timestamp, and ordered migration inventory to its GitHub summary. That summary is evidence for the public boundary step only; it deliberately does not mark the full staging acceptance matrix complete.

The first command tests the probe itself without network access. The second uses only the project URL, publishable key, application URL, and allowed origins. It sends CORS preflights plus deliberately invalid JWT, Stripe signature, cron-secret, and calendar-token requests. A pass proves:

- All three account-facing functions return exact-origin CORS headers and reject an invalid user JWT at the gateway.
- The Stripe webhook reaches configured code and rejects an invalid signature before fulfillment.
- The reminder worker reaches configured code and rejects an invalid cron bearer secret before claiming deliveries.
- The calendar function can reach its resolver and returns no feed for an unknown private token.

The probe never sends a secret/service-role key, valid session, valid webhook, valid cron secret, or user calendar token. It does not create, update, or delete data. HTTP 404 alone is not accepted for undeployed functions: each endpoint has a distinct expected response.

## 7. Staging Acceptance

After the public boundary passes, manually dispatch **Staging Account Plane**. It requires the protected server-only Supabase key to create two randomized, confirmed synthetic accounts, grant one synthetic test entitlement, and clean up all test identities. The harness refuses to run unless the configured project hostname matches `OUTFLOW_SUPABASE_PROJECT_REF` and `OUTFLOW_ACCEPTANCE_MODE` is the literal workflow-controlled value `staging`.

The authenticated assertions use publishable-key clients and real user sessions. They cover transactional guest migration and replay, pre-membership RLS isolation, private invitation acceptance, viewer denial, editor writes, a filtered hosted Realtime insert delivered to the owner's separate authenticated client, idempotent replay, stale-revision conflicts, member removal, the deployed account-deletion function, and cascade cleanup. The Realtime channel must subscribe before the editor write, receive the exact synthetic subscription, and close before account teardown.

The same run publishes a hosted calendar feed and validates its deployed `GET`, conditional `GET`, and `HEAD` behavior, exact iCalendar identity and recurrence fields, bounded privacy surface, strong ETag, private caching, rotation, metadata redaction, revocation, and indistinguishable old/revoked-token responses. Its GitHub summary contains fixed check names and deployment metadata only. It never records synthetic email addresses, user IDs, passwords, session tokens, invitation tokens, calendar tokens, provider keys, event rows, calendar bodies, or response bodies.

The server-only secret is not passed to the public-boundary job, and no Resend, Stripe, webhook, or cron credential is passed to the boundary or account-plane workflows. Protect the `staging` environment with required reviewers, restrict deployment branches to `main`, and restrict each secret to the workflow step that needs it. The billing job also refuses every dispatched ref except `refs/heads/main` before the environment can release credentials.

After the account plane passes, manually dispatch **Staging Billing Plane**. The harness refuses live Stripe keys and binds itself to the protected project reference plus the literal `staging` mode. It creates one confirmed synthetic account, requests a real open test-mode Checkout Session through the deployed function, and retrieves the canonical Stripe session to verify `mode=payment`, fixed Price, quantity, redirect URLs, test mode, and authenticated user metadata.

The same run creates an unconfirmed test PaymentIntent solely as a resolvable provider object, signs synthetic `checkout.session.completed` and `charge.refunded` payloads with the staging endpoint secret, and sends them to the deployed webhook. It verifies fulfillment, duplicate delivery, restore from a second authenticated session, full-refund revocation, and duplicate refund handling. Finally it expires the open Checkout Session, cancels the unconfirmed PaymentIntent, removes exact synthetic billing rows, and deletes the test identity. It never enters card details or makes a charge.

The billing summary contains fixed check names and deployment metadata only. It excludes identities, credentials, Checkout URLs, Stripe object IDs, signed event bodies, and response bodies. A pass proves the deployed functions share the expected staging Price and signing secret; it does not prove Stripe's outbound endpoint registration or actual Checkout payment delivery.

The local account-service suite performs the same Realtime refresh, stale-edit, and reconnect flow through two isolated browser contexts and a Phoenix-protocol fixture. Repeat it against the provisioned project because the fixture cannot prove publication configuration, network behavior, or hosted authorization.

Complete these tests with synthetic accounts and Stripe test mode:

- Cross-user RLS isolation, guest migration replay, sign-out restoration, and account deletion.
- Owner/editor/viewer invitation, acceptance, revocation, removal, and Pro downgrade behavior.
- Two-browser stale-edit protection and Realtime disconnect/reconnect behavior beyond the account-plane delivery probe.
- Reminder opt-in/out, timezone boundaries, retry/idempotency, pause scope, and refund suspension.
- Actual Stripe-hosted Checkout payment and cancellation, delayed-payment success, and Stripe-originated webhook delivery; the repository billing-plane workflow separately proves signed fulfillment, duplicate handling, restore, and full-refund revocation without making a card charge.
- Hosted calendar import and refresh behavior in Apple Calendar, Google Calendar, Outlook, and a standards-focused iCalendar client; repeat paused scope and refund suspension against the hosted project.

Record the project, deployment commit, migration list, tester, date, and pass/fail result without recording tokens or customer data. Promote only after every applicable matrix is green.

References: [Supabase Edge Function environment variables](https://supabase.com/docs/guides/functions/secrets), [Supabase function configuration](https://supabase.com/docs/guides/functions/function-configuration), [Supabase authorization headers](https://supabase.com/docs/guides/functions/auth-headers), and [Supabase CORS handling](https://supabase.com/docs/guides/functions/cors).
