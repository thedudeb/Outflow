# Outflow Local Device-Alert Contract

Outflow provides free in-app reminders and optional browser device notifications without requiring an account. Device settings are stored locally for the browser and remain independent from account email preferences.

## Timing And Scope

- Free records select one same-day, 1-day, 3-day, 7-day, 14-day, or 30-day lead time, or disable reminders entirely. A verified lifetime Pro entitlement can select any combination.
- The same selected lead times apply to the subscription's next charge and optional trial end date.
- In-app reminders remain available even when browser notifications are disabled or unavailable.
- Browser delivery requires both explicit notification permission and the global device-notification setting.
- Paused subscriptions are excluded by default. A separate global opt-in includes paused charge and trial schedules in both in-app and device reminders.
- The global device setting, paused-schedule scope, and per-subscription lead times persist across reloads.
- Existing multiple lead times remain visible, deliver normally, and can be reduced or disabled after entitlement loss; Free users cannot expand those retained rules.

Local browser notifications are evaluated while Outflow is running. They are best-effort convenience alerts, not background push delivery; durable account email reminders use the separate server-side contract in [email-reminders.md](email-reminders.md).

## Content And Deduplication

Notification content is limited to the subscription name, amount and currency, billing or trial date, and active ledger name, kind, storage status, and paused state. It does not include tags, account identity, other subscriptions, totals, or unrelated financial details.

Every due reminder receives a stable identifier containing its ledger, subscription, event type, date, and lead time. Outflow stores the latest 200 successful identifiers and does not redeliver them after a reload. Malformed local deduplication data resets safely, and one failed browser notification does not prevent later due reminders from being attempted.

## Permission States

- Permission is requested only after the user enables device notifications.
- A grant enables delivery and is announced as a status update.
- A denial or request failure leaves delivery disabled and is announced as an error.
- Disabling device notifications does not disable in-app reminders or alter email preferences.

## Automated Browser Contract

`npm run test:e2e` verifies the local device-alert behavior in desktop and mobile Chromium. The contract proves that:

- Permission grants and denials produce the correct persisted setting and accessible status.
- Charge and trial notifications contain only the documented fields and active-ledger context.
- Malformed deduplication state recovers, successful reminders are recorded, and reloads do not duplicate delivery.
- Paused schedules deliver only after explicit opt-in.
- Global disablement stops browser delivery while in-app reminders continue.
- Multiple per-subscription lead times can be reduced to one or turned off, and the result survives reload.
- The configured account-service suite verifies Pro creation of multiple lead times and downgrade-safe retention at both viewport sizes.
