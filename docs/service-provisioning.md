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
npm run test:staging-account-plane
npm run test:staging-browser-sync
npm run test:staging-billing-plane
npm run test:staging-messaging-plane
npm run test:reminder-operations
```

`test:service-readiness` enforces the seven-function inventory, explicit JWT policy, hosted/local/legacy Supabase key modes, documented environment names, and ordered migration naming. It reports variable names and validation failures, never values. `test:function-runtime` proves named-key precedence, fallback behavior, raw-body Resend signature verification, bounded provider-event parsing, allowlisted/bounded provider-error classification, and opaque-secret header handling without contacting Supabase.

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

1. Verify the Resend sending domain, connect Resend to Supabase Auth email, and register the deployed `resend-webhook` endpoint for delivered, delayed, failed, bounced, complained, and suppressed email events.
2. Create a fixed, one-time Stripe test Price and configure its ID.
3. Add the Stripe webhook endpoint for `stripe-webhook` and subscribe to the payment/refund events in `docs/pro-billing.md`.
4. Put the Stripe and Resend webhook signing secrets, provider keys, senders, app URL, exact origins, and cron secret in Edge Function secrets.
5. Enable Supabase Cron and `pg_net`; create the uniquely named `outflow_reminder_endpoint` and `outflow_cron_secret` Vault entries; then register `outflow-due-reminders-hourly` at `7 * * * *` with the exact command `select public.invoke_due_reminder_worker();`. See `docs/email-reminders.md` for the reviewed SQL and rotation procedure.

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
| `resend-webhook` | Disabled | Svix raw-body signature and timestamp |
| `calendar-feed` | Disabled | Hashed, revocable feed token |

After deployment, run the repository readiness, function type, and function runtime checks again. A JWT or Supabase key-mode change must update both the shared runtime and `scripts/check-service-readiness.mjs` in the same review.

## 6. Probe The Deployed Boundary

After migrations, secrets, and all seven functions are deployed, run the non-destructive public boundary probe with the same ignored full-runtime environment file:

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
| `OUTFLOW_INVITE_FROM` | Variable | Verified named invitation sender |
| `OUTFLOW_REMINDER_FROM` | Variable | Verified named reminder sender |
| `OUTFLOW_SUPABASE_PROJECT_REF` | Variable | Exact 20-character staging project reference |
| `OUTFLOW_STRIPE_PRO_PRICE_ID` | Variable | Active fixed one-time Stripe test Price ID |
| `OUTFLOW_SUPABASE_ACCESS_TOKEN` | Secret | Deployment token scoped to the staging Supabase project |
| `OUTFLOW_SUPABASE_DB_PASSWORD` | Secret | Staging database password used only for migration deployment |
| `OUTFLOW_SUPABASE_PUBLISHABLE_KEY` | Secret | Browser-safe Supabase publishable key |
| `OUTFLOW_SUPABASE_SECRET_KEY` | Secret | Server-only key used only by authenticated acceptance setup and cleanup |
| `OUTFLOW_STRIPE_SECRET_KEY` | Secret | Stripe test-mode secret used only by billing acceptance |
| `OUTFLOW_STRIPE_WEBHOOK_SECRET` | Secret | Signing secret for the deployed staging webhook endpoint |
| `OUTFLOW_RESEND_API_KEY` | Secret | Resend key used only to inspect synthetic test-address delivery receipts |
| `OUTFLOW_RESEND_WEBHOOK_SECRET` | Secret | Signing secret for the deployed staging Resend webhook endpoint |
| `OUTFLOW_CRON_SECRET` | Secret | Dedicated reminder-worker bearer used only by messaging acceptance |
| `OUTFLOW_OPERATIONS_SECRET` | Secret | Separate reminder-health bearer used only by the operations monitor and messaging deployment |

After the staging worker and hourly scheduler are proven, set the repository-level Actions variable `OUTFLOW_OPERATIONS_ENABLED` to the literal value `true`. It intentionally lives outside the `staging` environment because GitHub evaluates the scheduled job gate before granting environment access. Keep the dedicated operations secret in the protected `staging` environment and ensure it differs from `OUTFLOW_CRON_SECRET`.

The **Staging Boundary** workflow has read-only repository permissions, does not receive the Supabase secret/service-role, Resend, Stripe, webhook, or cron credentials, and runs only by manual dispatch against the protected environment. A successful run writes the commit, actor, project host, app origin, timestamp, and ordered migration inventory to its GitHub summary. That summary is evidence for the public boundary step only; it deliberately does not mark the full staging acceptance matrix complete.

The first command tests the probe itself without network access. The second uses only the project URL, publishable key, application URL, and allowed origins. It sends CORS preflights plus deliberately invalid JWT, Stripe signature, Resend signature, cron-secret, and calendar-token requests. A pass proves:

- All three account-facing functions return exact-origin CORS headers and reject an invalid user JWT at the gateway.
- The Stripe webhook reaches configured code and rejects an invalid signature before fulfillment.
- The reminder worker reaches configured code and rejects an invalid cron bearer secret before claiming deliveries.
- The Resend webhook reaches configured code and rejects an invalid Svix signature before parsing or recording an event.
- The calendar function can reach its resolver and returns no feed for an unknown private token.

The probe never sends a secret/service-role key, valid session, valid webhook, valid cron secret, or user calendar token. It does not create, update, or delete data. HTTP 404 alone is not accepted for undeployed functions: each endpoint has a distinct expected response.

## 7. Staging Acceptance

After the public boundary passes, manually dispatch **Staging Account Plane**. It requires the protected server-only Supabase key to create two randomized, confirmed synthetic accounts, grant one synthetic test entitlement, and clean up all test identities. The harness refuses to run unless the configured project hostname matches `OUTFLOW_SUPABASE_PROJECT_REF` and `OUTFLOW_ACCEPTANCE_MODE` is the literal workflow-controlled value `staging`.

The authenticated assertions use publishable-key clients and real user sessions. They cover transactional guest migration and replay, pre-membership RLS isolation, private invitation acceptance, normalized self-profile writes, shared-profile RLS, a filtered profile Realtime update, viewer denial, editor writes, a filtered hosted Realtime insert delivered to the owner's separate authenticated client, idempotent replay, member removal, the deployed account-deletion function, and cascade cleanup. The profile channel subscribes only after shared membership exists, receives the exact member update, and is explicitly removed. The subscription channel must subscribe before revision 1, receive the exact insert, and also be explicitly removed. Revision 2 is then committed while the owner is disconnected; the owner's stale revision-1 write must conflict, and an authoritative read must recover revision 2 with the editor's value and attribution. A fresh channel must subscribe before revision 3, receive the exact update, recover the matching snapshot, and close before account teardown.

The same run publishes a hosted calendar feed and validates its deployed `GET`, conditional `GET`, and `HEAD` behavior, exact iCalendar identity and recurrence fields, bounded privacy surface, strong ETag, private caching, rotation, metadata redaction, revocation, and indistinguishable old/revoked-token responses. Its GitHub summary contains fixed check names and deployment metadata only. It never records synthetic email addresses, user IDs, passwords, session tokens, invitation tokens, calendar tokens, provider keys, event rows, calendar bodies, or response bodies.

The server-only secret is not passed to the public-boundary job, and no Resend, Stripe, webhook, or cron credential is passed to the boundary or account-plane workflows. Protect the `staging` environment with required reviewers, restrict deployment branches to `main`, and restrict each secret to the workflow step that needs it. The billing job also refuses every dispatched ref except `refs/heads/main` before the environment can release credentials.

After the account plane passes, manually dispatch **Staging Billing Plane**. The harness refuses live Stripe keys and binds itself to the protected project reference plus the literal `staging` mode. It creates one confirmed synthetic account, requests a real open test-mode Checkout Session through the deployed function, and retrieves the canonical Stripe session to verify `mode=payment`, fixed Price, quantity, redirect URLs, test mode, and authenticated user metadata.

The same run creates an unconfirmed test PaymentIntent solely as a resolvable provider object, signs synthetic `checkout.session.completed` and `charge.refunded` payloads with the staging endpoint secret, and sends them to the deployed webhook. It verifies fulfillment, duplicate delivery, restore from a second authenticated session, full-refund revocation, and duplicate refund handling. Finally it expires the open Checkout Session, cancels the unconfirmed PaymentIntent, removes exact synthetic billing rows, and deletes the test identity. It never enters card details or makes a charge.

The billing summary contains fixed check names and deployment metadata only. It excludes identities, credentials, Checkout URLs, Stripe object IDs, signed event bodies, and response bodies. A pass proves the deployed functions share the expected staging Price and signing secret; it does not prove Stripe's outbound endpoint registration or actual Checkout payment delivery.

After the account plane passes, manually dispatch **Staging Messaging Plane** from `main`. Unlike the read-only probes, this workflow intentionally mutates only the protected staging project: it uses the immutable `supabase/setup-cli` v3 action with CLI `2.109.1`, validates every deployment value without printing values, applies repository migrations, uploads only custom messaging runtime values, and deploys the three messaging functions from the dispatched commit. It never uses `--prune`. Every successful reminder-worker response must attest `github.sha`, preventing an older hosted worker from satisfying a newer repository contract. The workflow then creates four confirmed synthetic accounts using unique labels on Resend's delivered, bounced, and complained test addresses, grants only synthetic manual entitlements, and migrates isolated personal plus household ledgers. It:

- Requires the service-role-only scheduler health RPC, bound to the protected project reference, to prove both extensions, both valid named Vault entries, the exact project endpoint, the exact active hourly job, a successful cron run within two hours, and HTTP 200 for that run's correlated private `pg_net` request before it creates any synthetic data.
- Calls the deployed invitation function through the owner's authenticated session, locates the exact provider message, requires a delivered receipt and bounded content, extracts the private link, and accepts it as the invited account.
- Sends an active reminder through the deployed worker and verifies the exact provider receipt and privacy-limited content while proving a paused schedule is excluded.
- Starts two worker requests together for one fresh charge, requires their aggregate to contain exactly one claim and one send, then requires one durable attempt and one exact delivered provider receipt.
- Injects one service-side failure into a newly claimed delivery, verifies failed status and backoff, releases it, and requires the deployed worker to deliver attempt two.
- Primes one unique reminder idempotency key with a harmless Resend test-address payload, then requires two deployed-worker attempts to receive the documented `409 invalid_idempotent_request`, persist only that bounded error class, reuse the same durable delivery ID, and increase backoff.
- Replays the exact accepted reminder with its deployed provider idempotency key, requires the original provider ID, then proves a worker replay claims nothing; it also covers explicit paused inclusion, email opt-out, refund suspension, and cascade cleanup.
- Sends a reminder to Resend's labeled bounced test address, requires the provider's terminal bounce, then waits for the provider-originated signed webhook to record the event, disable that account's email channel, and permit explicit authenticated recovery.
- Sends a separate reminder to Resend's labeled complained test address, permits the documented delivered-before-complaint transition, then requires the exact signed complaint to suppress only that isolated account.
- After synthetic cleanup, requires the service-only aggregate operations RPC to report a fresh exact-commit worker with no critical alerts, exhausted deliveries, or stuck claims.

The first retry failure is injected at Outflow's durable completion boundary; the separate idempotency conflict is a real, intentional Resend API failure but not an unplanned outage. The workflow uses only Resend's documented test recipients, never an arbitrary or human address. Its summary contains fixed check names and deployment metadata and excludes recipients, credentials, links, content, provider identifiers, scheduler commands/endpoints, database rows, and request/response bodies. A pass proves exact-commit migration/function deployment and worker attestation, concurrent claim isolation, the exact Cron/Vault registration, a recent cron execution whose correlated `pg_net` request received HTTP 200 from the independently authenticated worker, planned non-2xx provider handling/retry, signed bounce-and-complaint paths, and aggregate operational health. It does not prove delivery to a human inbox, an unplanned provider outage, or mailbox-provider breadth.

After the messaging plane passes, set the repository Actions variable `OUTFLOW_OPERATIONS_ENABLED=true` and manually dispatch **Reminder Operations** once. The same protected job then runs at minute 23 of every hour, calls the worker's dedicated aggregate-health action, writes fixed aggregate evidence to its summary, emits bounded warnings for smaller failure/retry/suppression movement, and fails on critical codes. It receives no Supabase publishable/service key, provider, webhook, cron, database-password, or deployment credential. Configure and test the repository notification recipients and escalation owner before treating a failed job as a production alert. See [Reminder Operations](reminder-operations.md).

After the account plane passes, manually dispatch **Staging Browser Sync** from `main`. It provisions a fresh owner/editor pair and shared Pro ledger for desktop Chromium, mobile Chromium, desktop Firefox, and desktop WebKit, then runs the deployed Outflow UI in two isolated contexts per profile. Each profile verifies recovered sessions, shared-ledger isolation, a hosted Realtime refresh, stale-edit preservation and recovery, server-side conflict rejection, visible Realtime disconnect, authoritative reconnect catch-up, and a final synchronized state. The harness suppresses one incoming database frame solely to create a deterministic stale revision, and closes only the tested browser's Realtime WebSocket to create a deterministic transport interruption; all reads and writes still use the deployed app and hosted project.

The browser workflow disables screenshots, traces, videos, downloads, retries, and parallel workers. Its fixed summary contains only the browser profile, deployment metadata, and named checks. It excludes synthetic identities, sessions, row identifiers, operation identifiers, payloads, and Realtime frames. A pass proves the pinned Chromium, Firefox, and WebKit browser-to-hosted-service paths; it does not prove general network-outage recovery, branded Safari, assistive-technology compatibility, or production availability. See [Browser Compatibility Contract](browser-compatibility.md).

Complete these tests with synthetic accounts and Stripe test mode:

- Cross-user RLS isolation, guest migration replay, sign-out restoration, and account deletion.
- Owner/editor/viewer invitation revocation, removal, and Pro downgrade behavior beyond the messaging-plane provider delivery and recipient-acceptance path.
- The protected **Staging Browser Sync** Chromium/Firefox/WebKit matrix, retaining each profile summary with the deployment commit.
- Reminder timezone-provider boundaries, unplanned provider outages, mailbox-provider breadth, and delivery through the named operator-notification path beyond the messaging-plane exact deployment, concurrent isolation, Cron/Vault registration, recent scheduler run, delivery, planned provider failure/retry, idempotency, pause-scope, opt-out, refund, signed bounce/complaint, and aggregate operations checks.
- Actual Stripe-hosted Checkout payment and cancellation, delayed-payment success, and Stripe-originated webhook delivery; the repository billing-plane workflow separately proves signed fulfillment, duplicate handling, restore, and full-refund revocation without making a card charge.
- Hosted calendar import and refresh behavior in Apple Calendar, Google Calendar, Outlook, and a standards-focused iCalendar client; repeat paused scope and refund suspension against the hosted project.

Record the project, deployment commit, migration list, tester, date, and pass/fail result without recording tokens or customer data. Promote only after every applicable matrix is green.

References: [Supabase Edge Function environment variables](https://supabase.com/docs/guides/functions/secrets), [Supabase function configuration](https://supabase.com/docs/guides/functions/function-configuration), [Supabase authorization headers](https://supabase.com/docs/guides/functions/auth-headers), [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Supabase Vault](https://supabase.com/docs/guides/database/vault), [Supabase pg_net responses](https://supabase.com/docs/guides/database/extensions/pg_net), and [Supabase CORS handling](https://supabase.com/docs/guides/functions/cors).
