# Outflow Product Requirements Document

**Status:** Active
**Product:** Outflow  
**Last updated:** July 19, 2026

## TL;DR

Outflow is a focused subscription tracker that tells people exactly what recurring charges are active, how much they cost, and when they will leave an account. It combines a free, local-first guest experience with optional accounts and a one-time Pro purchase for sync, collaboration, imports, integrations, and advanced controls.

The product will remain deliberately narrower than a general personal-finance platform. Its defining qualities are radical simplicity, privacy-conscious data handling, and trustworthy visibility into upcoming withdrawals.

## Background

- The current product supports manual subscription management, paused subscriptions, weekly/monthly/yearly billing, upcoming-charge timelines, forecasts, and a billing calendar.
- Trial end dates and their expected first paid charges, flexible categories and tags, mixed-currency records, reviewed CSV import/export, and bounded custom/multiple device-alert lead times are available in the local ledger.
- The responsive web product is installable and can relaunch its cached application shell offline.
- Subscription data currently stays in the user's browser and does not require an account or external financial connection.
- The product already emphasizes dense, utilitarian presentation and direct access to the amount, identity, and withdrawal date of each subscription.
- Future development should deepen subscription tracking rather than expand into budgeting, banking, or general cash-flow management.

## Current Delivery State

- **Shipped locally:** Guest ledger with an automated desktop/mobile free-core contract covering subscription CRUD, pause/resume, trial-end/first-charge ordering and reminders, overdue cycle rollover, month-end and leap-day handling, persistence, and exact 30/60/90-day forecasts; an internal billing calendar and semantic 30-day timeline with automated navigation, selected-day, recurrence, paused-exclusion, empty-state, exact-total, and roving keyboard-focus verification; categories, tags, Free USD entry with downgrade-safe retention of existing currencies and advanced reminder rules, free canonical CSV export, Pro-gated reviewed CSV import and new multi-currency records, one Free preset device-alert lead time and Pro-gated bounded custom/multiple lead times, paused-alert opt-in, permission-state announcements, privacy-limited payloads, and reload-safe delivery deduplication under automated desktop/mobile portability, notification, entitlement-policy, configured-service, cloud-sync, and durable-email contracts; versioned active-ledger backup/restore with automated export/merge/replace/rejection verification, isolated personal/household/team ledger switching with automated total, record, persistence, attribution, and deletion-protection verification, recurring iCalendar export with automated identity/update/paused-scope verification, installable web metadata, content-aware update invalidation, complete shell precaching, and local-ledger offline relaunch/edit/navigation under an automated production-preview contract; persisted dismissible account prompts after meaningful activity, backup, sharing, and installation moments, a service-independent Free versus lifetime-Pro comparison with contextual feature gates, exact local-data preservation, and automated guest and cancelled-checkout-return verification, a shared keyboard-contained dialog lifecycle, visible focus treatment, reduced-motion handling, semantic dynamic status, error, and busy-state announcements, and an automated desktop/mobile WCAG A/AA regression gate with 320 CSS-pixel reflow, dialog-containment, and forced-colors focus checks enforced in CI.
- **Partially delivered:** Ledger status language, local personal/household/team separation, local attribution, downloadable calendar updates, context-preserving environment-gated passwordless account onboarding, server-verified session recovery and explicit-only transactional guest migration under an automated configured-service browser contract, optional self-scoped display names with email-private shared attribution and Realtime refresh, owner/editor/viewer permissions, private invitation acceptance, cloud-member controls, authoritative Free/Pro feature gates, entitlement-downgrade data control, and authenticated collaboration/import accessibility under a stateful Chromium/Firefox/WebKit service fixture, distinct creator/updater attribution, optimistic revision checks, idempotent transactional cloud writes, local/cloud total isolation, authoritative conflict recovery and sign-out restoration, visible sync/conflict/disconnect states, and protocol-level Realtime refresh, stale-edit, and reconnect handling across isolated browser contexts, RLS policies, free versioned account export with caller isolation and private-service-field exclusion, two-step account deletion with exact local restoration, verified one-time offer and Checkout handoff, server-authoritative pending-success behavior, signature-verified entitlement fulfillment/refunds, reload-safe account-based Pro restore, independent email preference persistence and refund-safe opt-out, timezone-aware reminder claims with tested browser-parity month-end and leap-day recurrence, bounded retries, a cron-protected Resend worker, a database-owned pg_cron/Vault invocation boundary with redacted service-only health evidence, raw-body-signature-verified delivery events with idempotent bounce/complaint suppression, Realtime account-state refresh, and explicit recovery, and one-time-secret hosted iCalendar publication, scope, rotation, suspension, and revocation under the configured multi-engine contract are present. The selected Supabase, Resend, and Stripe services are not yet provisioned, so remote identity, actual invitation/reminder email delivery, production cross-device synchronization, live hosted calendar publishing, and live Pro purchases remain unavailable in the default build.
- **Not yet delivered:** A deployed account service, one-time purchase and restore, cross-device sync, deployed account-backed shared ledgers and invitation email delivery, production-proven calendar subscriptions, native mobile, and native desktop.
- **Next architecture gate:** The repository now enforces the seven-function JWT inventory, validates hosted/local/legacy Supabase key modes without exposing values, type-checks plus runtime-tests every Edge Function boundary on pinned Deno, and provides five protected, manually dispatched staging workflows: public CORS/rejection boundaries; an authenticated synthetic account plane covering hosted RLS, migration, roles, revision writes, service-client Realtime disconnect/catch-up, calendar publication/HTTP lifecycle, revocation, and deletion; a four-profile Chromium/Firefox/WebKit browser plane covering deployed-UI session recovery, hosted refresh, visible stale/conflict/offline/synced states, and reconnect catch-up; a Stripe-test-only billing plane covering canonical one-time Checkout configuration, signed fulfillment/refund idempotency, second-session restore, revocation, and deterministic cleanup without making a card charge; and a Resend-test-address messaging plane that first requires the exact active Cron/Vault configuration plus a recent successful scheduler run whose correlated `pg_net` request received HTTP 200, then covers provider-backed invitation/reminder delivery, recipient acceptance, deterministic retry, idempotency, pause scope, opt-out, refund suspension, provider-originated signed bounce and complaint suppression, explicit recovery, and cascade cleanup. Provision a non-production Supabase/Resend/Stripe test environment using the service runbook, apply all migrations and functions, configure the named Vault entries and repository-owned hourly Cron job, pass all repository staging workflows, then prove actual Stripe-hosted payment plus provider-originated webhook delivery, actual reminder API failure, human-mailbox provider breadth, branded Safari behavior, and third-party calendar-client behavior before enabling accounts or purchases publicly.
- **Accessibility gate:** Maintain the automated WCAG A/AA checks and complete manual VoiceOver plus NVDA coverage for reading order, forms, dynamic status announcements, calendar interaction, browser zoom, and permission flows before describing the responsive web release as accessibility-audited.

## Problem And Target Users

- Individuals and families often lose track of recurring charges across services, dates, currencies, and free trials.
- Freelancers and small teams need a lightweight shared ledger for recurring tools without adopting accounting software.
- Finance-focused users want an accurate forward view of subscriptions without sharing bank credentials or transaction histories.
- All target users need a fast answer to three questions: what is active, what will leave next, and what will subscriptions cost over time?

## Product Principles

- **Focused:** Outflow tracks subscriptions and recurring charges, not a user's entire financial life.
- **Private by default:** Guest use remains available without registration, and direct bank connections are not offered.
- **Clear before clever:** Upcoming dates, amounts, and status take precedence over decorative analytics or complex workflows.
- **Portable:** Users can move their data through CSV and access it across supported platforms when they choose an account.
- **Fairly monetized:** The core product remains useful for free; Pro is an optional one-time purchase rather than a recurring fee.

## Goals And Success Metrics

- Grow active usage across individuals, households, freelancers, and small teams; measure monthly active users and tracked active subscriptions.
- Create a habit around checking upcoming withdrawals; measure 30-day and 90-day retention and repeat calendar/forecast use.
- Validate the one-time Pro model; measure guest-to-account conversion, account-to-Pro conversion, and completed Pro purchases.
- Deliver obvious user value; track qualitative feedback, recommendation intent, support themes, and reports of avoided surprise charges.
- Establish numeric launch and one-year targets after beta usage provides a credible baseline.

## Solution Overview

- Preserve the no-account local tracker as the free entry point and periodically prompt, but never force, users to create an account.
- Add optional accounts for backup and cross-device access, with Pro unlocking synchronization and shared household/team ledgers.
- Support manual entry and CSV import/export while explicitly excluding direct bank-account connections.
- Add free-trial tracking, customizable alerts, multiple currencies, external calendar integration, and flexible categories/tags.
- Expand from responsive web to installable web, native mobile, and desktop experiences while maintaining recognizable product behavior.

## User Experience

### Guest Tracking

1. A user can open Outflow and begin tracking subscriptions without registration.
2. The dashboard immediately shows monthly cost, the next withdrawal, forecast pressure, and the billing calendar.
3. Account prompts appear at appropriate moments such as backup, sharing, or multi-device use, without blocking core actions.

### Account And Pro Upgrade

1. A guest can create an account without losing locally stored subscriptions.
2. The upgrade screen clearly distinguishes free capabilities from the one-time Pro unlock before purchase.
3. A Pro user can synchronize data across supported devices and recover their ledger after replacing a device.

### Shared Ledgers

1. A Pro user can create a household or team ledger and invite other account holders.
2. Members can see who added or changed a subscription and view the shared upcoming-withdrawal schedule.
3. Personal and shared ledgers remain visibly distinct so costs are not accidentally mixed.

### Alerts And Trials

1. A user can enable email and device notifications globally and override timing for an individual subscription.
2. A subscription can include a free-trial end date and an expected first paid charge.
3. Pro users can define multiple reminders or custom lead times; free users receive a simpler default reminder option.

### Import And Calendar Use

1. A Pro user can import a supported CSV, review detected fields and errors, and confirm changes before they affect the ledger.
2. Users can export their subscription data to CSV for portability and backup.
3. Pro users can publish or connect upcoming charges to an external calendar without exposing unrelated financial information.

## Requirements

### Free Core

- Users must be able to add, edit, pause, resume, and delete weekly, monthly, and yearly subscriptions without an account.
- The free dashboard must include monthly cost, upcoming charges, 30/60/90-day forecasts, and an internal billing calendar.
- Users must be able to create custom categories and tags and track a free-trial end date.
- Free users must have access to basic upcoming-charge and trial-ending notifications on supported devices.
- Local guest data must remain usable if the user dismisses every account or upgrade prompt.

### Accounts And Data Control

- Account creation must be optional and must preserve an existing guest ledger during migration.
- Account holders must be able to sign out, export their data, and request deletion of account-held data.
- The product must clearly communicate whether a ledger is local, synchronized, personal, or shared.
- Outflow must not request bank credentials or connect directly to bank accounts.

### One-Time Pro

- Pro must be sold as a one-time unlock with no recurring product subscription fee.
- Pro must unlock cross-device sync, shared ledgers, reviewed CSV import, creation of new records in multiple currencies, external calendar integration, and advanced alert rules. Canonical CSV export remains free for data ownership.
- Purchase and restore states must be available across supported platforms, subject to platform-store requirements.
- Existing free data and workflows must continue working after purchase, restore, or account changes.

### Shared Ledgers

- Pro users must be able to invite and remove members from household or team ledgers.
- Shared subscriptions must expose amount, cycle, category, status, next charge, and change attribution to members.
- The product must prevent shared-ledger totals from being silently included in a user's personal totals.
- Permission levels are fixed at owner, editor, and viewer. Every ledger has one non-transferable owner in the initial release.

### Notifications

- Users must be able to enable or disable email and device notifications independently.
- Each subscription must support its own notification timing, including multiple lead times for Pro users.
- Paused subscriptions must not send charge reminders unless the user explicitly enables paused-schedule alerts.
- Notification content must identify the subscription, amount, billing date, and ledger without exposing unnecessary account details.

### CSV, Currency, And Calendar

- CSV import must provide a preview, field mapping, validation feedback, duplicate warnings, and an explicit confirmation step.
- CSV export must include the complete user-visible subscription record in a documented, reusable format.
- Each subscription must support a currency, and totals must not imply conversion when no exchange-rate source is available.
- External calendar entries must remain identifiable as Outflow charges and support updates when a billing date changes.

### Platform Experience

- Responsive web and installable web experiences are the first distribution target.
- Native mobile and desktop products are long-term targets and must preserve the same core ledger, forecast, calendar, and alert concepts.
- Platform-specific capabilities may differ, but subscription records and Pro access must remain portable for signed-in users.
- Accessibility, small-screen legibility, offline behavior, and clear synchronization status are release requirements on every platform.

## Phased Roadmap

1. **Foundation:** Strengthen the current local tracker, add trial dates, custom categories/tags, basic alerts, CSV export, and account-ready onboarding.
2. **Accounts And Pro:** Launch optional accounts, one-time Pro purchase, backup/sync, CSV import, advanced alerts, and multiple currencies.
3. **Collaboration:** Add personal/shared ledger switching, household/team invitations, permissions, and change attribution.
4. **Expansion:** Add external calendar integration, installable web support, native mobile applications, and desktop applications.

## Out Of Scope

- Direct bank, card, or financial-account connections and automatic transaction ingestion.
- General budgeting, income tracking, bill payment, accounting, investment tracking, or net-worth management.
- Cancellation concierge services, automated cancellation, and cancellation recommendation workflows.
- Receipt attachments, price-change history, and broad spending analytics in the initial roadmap.
- Recurring subscription pricing for access to Outflow itself.

## Open Questions

- What numeric activation, retention, and Pro-conversion targets should be set after the beta baseline is available?
- How should one-time Pro purchases transfer across app stores and direct web purchases?
- Which currencies and locales should be supported in the first multi-currency release?
