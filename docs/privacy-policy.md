# Public Privacy And Data-Control Contract

**Status:** Implemented public product surface; final legal and store-release review pending

Outflow publishes its privacy policy and user data-control guidance at:

```text
https://thedudeb.github.io/Outflow/?view=privacy
```

The view is part of the same responsive, base-path-portable application shell as the guest tracker. It is linked from the public landing footer and the in-product Account / Pro controls, and it remains available from the installed web app while offline. The current policy version is `2026-07-20`.

## Disclosure Boundary

The policy distinguishes the exact current release from optional hosted capabilities:

- The public GitHub Pages build is guest-only and has no Supabase browser configuration. Subscription records remain in browser storage, while GitHub Pages may process ordinary web-request metadata as the host.
- The macOS client checks GitHub Releases after launch using its current version, operating system, and processor architecture. It downloads and installs a cryptographically signed update only after the user selects the update control.
- Installed web apps check the Outflow website for a newer cached release on launch, reconnect, focus, and a bounded interval while open. Android release builds ask Google Play for update availability and use Google Play's consent, download, and install flow; Outflow receives transient availability and installation status and does not retain an update history. iPhone and iPad executable updates remain exclusively managed by the App Store or TestFlight.
- Local and native notification payloads are limited to the subscription, amount, date, and list name. Account identifiers and provider credentials are excluded.
- A configured account build sends an email address only for an explicit passwordless-link request. Sign-in does not upload a guest workspace; **Create cloud copy** is a separate action.
- Configured builds read one public service-availability flag from Supabase on launch, reconnect, focus, foreground resume, and a bounded interval. The response contains only maintenance state and an update timestamp, not subscription or account data.
- The account disclosure covers synced subscription lists, roles, invitation state, display-name attribution, synchronization revisions, notification preferences and history, hosted-calendar metadata, and the strict browser write-recovery record.
- Hosted email, private calendar feeds, and one-time Stripe Checkout are described separately, including recipient processing, private feed URLs, limited entitlement/reconciliation records, and the fact that Outflow does not receive full card details or create recurring product subscriptions.
- GitHub Pages and Releases, Supabase, Resend, and Stripe are named with their narrow product purposes. The policy states that Outflow has no advertising, behavioral tracking, data brokerage, direct bank connections, or sale of personal data.
- User choices map to implemented controls: local use without an account, CSV/backup/calendar export, independent notification settings, sign-out, free account export, calendar revocation, member removal, cloud-account deletion, and local-storage removal.

This page describes implemented product behavior, not a blanket claim about an unreviewed future release. Enabling a new provider, SDK, telemetry path, native entitlement, data field, retention rule, or platform purchase flow requires a policy review and a policy-version change before release.

## Automated Evidence

- `npm run test:privacy-policy` enforces the versioned direct route, landing and account entry points, current-build status, core data-flow statements, provider inventory, and release-document linkage.
- `npm run test:a11y` scans the full privacy view at desktop and mobile sizes and includes it in the 320 CSS-pixel reflow contract.
- `npm run test:pwa` and `npm run test:pwa:pages` open the policy from the cached application shell while the browser is fully offline.
- `npm run test:web-deployment` opens the exact hosted privacy URL after deployment, requires the guest-only status and core promises, checks its repository contact and page title, and rejects horizontal overflow or browser errors.
- `npm run test:web-security` enforces the build-generated provider-free guest CSP, exact-origin configured-service boundary, and `no-referrer` policy; production-preview and post-deployment browser gates prove the policy remains active without breaking local or offline use.
- `npm run test:mobile:store-disclosures` and `npm run check:mobile:store-disclosures` bind the [draft native store answers](native-store-disclosures.md) to this policy version, the local guest capability set, package identity, iOS privacy manifest, Android permissions and network policy, and absent hosted configuration.

## Store Procedure

1. Review the exact candidate's network traffic, native manifests and entitlements, browser configuration, provider SDKs, and account/payment feature flags against this policy.
2. Confirm the published policy URL is reachable without authentication and displays the candidate's current policy version on desktop and mobile.
3. For App Store Connect, review the [draft native store answers](native-store-disclosures.md), set the iOS and macOS Privacy Policy URL to the public URL above, and complete the app-level privacy answers for the most inclusive behavior across submitted platforms. Apple requires a public policy URL and requires integrated third-party practices and webview traffic to be reflected in the answers. See [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy) and [App privacy details](https://developer.apple.com/app-store/app-privacy-details/).
4. For Google Play, review the same draft against the exact Android candidate, set the public URL in App content, complete both the Data safety and Financial features forms, and keep an easily accessible in-app link. See [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469), [Financial features](https://support.google.com/googleplay/android-developer/answer/13849271), and [prominent disclosure guidance](https://support.google.com/googleplay/android-developer/answer/11150561).
5. Reconcile provider retention and international-processing terms, obtain any required consent, and complete an operator/legal review appropriate to the launch jurisdictions. The repository contract cannot make those determinations.
6. Record the policy version with the signed candidate and repeat the live deployment smoke check before store promotion.

The public repository link is suitable for general privacy and product-data questions but is not a private support channel. Users are explicitly warned not to place account emails, invitation links, calendar feed URLs, payment details, or other sensitive information in a public issue. A private support channel remains a launch-operations requirement before hosted accounts are enabled broadly.
