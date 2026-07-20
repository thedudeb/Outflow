# Closed Beta Runbook

**Status:** Repository ready; hosted staging and operator acceptance pending

The first account-enabled Outflow beta is a private cohort of 10 to 20 invited testers using the responsive web app or installed PWA. It validates optional accounts, synchronization, Pro access, collaboration, imports, alerts, and hosted calendar behavior before those services are offered publicly.

The beta is not a production payment launch, a native store launch, or permission to use real customer financial data in tests or support records.

## Entry Gate

Do not distribute a beta code until all applicable items pass for one exact `main` commit:

- Quality and Deploy web are green, including the published-site smoke and WCAG scans.
- The protected staging boundary, account plane, browser sync, billing plane, and messaging plane workflows are green.
- Supabase RLS, Realtime, Auth redirects, all migrations, and all seven public Edge Function policies match the service runbook.
- Stripe remains in test mode; Resend uses its documented test recipients until the operator performs a separately reviewed human-mailbox check.
- Reminder operations have a named assignee and have demonstrated both incident creation and recovery.
- Maintenance mode can be enabled and disabled by an administrator without blocking administrator recovery.
- No open Blocker or Major issue affects identity, authorization, data preservation, payment state, reminders, accessibility, or privacy.

## Cohort Setup

1. Record the candidate commit, deployment URL, policy version, operator, and start/end dates.
2. Create one beta code with a descriptive internal cohort label, a capacity no greater than 20, and an expiry shortly after the beta window.
3. Retain the plaintext code in an approved private channel. It is shown once and must not enter an issue, screenshot, recording, analytics system, or repository file.
4. Invite testers directly and provide the public privacy policy, supported platforms, feedback link, and a clear statement that this is a staging beta.
5. Keep guest mode available. Account creation remains optional unless a tester chooses to exercise account-only beta features.

## Tester Workflow

Ask each tester to complete the following with synthetic or their own private in-app data:

1. Use Outflow as a guest, add at least three subscriptions, inspect the next 30 days, and export a backup.
2. Create an account only after the prompt, then explicitly create a synced copy and confirm the local list remains available.
3. Redeem the beta code, reload, and confirm beta Pro restores from the account.
4. Sign in from a second browser or installed PWA and verify the synchronized list without re-entering data.
5. Import a reviewed CSV, configure per-subscription alert timing, and publish then revoke a hosted calendar feed.
6. For designated pairs, create a household or team list, invite a member, exercise owner/editor/viewer behavior, and remove access.
7. Exercise offline editing, reconnect, update-ready, sign-out, account export, and account-deletion flows assigned to the cohort.
8. Submit feedback without including subscription names, amounts, account exports, private links, access codes, or credentials.

## Evidence And Metrics

Use beta-code redemption records, opt-in tester check-ins, issue outcomes, and aggregate service health. Do not add third-party behavioral tracking or inspect subscription content to manufacture product metrics.

The beta passes its product gate when:

- At least 10 testers complete the two-week observation window.
- At least 70% report adding or importing three subscriptions and successfully reading their next-30-day schedule.
- At least 60% report meaningful use on three distinct days during the window.
- At least 80% complete second-device synchronization plus one export or restore workflow without operator correction.
- At least 70% say Outflow made upcoming recurring charges clearer, and at least 50% say they would consider the one-time Pro purchase.
- Scheduled service checks succeed at least 95% of the time, excluding documented provider maintenance, with no unresolved delivery backlog.
- There are zero unresolved Blocker or Major security, privacy, authorization, data-loss, payment-state, or accessibility defects.

These thresholds decide whether to expand the beta; they are not public-launch or one-year business targets.

## Feedback Triage

- **Blocker:** Cross-account exposure, unrecoverable data loss, unsafe payment state, inaccessible core workflow, leaked secret, or inability to exit maintenance. Stop distribution and enable maintenance when the affected hosted surface cannot be isolated.
- **Major:** A core workflow fails or materially misleads without a practical recovery. Pause new invitations and assign an owner before continuing.
- **Minor:** Friction or presentation issue with a clear workaround. Track it with the candidate commit and intended release.
- **Idea:** Product suggestion outside the beta acceptance scope. Keep it separate from launch defects.

Use the repository's **Beta feedback** issue form. Deduplicate reports, reproduce against the exact candidate, and never ask a tester to post private account or subscription data.

## Exit Decision

At the end of the window, record one decision:

- **Expand:** Entry and product gates pass; issue another bounded cohort code.
- **Repeat:** The product is safe but one or more metrics or workflows need another fixed-size cohort.
- **Stop:** A Blocker, repeated Major defect, or weak core-value signal makes expansion inappropriate.

Public accounts, purchases, and native distribution require separate production provisioning, policy review, accessibility acceptance, signing, store, and staged-release gates.
