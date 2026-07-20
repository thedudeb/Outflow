# Reminder Operations

Outflow monitors durable email reminders without copying financial or identity data into an operations system. Every authenticated worker invocation records one aggregate run after delivery completion. The operations ledger retains only start/completion timestamps, the deployed Git commit, and bounded `claimed`, `sent`, `failed`, and `completion_errors` counters for 30 days.

The ledger contains no user, recipient, ledger, subscription, provider, message, request, response, endpoint, or credential fields. Row Level Security is enabled, and direct table access is revoked from anonymous, authenticated, and service roles. The worker can write only through `record_reminder_worker_run`; health checks can read only the fixed aggregate returned by `reminder_operational_health`.

The public `send-due-reminders` gateway exposes a strict `health` action protected by a dedicated high-entropy `OUTFLOW_OPERATIONS_SECRET`. That credential must differ from the cron bearer. The Edge Function holds the Supabase service key internally, so the monitoring workflow never receives a broad database credential.

## Health Contract

The service-only RPC binds the latest worker to an expected 40-character deployment commit and returns these aggregate windows:

- Latest run time, two-hour freshness, and exact-commit match.
- Worker runs plus claimed, sent, failed, and completion-error totals from the last hour.
- Exhausted deliveries, retries overdue by more than ten minutes, and claims stuck beyond the 15-minute recovery window.
- Provider suppressions created during the last 24 hours.

Critical codes fail the operational workflow:

| Code | Threshold |
| --- | --- |
| `stale_worker` | No worker run in two hours |
| `commit_mismatch` | Latest recent worker does not match the expected repository commit |
| `completion_errors` | One or more durable completion errors in one hour |
| `exhausted_deliveries` | One or more deliveries reached five failed attempts |
| `stuck_claims` | One or more claims remain owned past 15 minutes |
| `retry_backlog` | Five or more retries are overdue by ten minutes |
| `failure_spike` | Ten or more provider failures in one hour |
| `suppression_spike` | Five or more new provider suppressions in 24 hours |

Smaller retry backlogs, one through nine provider failures, and one through four suppressions are fixed warnings rather than critical failures. Thresholds live in the service-only database function and cannot be weakened by workflow input.

## Workflow

`npm run test:reminder-operations` validates the configuration, authenticated health action, internal consistency, fixed code inventory, report privacy, and workflow secret boundary without network access. `npm run check:reminder-operations` queries the protected staging worker and exits nonzero for a malformed contract, remote error, or critical health code.

The **Reminder Operations** GitHub workflow runs manually or at minute 23 of every hour after the repository variable `OUTFLOW_OPERATIONS_ENABLED` is set to the literal value `true`. The repository-level opt-in is evaluated before the protected `staging` environment is entered and prevents noisy scheduled failures before staging exists. The job receives only the project URL/reference and dedicated operations bearer; no Supabase publishable/service key, Resend, Stripe, cron, webhook, database-password, or deployment credential is available to it.

The workflow summary contains the deployment commit, project reference, fixed alert/warning codes, and aggregate counters. A critical result fails the job so repository notification and escalation rules can act on it. Warning results create bounded GitHub annotations without exposing rows or provider diagnostics. Configure and prove the repository's notification recipients and escalation ownership before relying on this as a production alert channel.

The protected messaging-plane workflow also queries the same RPC after synthetic cleanup. It requires a fresh matching worker, zero critical alerts, no exhausted deliveries, and no stuck claims. Planned provider-conflict attempts may appear only as bounded warnings.

## Release Checks

1. Dispatch the messaging plane from the exact commit and retain its operational-health pass.
2. Enable the hourly workflow repository variable only after staging migrations, worker deployment, scheduler, and secrets are configured.
3. Inject a completion error, exhausted delivery, stuck claim, overdue retry backlog, provider-failure spike, and suppression spike in isolated non-production data; confirm the expected fixed codes and cleanup.
4. Confirm a failed workflow reaches the named operator through the repository's configured notification path.
5. Review 30-day retention and thresholds after beta volume provides a credible baseline.
