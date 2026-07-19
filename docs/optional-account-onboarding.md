# Optional Account Onboarding

**Status:** Implemented browser flow, account service deployment pending

Outflow keeps account creation optional. Guest subscription editing, alerts, forecasts, calendars, imports, exports, backups, and local ledgers continue without registration. Account prompts are status bands rather than blocking dialogs and are rendered only when a valid browser-safe Supabase configuration is present.

## Prompt Moments

- The first periodic checkpoint appears after three meaningful local subscription changes. Later checkpoints require eight additional changes.
- Downloading a full-ledger backup can show a recovery-specific checkpoint after the download starts.
- Creating a local household or team ledger can show a sharing-specific checkpoint after the ledger is created.
- Accepting the install prompt can show a multi-device-specific checkpoint after installation succeeds.
- Creating, editing, pausing, deleting, restoring, or importing data always completes independently of the account prompt.

Selecting **Create optional account** opens the account controls with the originating context preserved. The handoff states that sign-in does not upload local data and that a cloud copy requires a later explicit action.

## Persistence And Dismissal

Prompt cadence is stored locally under `outflow:account-nudge`; it contains only a schema version, activity counters, and a snooze timestamp. It contains no subscription, identity, email, or analytics data.

- **Dismiss 30 days** suppresses periodic and contextual prompts for 30 days and advances the next activity checkpoint.
- Opening the account controls from a prompt suppresses another prompt for seven days and advances the checkpoint.
- A signed-in session suppresses guest prompts.
- A build without configured cloud services never renders a contextual account prompt because it cannot complete account creation.

## Data Boundary

Prompt actions never create an account, transmit an email, or upload a workspace. The user must separately submit an email sign-in request and, after authentication, choose **Create cloud copy**. Browser-local ledgers remain available whether the user dismisses, signs in, signs out, purchases Pro, or deletes cloud account data.

## Verification

Pure cadence and sanitization behavior is covered by `npm run test:account-prompts`. The browser suite verifies at desktop and narrow mobile widths that an unconfigured build remains guest-only, displays the Free and lifetime-Pro comparison, exposes no unavailable account or checkout actions, and still permits local creation and reload persistence after the dialog is closed. It also verifies that a cancelled checkout return remains Free, never implies a recurring product charge, and removes the transient return parameter.

The configured browser-service contract runs through `npm run test:account-service` at both widths. It verifies that requesting a PKCE email link transmits no ledger, recovered sessions require a successful server user check, rejected sessions are cleared without changing local records, sign-in alone performs no migration, and **Create cloud copy** sends the complete workspace only after selection while preserving the local workspace exactly. It also proves that confirmed cloud-account deletion clears the session and remote access, returns from an active cloud ledger to the exact serialized local workspace, and leaves local subscriptions available.

Third-change cadence, context handoff, cooldown behavior, and shared-ledger triggers remain covered by the prompt unit contract. Live email delivery, redirect exchange, and deployed migration are still part of the non-production service provisioning gate.
