# Outflow CSV Format

Outflow exports UTF-8 CSV with one subscription per row. Export remains part of Free core for data ownership. Reviewed CSV import requires a verified lifetime Pro entitlement. Imports may map differently named source columns before confirmation, but using the canonical names below makes files reusable without manual mapping.

| Field | Required | Format |
| --- | --- | --- |
| `name` | Yes | Text, up to 100 characters |
| `amount` | Yes | Positive decimal number |
| `currency` | Yes | `USD`, `CAD`, `EUR`, `GBP`, `AUD`, `NZD`, `JPY`, or `CHF` |
| `cycle` | Yes | `weekly`, `monthly`, or `yearly` |
| `nextBillingDate` | Yes | ISO date: `YYYY-MM-DD`; for a trial, this is the expected first paid charge |
| `category` | No | Text, up to 60 characters |
| `tags` | No | Pipe-separated tags, for example `personal|video` |
| `color` | No | One of Outflow's supported hexadecimal color tags |
| `trialEndDate` | No | ISO date: `YYYY-MM-DD` |
| `reminderLeadDays` | No | Up to 12 unique pipe-separated whole-day values from `0` through `365`; `off` disables reminders |
| `paused` | No | `true` or `false` |
| `createdBy` | Export only | Local change attribution label |
| `updatedBy` | Export only | Most recent local change attribution label |
| `updatedAt` | Export only | ISO timestamp for the most recent change |

## Compatibility

- Imports also accept `MM/DD/YYYY` and `MM-DD-YYYY` dates.
- Common cycle abbreviations such as `wk`, `mo`, and `yr` are normalized.
- When `trialEndDate` is present, `nextBillingDate` must be the same date or later. Contradictory rows are marked invalid in the import preview.
- Tag and reminder lists may use pipes, commas, or semicolons.
- Values `0`, `1`, `3`, `7`, `14`, and `30` match the built-in presets; other valid values are Pro custom lead times.
- The legacy `reminderDays` column remains importable. A value of `-1` is treated as `off`.
- Attribution columns are exported for portability and audit context. CSV imports do not trust source attribution; imported records are attributed to the local guest.
- Duplicate rows are detected using normalized name, amount, currency, and cycle values and are skipped unless the source record is changed.

## Safety Limits

- Files may be up to 2 MB and 1,000 rows per import.
- Imports require a preview and explicit confirmation.
- Spreadsheet-formula prefixes are escaped during export.
- Imports never connect to a bank or transmit ledger data to an external service.

## Automated Portability Contract

Run `npm run test:e2e` for the guest export and configured import workflows in desktop and mobile Chromium, `npm run test:browser-compatibility` for direct guest export verification in desktop Chromium, Firefox, and WebKit, and `npm run test:account-service` for the configured reviewed-import workflow in all four supported profiles. The browser suites prove:

- Common source-column aliases map into the canonical Outflow fields.
- Preview counts and row states respond to mapping changes, validation failures, existing-ledger duplicates, and duplicates within the source file.
- Custom lead times survive reviewed import and canonical export, while out-of-range values are rejected before confirmation.
- Trial rows preserve the expected first paid charge and reject charge dates that precede the trial end.
- Only ready rows are imported after the explicit confirmation command, and confirmed subscriptions survive a reload.
- Exports use every canonical column listed above, retain user-visible values and attribution, and escape spreadsheet-formula prefixes.
- Free attempts open a contextual Pro explanation without parsing a file or changing local storage; a verified account entitlement unlocks the import dialog and its WCAG gate.
