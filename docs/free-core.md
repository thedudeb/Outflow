# Outflow Free-Core Contract

Outflow's free local tracker must remain fully usable without an account. Subscription records are stored in the active list on this device and support weekly, monthly, and yearly schedules, metadata, one device or trial reminder lead time, pausing, and local persistence. New Free records use USD; records that already contain another supported currency or multiple reminder rules are retained rather than downgraded or rewritten.

## Recurrence Rules

- Active subscriptions with a billing date before today advance by complete billing cycles until the date is today or later.
- Weekly schedules advance in seven-day increments.
- Monthly schedules retain the stored day as their anchor during a calculation. If a target month does not contain that day, the occurrence lands on the target month's final valid day.
- Yearly schedules retain the stored month and day during a calculation. February 29 lands on February 28 in a non-leap year.
- Paused subscriptions retain their displayed schedule. Resuming an overdue subscription advances it before it becomes active again.
- A trial's expected first paid charge cannot precede its trial end. Choosing a later trial end moves an earlier charge date forward, and recurrence begins from that first paid charge.
- Forecasts include occurrences on both the current date and the selected horizon's final date.

These rules prevent native JavaScript date overflow from skipping short months. For example, January 31 advances to February 28 rather than March 3.

## Automated Browser Contract

`npm run test:e2e` verifies the free-core behavior in desktop and mobile Chromium. `npm run test:browser-compatibility` repeats the guest shell, CRUD, persistence, recurrence, trial, and forecast contract in desktop Chromium, Firefox, and WebKit. Together, the contracts prove that:

- A user can add, edit, pause, resume, and delete a subscription without creating an account.
- Amount, existing currency, cycle, next date, category, tags, trial date, and existing reminder rules remain visible and survive reloads.
- An overdue weekly date rolls forward to the first current or future occurrence.
- A trial reminder appears at its configured lead time, is suppressed while paused, and returns after resuming.
- Trial entry, reload, and recurrence preserve the trial end and expected first paid charge ordering at both viewport sizes.
- Weekly, monthly, and yearly schedules produce exact event counts and totals at 30, 60, and 90 days.
- Monthly month-end and yearly leap-day dates clamp to valid calendar dates instead of skipping a billing period.
- CRUD, recurrence, reminder, forecast, and persistence behavior is equivalent at desktop and mobile viewports.
- Contextual Pro gates never mutate the serialized local workspace, while CSV, backup, and calendar exports remain available for data ownership.
