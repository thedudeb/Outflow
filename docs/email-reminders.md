# Durable Email Reminders

Outflow keeps browser device alerts and account email reminders as independent channels. Device alerts stay local and free under the [local device-alert contract](device-alerts.md). Email automation is an optional Pro capability that runs from trusted infrastructure and never exposes the Resend key or delivery history to the browser.

## Delivery Model

1. Every account has a private `notification_preferences` row. Email is disabled by default.
2. The user explicitly enables email, chooses an IANA timezone, and separately decides whether paused schedules may send.
3. Each subscription's `reminder_lead_days` controls both charge and trial timing. Rules contain up to 12 unique whole-day values from 0 through 365, including Pro custom values. A shared subscription uses the same lead-day rules for each eligible member; each member controls their own email channel and paused-schedule preference.
4. `claim_due_email_notifications` expands due charge and trial events in the user's local date, advances stale recurring charge dates without changing the ledger revision, and inserts a unique durable delivery record. Monthly and yearly advancement preserves the original calendar anchor while clamping to the last valid day, matching the browser ledger for month-end and leap-day schedules.
5. The delivery row freezes the user-visible subscription and ledger fields at scheduling time, so provider retries keep the same payload even if the live record changes.
6. A service-role worker claims rows with `FOR UPDATE SKIP LOCKED`. Concurrent workers cannot claim the same row, abandoned claims become eligible again after 15 minutes, and failed sends use bounded backoff for at most five attempts.
7. Resend receives `outflow-reminder/<delivery-id>` in the `Idempotency-Key` header. A database completion requires the matching worker claim token, so an old worker cannot overwrite a newer attempt.
8. A successful Resend API response marks the delivery `accepted`, not delivered. The independently authenticated `resend-webhook` function records delivered, delayed, failed, bounced, complained, and suppressed provider events against the opaque Resend message ID.
9. Bounce, complaint, and suppression events immediately disable the account's email channel. The UI receives that preference change over RLS-filtered Realtime, explains the bounded reason, and offers an explicit Pro-gated resume action without changing local device alerts.

Delivery content is limited to subscription name, amount and currency, billing or trial date, ledger name and kind, and an Outflow link. Provider response bodies, subjects, recipient addresses, and bounce diagnostics are not stored in the provider-event ledger.

The isolated database contract verifies leap and non-leap month ends, consecutive monthly advances after clamping, consecutive leap-day yearly advances, and unchanged weekly behavior through `npm run test:account-foundation`. GitHub Actions applies every migration to a temporary PostgreSQL cluster and runs this contract on every pull request and push to `main`.

## Authorization

- Authenticated users can read only their own preferences.
- Preference writes go through `save_notification_preferences`, which validates the timezone and requires an active lifetime Pro entitlement before email can be enabled.
- Authenticated and anonymous clients cannot read delivery rows or execute claim/completion functions.
- Provider events require a current Svix timestamp and a valid HMAC signature over the exact raw request body. At-least-once deliveries are deduplicated by both `svix-id` and a bounded logical event fingerprint; only service role can call the recording function.
- The scheduled function uses a server-only Supabase secret and requires a separate, high-entropy `OUTFLOW_CRON_SECRET` on every call.
- Claims recheck email opt-in, Pro status, ledger membership, and paused-schedule policy. A refund, membership removal, subscription deletion, opt-out, or account deletion therefore stops new sends without browser cooperation.

## Automated Browser Contract

`npm run test:account-service` runs the configured account UI against a stateful PostgREST-compatible fixture at desktop and narrow mobile widths. It verifies that a Pro user can enable email, include paused schedules, choose an IANA timezone, save the exact RPC payload, and recover the authoritative settings after reload without changing serialized local device-alert settings.

The same contract simulates a refund while email remains opted in. The channel becomes visibly **Suspended**, unavailable sub-rules are locked, and the master email control remains available so the user can opt out. Saving that opt-out succeeds without Pro and still leaves local device alerts untouched. A separate four-engine flow injects an authoritative preference change over Realtime, requires the visible **Suppressed** state, verifies that the email toggle is locked, resumes through the dedicated RPC, and proves both the local ledger and device-alert settings remain byte-for-byte unchanged.

## Protected Provider Contract

`npm run test:staging-messaging-plane` validates the provider-acceptance harness without network access. After the protected staging project, deployed functions, verified sender, Resend test key, and hourly scheduler are configured, manually dispatch **Staging Messaging Plane** from `main`.

Before creating data, the live step calls the service-role-only `reminder_scheduler_status` RPC with the protected staging project reference and requires `pg_cron`, `pg_net`, both valid named Vault entries, an endpoint bound to that project, the one active `7 * * * *` job with the repository-owned command, a successful run within two hours, and HTTP 200 for that run's correlated private `pg_net` request. It then creates randomized, confirmed synthetic accounts whose addresses use Resend's labeled delivered, bounced, and complained test contracts. It invokes the deployed worker, retrieves each exact provider receipt, and requires a delivered event plus the expected subscription, amount, date, ledger, and application link. It replays the exact accepted payload with the deployed delivery's idempotency key and requires the original provider ID, then requires a second worker invocation to claim nothing. For provider-failure evidence, it primes a fresh delivery key with one harmless test-address payload, invokes the worker with its different canonical payload, and requires Resend's documented `409 invalid_idempotent_request` to be persisted as a bounded error class. A second worker attempt must reuse the same delivery ID, receive the same provider error, and increase backoff. The failed synthetic delivery is then parked so later acceptance steps cannot claim it. Finally, isolated bounced and complained reminders must reach the signed webhook, update distinct durable event rows, and suppress only the matching accounts. The bounce account must also recover through the authenticated resume RPC.

The earlier completion-boundary injection remains deterministic evidence for recovery after an internal durable-write failure. The idempotency conflict is separate evidence that the deployed worker handles a real Resend non-2xx response; it is intentional and does not simulate an unplanned provider outage. The worker reads at most 4 KiB from an error response and persists only an allowlisted provider error name plus status, never the message. The scheduler function retains only its opaque `pg_net` request ID and queue time for seven days; the health RPC correlates that row with `net._http_response` while the provider response is still retained and returns only the HTTP status and timestamp. A pass does not prove delivery to a human inbox, an unplanned provider outage, or behavior across mailbox providers. The workflow summary contains fixed check names and deployment metadata only, never recipients, content, delivery rows, invitation links, provider IDs, scheduler commands/endpoints, request/response bodies, or credentials.

## Deployment

Deploy `send-due-reminders` and `resend-webhook` with JWT verification disabled only after setting all values in `supabase/functions/.env.example`. The worker performs its own constant-time bearer-secret check. The webhook verifies `svix-id`, `svix-timestamp`, and `svix-signature` against the server-only `RESEND_WEBHOOK_SECRET` before parsing JSON.

In Resend, register this exact HTTPS endpoint for `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`, `email.complained`, and `email.suppressed`, then store its signing secret in Supabase:

```text
https://<project-ref>.supabase.co/functions/v1/resend-webhook
```

Enable the Supabase Cron and `pg_net` modules after applying all migrations. Store the exact worker endpoint and the same high-entropy cron secret in Vault under the names consumed by `invoke_due_reminder_worker`, then register the fixed hourly job:

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/send-due-reminders',
  'outflow_reminder_endpoint',
  'Exact Outflow reminder worker endpoint'
);
select vault.create_secret(
  '<OUTFLOW_CRON_SECRET>',
  'outflow_cron_secret',
  'Outflow reminder worker bearer'
);
select cron.schedule(
  'outflow-due-reminders-hourly',
  '7 * * * *',
  'select public.invoke_due_reminder_worker();'
);
```

The minute-seven offset avoids the top-of-hour spike while still running once per hour. `invoke_due_reminder_worker` validates both Vault values and queues this private request through `pg_net`:

```text
POST https://<project-ref>.supabase.co/functions/v1/send-due-reminders
Authorization: Bearer <OUTFLOW_CRON_SECRET>
Content-Type: application/json

{"batchSize":100}
```

Wait for the first scheduled run, then call `reminder_scheduler_status('<project-ref>')` as service role or dispatch the protected messaging workflow. The expected reference binds the Vault endpoint to the project under test. The RPC exposes only configuration booleans, the fixed schedule, cron and HTTP timestamps/status, and aggregate health. It never returns the endpoint, cron command, request headers, response body, or decrypted values. Rotate a Vault value with `vault.update_secret` using the existing secret row ID; do not create a duplicate name. Monitor `claimed`, `sent`, `failed`, and `completionErrors` from the function response. A nonzero `completionErrors` count needs investigation even when Resend accepted the email, because the provider idempotency key only deduplicates matching retries for 24 hours.

## Operational Checks

Before production:

1. Verify the sender domain and test delivery to each supported email provider.
2. Run the cron function with an invalid secret, an oversized body, and invalid batch sizes; each must fail closed.
3. Test charge, trial, multiple lead days, paused opt-out/opt-in, refund, membership removal, and account deletion.
4. Run two workers concurrently and confirm each delivery ID appears in at most one claim response.
5. Repeat the protected Resend idempotency-conflict check and confirm the same delivery ID, bounded error class, and increasing retry backoff.
6. Send to Resend's bounced and complained test addresses, confirm automatic suppression, then confirm explicit resume cannot be triggered without an authenticated active-Pro account.
7. Alert on repeated worker failures, exhausted attempts, suppression growth, and completion errors without logging recipient addresses or message content.

The protected workflow automates the exact Cron/Vault registration and recent-run check plus the active, pause-scope, idempotency, opt-out, refund, provider-delivery, planned provider-API failure/retry, signed provider-bounce and complaint suppression, explicit bounce recovery, and deterministic internal retry portions of this matrix. Timezone-provider breadth, concurrent workers, unplanned provider outages, mailbox-provider breadth, and operational alerting remain manual release checks.

References: [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Supabase Vault](https://supabase.com/docs/guides/database/vault), [Supabase pg_net responses](https://supabase.com/docs/guides/database/extensions/pg_net), [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth), [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [Resend test addresses](https://resend.com/docs/dashboard/emails/send-test-emails), and [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
