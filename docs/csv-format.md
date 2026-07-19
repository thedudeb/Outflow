# Outflow CSV Format

Outflow exports UTF-8 CSV with one subscription per row. The first row contains field names. Imports may map differently named source columns before confirmation, but using the canonical names below makes files reusable without manual mapping.

| Field | Required | Format |
| --- | --- | --- |
| `name` | Yes | Text, up to 100 characters |
| `amount` | Yes | Positive decimal number |
| `currency` | Yes | `USD`, `CAD`, `EUR`, `GBP`, `AUD`, `NZD`, `JPY`, or `CHF` |
| `cycle` | Yes | `weekly`, `monthly`, or `yearly` |
| `nextBillingDate` | Yes | ISO date: `YYYY-MM-DD` |
| `category` | No | Text, up to 60 characters |
| `tags` | No | Pipe-separated tags, for example `personal|video` |
| `color` | No | One of Outflow's supported hexadecimal color tags |
| `trialEndDate` | No | ISO date: `YYYY-MM-DD` |
| `reminderLeadDays` | No | Pipe-separated values from `0`, `1`, `3`, `7`, `14`, and `30`; `off` disables reminders |
| `paused` | No | `true` or `false` |

## Compatibility

- Imports also accept `MM/DD/YYYY` and `MM-DD-YYYY` dates.
- Common cycle abbreviations such as `wk`, `mo`, and `yr` are normalized.
- Tag and reminder lists may use pipes, commas, or semicolons.
- The legacy `reminderDays` column remains importable. A value of `-1` is treated as `off`.
- Duplicate rows are detected using normalized name, amount, currency, and cycle values and are skipped unless the source record is changed.

## Safety Limits

- Files may be up to 2 MB and 1,000 rows per import.
- Imports require a preview and explicit confirmation.
- Spreadsheet-formula prefixes are escaped during export.
- Imports never connect to a bank or transmit ledger data to an external service.
