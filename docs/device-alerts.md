# Outflow Local Device-Alert Contract

Outflow provides free in-app reminders and optional browser or native desktop device notifications without requiring an account. Device settings are stored in the active local Outflow installation and remain independent from account email preferences.

## Timing And Scope

- Free records select one same-day, 1-day, 3-day, 7-day, 14-day, or 30-day preset, or disable reminders entirely. A verified lifetime Pro entitlement can combine presets and add custom whole-day lead times from 0 through 365, up to 12 unique timings per subscription.
- The same selected lead times apply to the subscription's next charge and optional trial end date.
- In-app reminders remain available even when device notifications are disabled or unavailable.
- Browser and native desktop delivery require both explicit OS notification permission and the global device-notification setting.
- Paused subscriptions are excluded by default. A separate global opt-in includes paused charge and trial schedules in both in-app and device reminders.
- The global device setting, paused-schedule scope, and per-subscription lead times persist across reloads.
- Existing multiple or custom lead times remain visible, deliver normally, and can be reduced or disabled after entitlement loss; Free users cannot expand those retained rules.

Local notifications are evaluated while Outflow is running. They are best-effort convenience alerts, not background push delivery; durable account email reminders use the separate server-side contract in [email-reminders.md](email-reminders.md).

## Content And Deduplication

Notification content is limited to the subscription name, amount and currency, billing or trial date, and active list name, type, storage status, and paused state. It does not include tags, account identity, other subscriptions, totals, or unrelated financial details.

Every due reminder receives a stable identifier containing its internal list ID, subscription, event type, date, and lead time. Outflow stores the latest 200 successful identifiers and does not redeliver them after a reload. An in-flight claim prevents asynchronous native delivery from duplicating during a React remount. The internal identifier is not included in native OS payloads; browser delivery uses it only as the Notification API dedupe tag. Malformed local deduplication data resets safely, and one failed notification does not prevent later due reminders from being attempted.

## Permission States

- Permission is requested only after the user enables device notifications.
- A grant enables delivery and is announced as a status update.
- A denial or request failure leaves delivery disabled and is announced as an error.
- Disabling device notifications does not disable in-app reminders or alter email preferences.

## Automated Browser Contract

`npm run test:e2e` verifies the local device-alert behavior in desktop and mobile Chromium. The contract proves that:

- Permission grants and denials produce the correct persisted setting and accessible status.
- Charge and trial notifications contain only the documented fields and active-list context.
- Malformed deduplication state recovers, successful reminders are recorded, and reloads do not duplicate delivery.
- Paused schedules deliver only after explicit opt-in.
- Global disablement stops browser delivery while in-app reminders continue.
- Preserved custom timing drives the correct local charge delivery, and multiple per-subscription lead times can be reduced to one or turned off across reloads.
- The configured account-service suite verifies bounded custom timing, CSV portability, Pro creation of combined preset/custom rules, and downgrade-safe retention at both viewport sizes.

## Native Desktop Contract

The Tauri desktop shell loads the official notification plugin only in a native build. Its notification capability grants exactly permission lookup, permission request, and immediate notification delivery. A separate macOS-only capability permits signed update checks, download/install, and restart; iOS and Android do not receive it. Outflow does not grant scheduled-notification, channel-management, active-notification, filesystem, shell, or arbitrary process access.

`npm run test:device-notifications` proves native permission mapping, request behavior, privacy-limited title/body delivery, browser tag preservation, and duplicate in-flight claims. `npm run test:desktop-shell` proves the exact capability and plugin inventory. The fresh macOS CI job compiles those boundaries into `Outflow.app`. A real macOS permission-prompt and Notification Center delivery check remains required before public desktop distribution.
