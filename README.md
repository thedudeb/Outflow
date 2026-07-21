# Outflow

Outflow is a local-first subscription tracker for seeing what is active, what will be charged next, and how much recurring services cost over time. The free guest experience works without an account, bank connection, advertising tracker, or backend dependency.

**Public web app:** [thedudeb.github.io/Outflow](https://thedudeb.github.io/Outflow/)

## Current Status

- The responsive web app and installable PWA are publicly available in guest mode.
- Local subscription tracking, forecasts, calendar views, alerts, exports, backups, and multiple local lists are implemented.
- Optional accounts, synchronization, shared lists, beta Pro access, one-time checkout, email reminders, hosted calendars, and revocable API/MCP integrations are implemented behind an unprovisioned service boundary.
- macOS, iPhone/iPad, and Android projects build in CI but remain release candidates, not publicly distributed native products.
- Automated accessibility gates are active; manual assistive-technology acceptance remains required before a formal conformance claim.

The active product requirements and delivery boundary are recorded in [the Outflow PRD](prds/outflow-product-vision.md).

## Local Development

Outflow requires Node.js 22 and npm.

```sh
npm ci
npm run dev
```

Vite serves the app at `http://localhost:5173/`. Local development uses the guest boundary unless valid browser-safe staging values are supplied. Never place a Supabase secret key, Stripe secret, Resend key, signing credential, or customer data in a `VITE_*` value or repository file.

Create a production build with:

```sh
npm run build
```

## Verification

Common focused checks:

```sh
npm run test:e2e
npm run test:pwa
npm run test:account-service
npm run test:browser-compatibility
npm run test:accessibility-contract
npm run test:release-version-policy
```

The `Quality` workflow is the authoritative repository gate. It also builds and inspects the macOS, iOS, and Android projects on clean runners. A successful `main` Quality run triggers the tested GitHub Pages deployment and live-site smoke checks.

## Architecture

- `src/` contains the shared React application, local-first domain logic, service adapters, and shared UI foundation.
- `src-tauri/` contains the macOS, iPhone/iPad, and Android shells and native capability policy.
- `supabase/` contains migrations, Edge Functions, authorization boundaries, and service runtime tests.
- `tests/` contains Node and Playwright contracts for local, configured-service, PWA, accessibility, and release behavior.
- `scripts/` contains fail-closed service and native release inspection tools.
- `docs/` contains product boundaries, operator runbooks, privacy commitments, and release acceptance procedures.
- `mcp/` contains the local stdio MCP server that delegates to the authenticated integrations API.

## Closed Beta

The next milestone is a 10-20 person account-enabled staging beta. Start with the [closed beta runbook](docs/closed-beta.md), provision services through [the staging runbook](docs/service-provisioning.md), and record feedback through the repository's beta feedback issue form without including real financial or secret data.

## Release And Privacy

- [Release and versioning policy](docs/release-versioning.md)
- [Privacy policy](docs/privacy-policy.md)
- [Accessibility acceptance](docs/accessibility-acceptance.md)
- [macOS release and updates](docs/macos-release.md)
- [iOS release readiness](docs/ios-release.md)
- [Android release readiness](docs/android-release.md)
- [API and MCP integrations](docs/integrations.md)

Outflow intentionally excludes bank connections, payment initiation, general budgeting, automated cancellation, advertising, and sale of personal data.
