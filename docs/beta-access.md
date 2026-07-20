# Beta Access Codes

**Status:** Implemented service and UI contract; hosted Supabase deployment pending

Outflow administrators can create limited-use beta codes from `?view=admin`. A code grants the same server-backed `outflow_pro_lifetime` entitlement used by purchased Pro access, but records `manual` as the entitlement provider so the interface can identify it as beta access rather than a payment.

## Operator Workflow

1. Sign in to the admin console with an account whose protected JWT `app_metadata.outflow_role` is `admin`.
2. Enter an internal cohort label, choose a limit from 1 to 20 accounts, and optionally set an expiry.
3. Create the code and retain the displayed value. The plaintext secret is returned once and cannot be recovered from the database or admin report.
4. Give the code only to intended testers. A tester must create or sign in to an Outflow account, open **Account / Pro**, and select **Activate Pro** after entering it.
5. Review usage in the admin console. Each code shows capacity, remaining seats, state, expiry, and the current account email, display name, and redemption time for each tester.
6. Disable a code to stop new redemptions. Existing Pro entitlements remain active; enabling the code again restores only its unused capacity.

## Security Boundary

- Generated codes contain 80 random bits and are stored only as SHA-256 hashes plus a five-character suffix for identification.
- The service keeps at most 100 code cohorts so the complete administrator report remains bounded.
- Code creation, reporting, and state changes independently verify the trusted server-issued administrator claim. Browser role checks are presentation only.
- Redemption requires an authenticated account, permits one beta redemption per account, and allows at most ten attempts per account per hour.
- The code row is locked during redemption, so simultaneous requests cannot exceed its capacity.
- Invalid, expired, disabled, exhausted, and unknown codes return the same public result to limit state discovery.
- Code, redemption, and attempt tables have RLS enabled and grant no direct browser-table access. Only narrowly scoped security-definer functions are callable.
- A tester who already has active Pro does not consume a seat. A refunded or revoked purchase can be replaced by a valid beta entitlement.
- Disabling a code is not entitlement revocation. Individual beta-access revocation remains an operator database procedure until a dedicated reviewed control is added.

## Privacy And Deletion

The admin usage report joins each live redemption to the account email and optional display name because the operator explicitly requested identifiable beta tracking. These fields are not copied into the redemption row. Deleting an account removes its entitlement, attempts, profile, and authentication identity; the redemption becomes a de-identified historical use so cohort capacity and aggregate usage do not change.

The public guest build has no Supabase browser configuration. The code controls appear only as unavailable service UI until Supabase is provisioned, this migration is applied, and the build receives the public project URL and publishable key.

## Verification

- `npm run test:beta-access` checks response validation, capacity bounds, secret handling, and UI/security wiring.
- `npm run test:account-foundation` executes authorization, hashing, redemption, capacity, throttling, tracking, disable, and deletion cases against PostgreSQL.
- `npm run test:account-service` runs admin creation/tracking and signed-in redemption in desktop/mobile Chromium, Firefox, and WebKit, including automated WCAG A/AA and horizontal-overflow checks.
