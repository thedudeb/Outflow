# Outflow Product Requirements Document

**Status:** Active
**Product:** Outflow  
**Last updated:** July 20, 2026

## TL;DR

Outflow is a focused subscription tracker that tells people exactly what recurring charges are active, how much they cost, and when they will leave an account. It combines a free, local-first guest experience with optional accounts and a one-time Pro purchase for sync, collaboration, imports, integrations, and advanced controls.

The product will remain deliberately narrower than a general personal-finance platform. Its defining qualities are radical simplicity, privacy-conscious data handling, and trustworthy visibility into upcoming withdrawals.

## Background

- The current product supports manual subscription management, paused subscriptions, weekly/monthly/yearly billing, upcoming-charge timelines, forecasts, and a billing calendar.
- Trial end dates and their expected first paid charges, flexible categories and tags, mixed-currency records, reviewed CSV import/export, and bounded custom/multiple device-alert lead times are available in the local subscription list.
- The responsive web product is installable and can relaunch its cached application shell offline.
- Subscription data currently stays in the user's browser and does not require an account or external financial connection.
- The product already emphasizes dense, utilitarian presentation and direct access to the amount, identity, and withdrawal date of each subscription.
- Future development should deepen subscription tracking rather than expand into budgeting, banking, or general cash-flow management.

## Current Delivery State

- **Shipped guest product:** Public HTTPS guest ledger with an automated desktop/mobile free-core contract covering subscription CRUD, pause/resume, trial-end/first-charge ordering and reminders, overdue cycle rollover, month-end and leap-day handling, persistence, and exact 30/60/90-day forecasts; an internal billing calendar and semantic 30-day timeline with automated navigation, selected-day, recurrence, paused-exclusion, empty-state, exact-total, and roving keyboard-focus verification; categories, tags, Free USD entry with downgrade-safe retention of existing currencies and advanced reminder rules, free canonical CSV export, Pro-gated reviewed CSV import and new multi-currency records, one Free preset device-alert lead time and Pro-gated bounded custom/multiple lead times, paused-alert opt-in, permission-state announcements, privacy-limited payloads, and reload-safe delivery deduplication under automated desktop/mobile portability, notification, entitlement-policy, configured-service, cloud-sync, and durable-email contracts; versioned active-ledger backup/restore with automated export/merge/replace/rejection verification, isolated personal/household/team ledger switching with automated total, record, persistence, attribution, and deletion-protection verification, recurring iCalendar export with automated identity/update/paused-scope verification, base-path-portable installable web metadata, content-aware update invalidation, complete shell precaching, and local-ledger offline relaunch/edit/navigation under automated root and repository-path production-preview contracts plus post-deployment desktop/mobile host verification of layout, ledger/account boundary, install assets, worker scope, and local reload persistence; a versioned, direct-linkable public privacy and data-control surface that distinguishes the local guest build from optional account, email, calendar, and payment providers under source, accessibility, 320-pixel reflow, offline, and post-deployment checks; persisted dismissible account prompts after meaningful activity, backup, sharing, and installation moments, a service-independent Free versus lifetime-Pro comparison with contextual feature gates, exact local-data preservation, and automated guest and cancelled-checkout-return verification, a shared keyboard-contained dialog lifecycle, visible focus treatment, reduced-motion handling, semantic dynamic status, error, and busy-state announcements, and an automated desktop/mobile WCAG A/AA regression gate with 320 CSS-pixel reflow, dialog-containment, and forced-colors focus checks enforced in CI.
- **Browser compatibility evidence:** The public guest tracker has a direct desktop Chromium, Firefox, and WebKit guest compatibility gate for shell rendering, subscription CRUD and recurrence, calendar and timeline behavior, CSV and iCalendar downloads, backup/restore, and local-list isolation. Desktop and mobile Chromium remain the broader PWA, notification, reflow, and automated accessibility profiles.
- **Operator control-plane evidence:** A versioned GitHub environment contract binds staging plus macOS, iOS, and Android production workflows to exact setting-name inventories, `main`-only deployment policies, and required reviewers without requesting secret values. All four repository environments are provisioned with `@thedudeb` review and exact `main` policies through a dry-run-first, idempotent provisioner that preserves existing reviewers and refuses destructive policy reconciliation; external settings and credentials remain operator-owned and unconfigured.
- **Public web security evidence:** A build-generated public web security policy restricts the guest release to local application capabilities, adds only exact hosted Supabase origins or required native schemes in configured modes, rejects malformed service origins, and applies `no-referrer` metadata under source, root/repository-path PWA, offline, and post-deployment desktop/mobile checks.
- **Partially delivered:** Ledger status language, local personal/household/team separation, local attribution, downloadable calendar updates, context-preserving environment-gated passwordless account onboarding with explicit create-versus-sign-in modes, sign-in and private-invitation paths that refuse implicit account creation, server-verified session recovery and explicit-only transactional guest migration under an automated configured-service browser contract, optional self-scoped display names with email-private shared attribution and Realtime refresh, owner/editor/viewer permissions, private invitation acceptance, cloud-member controls, authoritative Free/Pro feature gates, entitlement-downgrade data control, and authenticated collaboration/import accessibility under a stateful Chromium/Firefox/WebKit service fixture, distinct creator/updater attribution, optimistic revision checks, idempotent transactional cloud writes, a strict account-scoped durable subscription-write outbox with reload/online retry, exact operation replay, sign-out isolation, explicit discard, and fail-closed conflict recovery across desktop/mobile Chromium, Firefox, and WebKit, local/cloud total isolation, visible sync/queued/conflict/disconnect states, and protocol-level Realtime refresh, stale-edit, and reconnect handling across isolated browser contexts, RLS policies, free versioned account export with caller isolation and private-service-field exclusion, two-step account deletion with exact local restoration, verified one-time offer and Checkout handoff, server-authoritative pending-success behavior, signature-verified entitlement fulfillment/refunds, reload-safe account-based Pro restore, independent email preference persistence and refund-safe opt-out, timezone-aware reminder claims with tested browser-parity month-end and leap-day recurrence, bounded retries, a cron-protected Resend worker with bounded provider-error classification and exact-commit attestation, a database-owned pg_cron/Vault invocation boundary with redacted service-only health evidence, an exact-commit staging deployment contract with two-worker claim-isolation acceptance, a 30-day de-identified worker-run ledger plus service-only aggregate health and opt-in hourly alert workflow using a dedicated health bearer instead of database admin credentials, one assigned privacy-bounded GitHub incident that updates on repeated failures and resolves after recovery, raw-body-signature-verified delivery events with idempotent bounce/complaint suppression, Realtime account-state refresh, and explicit recovery, one-time-secret hosted iCalendar publication, scope, rotation, suspension, and revocation under the configured multi-engine contract, a command-free Tauri 2 macOS guest shell with embedded tracker entry, local/offline runtime handling, Outflow iconography, restrictive CSP, a three-operation notification-only native capability, privacy-limited native payload and in-flight deduplication contracts, policy tests, a hardened-runtime full-bundle ad-hoc signature with sealed resources, a headless ZIP artifact, strict pre/post-extraction inspection, fail-closed Developer ID/notarization environment policy, a main-only protected exact-commit signing workflow with step-scoped credentials and short-lived verified ZIP/checksum candidate retention, and a fresh-runner explicitly non-distributable release-readiness gate, a generated Tauri 2 iPhone/iPad guest target with the same embedded tracker and native notification boundary, complete Outflow icon catalog, empty entitlement file, simulator launch evidence, bundle inspection, a fresh-runner unsigned iOS build gate, a fail-closed no-tracking guest privacy manifest copied into Simulator and IPA roots with the exact observed `C617.1` container-file reason, fail-closed Apple Distribution/App Store profile preflight, a strict fingerprint-pinned IPA inspector, and a main-only protected exact-commit signing workflow with step-scoped credentials and hash-only evidence, a versioned draft Apple App Privacy plus Google Play Data safety and Financial features answer set bound to the local guest identity, public policy, iOS manifest, Android permissions and network policy, and shared fail-closed hosted-configuration rejection, and a generated Tauri 2 Android phone/tablet guest target with API 24 minimum/API 36 target, the shared embedded tracker, complete icon catalog, backup-disabled and cache-only storage boundaries, immediate-notification-only manifest hardening, local-cleartext-only debug policy, clean Pixel emulator launch and restart-persistence evidence, debug and minified unsigned ARM64 release APK/AAB inspection, a fail-closed environment-only signing path with disposable-certificate and fingerprint-pinned acceptance, a main-only protected exact-commit upload-key workflow with step-scoped credentials and hash-only evidence, and fresh-runner debug/release build gates are present. The selected Supabase, Resend, and Stripe services are not yet provisioned, so remote identity, actual invitation/reminder email delivery, production cross-device synchronization, live hosted calendar publishing, and live Pro purchases remain unavailable in the default build. The protected macOS, iOS, and Android workflows are not configured or accepted yet, and the macOS, iOS, and Android targets are alpha builds that have not passed native configured-service, real-device notification, accessibility, operator-owned production signing, candidate-specific store disclosure submission, store, notarization, or distribution acceptance as applicable.
- **Not yet delivered:** A deployed account service, one-time purchase and restore, cross-device sync, deployed account-backed shared subscription lists and invitation email delivery, production-proven calendar subscriptions, a signed and real-device-accepted native mobile release, and a signed/notarized native desktop release.
- **Next architecture gate:** The repository now enforces the seven-function JWT inventory, validates hosted/local/legacy Supabase key modes without exposing values, type-checks plus runtime-tests every Edge Function boundary on pinned Deno, and provides protected staging workflows for public CORS/rejection boundaries; an authenticated synthetic account plane covering hosted RLS, migration, roles, revision writes, service-client Realtime disconnect/catch-up, calendar publication/HTTP lifecycle, revocation, and deletion; a four-profile Chromium/Firefox/WebKit browser plane covering deployed-UI session recovery, a deliberately interrupted write with bounded credential-free persistence, exact immutable replay after reload and cleanup, hosted refresh, visible stale/conflict/offline/synced states, and reconnect catch-up; a Stripe-test-only billing plane covering canonical one-time Checkout configuration, signed fulfillment/refund idempotency, second-session restore, revocation, and deterministic cleanup without making a card charge; a Resend-test-address messaging plane that self-deploys the exact repository migrations and messaging functions, requires worker commit attestation plus the exact active Cron/Vault configuration and a recent scheduler HTTP 200, then covers concurrent-worker claim isolation, provider-backed invitation/reminder delivery, recipient acceptance, deterministic internal retry, planned non-2xx provider failure/retry on one durable delivery, idempotency, pause scope, opt-out, refund suspension, provider-originated signed bounce and complaint suppression, explicit recovery, aggregate operational health, and cascade cleanup; and an opt-in hourly aggregate reminder-operations gate that synchronizes one named assigned incident on failure and closes it after recovery. Provision a non-production Supabase/Resend/Stripe test environment using the service runbook, configure the named Vault entries and repository-owned hourly Cron job, pass all repository staging workflows, then prove actual Stripe-hosted payment plus provider-originated webhook delivery, human-mailbox provider breadth, branded Safari behavior, third-party calendar-client behavior, and live assigned-issue notification and recovery delivery before enabling accounts or purchases publicly.
- **Accessibility gate:** Maintain the automated WCAG A/AA checks and complete manual VoiceOver plus NVDA coverage for reading order, forms, dynamic status announcements, calendar interaction, browser zoom, and permission flows before describing the responsive web release as accessibility-audited.

## Problem And Target Users

- Individuals and families often lose track of recurring charges across services, dates, currencies, and free trials.
- Freelancers and small teams need a lightweight shared subscription list for recurring tools without adopting accounting software.
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
- Add optional accounts for backup and cross-device access, with Pro unlocking synchronization and shared household/team lists.
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
3. A Pro user can synchronize data across supported devices and recover their subscriptions after replacing a device.

### Shared Subscription Lists

1. A Pro user can create a household or team list and invite other account holders.
2. Members can see who added or changed a subscription and view the shared upcoming-withdrawal schedule.
3. Personal and shared lists remain visibly distinct so costs are not accidentally mixed.

### Alerts And Trials

1. A user can enable email and device notifications globally and override timing for an individual subscription.
2. A subscription can include a free-trial end date and an expected first paid charge.
3. Pro users can define multiple reminders or custom lead times; free users receive a simpler default reminder option.

### Import And Calendar Use

1. A Pro user can import a supported CSV, review detected fields and errors, and confirm changes before they affect the list.
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

- Account creation must be optional and must preserve an existing guest subscription list during migration.
- Account holders must be able to sign out, export their data, and request deletion of account-held data.
- The product must clearly communicate whether a list is on this device, synchronized, personal, or shared.
- Outflow must not request bank credentials or connect directly to bank accounts.

### One-Time Pro

- Pro must be sold as a one-time unlock with no recurring product subscription fee.
- Pro must unlock cross-device sync, shared subscription lists, reviewed CSV import, creation of new records in multiple currencies, external calendar integration, and advanced alert rules. Canonical CSV export remains free for data ownership.
- Purchase and restore states must be available across supported platforms, subject to platform-store requirements.
- Existing free data and workflows must continue working after purchase, restore, or account changes.

### Shared Subscription Lists

- Pro users must be able to invite and remove members from household or team lists.
- Shared subscriptions must expose amount, cycle, category, status, next charge, and change attribution to members.
- The product must prevent shared-list totals from being silently included in a user's personal totals.
- Permission levels are fixed at owner, editor, and viewer. Every list has one non-transferable owner in the initial release.

### Notifications

- Users must be able to enable or disable email and device notifications independently.
- Each subscription must support its own notification timing, including multiple lead times for Pro users.
- Paused subscriptions must not send charge reminders unless the user explicitly enables paused-schedule alerts.
- Notification content must identify the subscription, amount, billing date, and list without exposing unnecessary account details.

### CSV, Currency, And Calendar

- CSV import must provide a preview, field mapping, validation feedback, duplicate warnings, and an explicit confirmation step.
- CSV export must include the complete user-visible subscription record in a documented, reusable format.
- Each subscription must support a currency, and totals must not imply conversion when no exchange-rate source is available.
- External calendar entries must remain identifiable as Outflow charges and support updates when a billing date changes.

### Platform Experience

- Responsive web and installable web experiences are the first distribution target.
- Native mobile and desktop products are long-term targets and must preserve the same core subscription-list, forecast, calendar, and alert concepts.
- Platform-specific capabilities may differ, but subscription records and Pro access must remain portable for signed-in users.
- Accessibility, small-screen legibility, offline behavior, and clear synchronization status are release requirements on every platform.

## Phased Roadmap

1. **Foundation:** Strengthen the current local tracker, add trial dates, custom categories/tags, basic alerts, CSV export, and account-ready onboarding.
2. **Accounts And Pro:** Launch optional accounts, one-time Pro purchase, backup/sync, CSV import, advanced alerts, and multiple currencies.
3. **Collaboration:** Add personal/shared list switching, household/team invitations, permissions, and change attribution.
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
