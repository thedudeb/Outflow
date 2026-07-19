# Outflow Internal Calendar Contract

Outflow's free dashboard includes a billing calendar and a date-ordered 30-day upcoming timeline. Both surfaces derive from the active ledger's recurring schedule and remain available without an account.

## Schedule Scope

- Only subscriptions in the active ledger are considered; personal and household/team records are never combined.
- Paused subscriptions remain visible in the subscription list but are excluded from the calendar, upcoming timeline, next charge, and forecast schedule.
- Weekly, monthly, and yearly occurrences use the recurrence rules in [free-core.md](free-core.md), including month-end and leap-day clamping.
- Currency totals remain separated by ISO currency code. The calendar never implies exchange-rate conversion.

## Billing Calendar

- The month header reports the selected month's total and number of scheduled debit events.
- Previous, next, and today controls update the visible month and selected date.
- Every date button identifies its full date, event count, and currency-separated total to assistive technology.
- The date-button group uses one sequential tab stop. Arrow Left/Right move one day, Arrow Up/Down move one week, Home/End move to the start/end of the current week, and Page Up/Page Down move one month while clamping short months.
- Keyboard navigation updates the visible month, selected-day details, pressed state, and focus together. The current date is additionally exposed with `aria-current="date"`.
- Selecting a day reveals each subscription name, category, cycle, amount, and currency scheduled for that date.
- Days without events expose an explicit zero-debit state.

## Upcoming 30 Days

- The timeline includes occurrences from today through 30 days from today, inclusive.
- Events are ordered by date and then subscription name.
- Repeated weekly or monthly occurrences appear as separate dated list items.
- An empty schedule displays an explicit no-active-charges state instead of a blank panel.
- The timeline uses ordered-list semantics so assistive technology receives a meaningful event count and reading order.

## Automated Browser Contract

`npm run test:e2e` verifies the internal calendar and timeline in desktop and mobile Chromium. The contract proves that:

- Empty ledgers report zero calendar events and an explicit empty 30-day timeline.
- Weekly, monthly, and yearly subscriptions produce exact current/next-month totals and date order.
- Calendar date selection exposes the matching debit details.
- Month navigation and the today control update month and selected-day state consistently.
- Roving keyboard navigation retains one date tab stop, moves focus across week and month boundaries, and clamps January 31 to February 28.
- Paused subscriptions are absent from both calendar and timeline schedules.
- January 31 recurrence remains visible on February 28 and returns to March 31 instead of skipping or drifting within the calculation.
