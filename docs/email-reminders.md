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

`npm run test:staging-messaging-plane` validates the provider-acceptance harness without network access. After the protected staging project, deployed functions, verified sender, and Resend test key are configured, manually dispatch **Staging Messaging Plane** from `main`.

The live step creates randomized, confirmed synthetic accounts whose addresses use Resend's labeled delivered and bounced test contracts. It invokes the deployed worker, retrieves each exact provider receipt, and requires a delivered event plus the expected subscription, amount, date, ledger, and application link. It replays the exact accepted payload with the deployed delivery's idempotency key and requires the original provider ID, then requires a second worker invocation to claim nothing. It also sends one reminder to a labeled bounced test address, waits for Resend to report the terminal bounce, then requires the provider-originated signed webhook to update the durable event ledger, disable that synthetic account's email channel, and permit explicit recovery.

The separately injected completion failure is deterministic evidence for Outflow's retry state machine; it is not a simulated Resend outage. A pass does not prove Supabase Cron registration, delivery to a human inbox, provider-originated complaints, or behavior across mailbox providers. The workflow summary contains fixed check names and deployment metadata only, never recipients, content, delivery rows, invitation links, provider IDs, or credentials.

## Deployment

Deploy `send-due-reminders` and `resend-webhook` with JWT verification disabled only after setting all values in `supabase/functions/.env.example`. The worker performs its own constant-time bearer-secret check. The webhook verifies `svix-id`, `svix-timestamp`, and `svix-signature` against the server-only `RESEND_WEBHOOK_SECRET` before parsing JSON.

In Resend, register this exact HTTPS endpoint for `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`, `email.complained`, and `email.suppressed`, then store its signing secret in Supabase:

```text
https://<project-ref>.supabase.co/functions/v1/resend-webhook
```

Use Supabase Cron with Vault to invoke it regularly. An hourly schedule gives every timezone a run shortly after the local date changes. Store the project URL and the same high-entropy cron secret in Vault, then POST to:

```text
https://<project-ref>.supabase.co/functions/v1/send-due-reminders
Authorization: Bearer <OUTFLOW_CRON_SECRET>
Content-Type: application/json

{"batchSize":25}
```

Monitor `claimed`, `sent`, `failed`, and `completionErrors` from the function response. A nonzero `completionErrors` count needs investigation even when Resend accepted the email, because the provider idempotency key only deduplicates matching retries for 24 hours.

## Operational Checks

Before production:

1. Verify the sender domain and test delivery to each supported email provider.
2. Run the cron function with an invalid secret, an oversized body, and invalid batch sizes; each must fail closed.
3. Test charge, trial, multiple lead days, paused opt-out/opt-in, refund, membership removal, and account deletion.
4. Run two workers concurrently and confirm each delivery ID appears in at most one claim response.
5. Force a Resend failure, confirm bounded retry, and verify the same delivery ID is reused.
6. Send to Resend's bounced and complained test addresses, confirm automatic suppression, then confirm explicit resume cannot be triggered without an authenticated active-Pro account.
7. Alert on repeated worker failures, exhausted attempts, suppression growth, and completion errors without logging recipient addresses or message content.

The protected workflow automates the active, pause-scope, idempotency, opt-out, refund, provider-delivery, signed provider-bounce suppression/recovery, and deterministic retry portions of this matrix. Timezone-provider breadth, concurrent workers, actual provider API failure, provider-originated complaint handling, scheduler registration, and operational alerting remain manual release checks.

References: [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth), [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [Resend test addresses](https://resend.com/docs/dashboard/emails/send-test-emails), and [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
