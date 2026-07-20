# Release And Versioning Policy

**Status:** Active repository contract

Outflow uses one product version across the shared web source and native shells. Release artifacts remain platform-specific and may have independent monotonically increasing build numbers.

## Product Version

- `package.json` and `src-tauri/tauri.conf.json` must contain the same semantic version.
- Versions below `1.0.0` identify beta or release-candidate products whose service and distribution scope may still change.
- Patch versions contain compatible fixes; minor versions may add product capabilities or change a pre-1.0 contract; major versions represent a deliberate stable-contract break.
- A released version is immutable. Never replace assets under an existing native tag or reuse a mobile build number.

## Platform Identity

- **Web/PWA:** Git commit is the release identity. The service worker cache fingerprint changes with built content, and only a successful immutable `main` Quality artifact may deploy.
- **macOS:** Product version matches the shared version. A protected workflow publishes `v<version>` once with notarized manual-install and cryptographically signed updater assets.
- **iOS/iPadOS:** Marketing version matches the shared version. The protected workflow supplies a monotonically increasing App Store build number; a rejected build number is never reused.
- **Android:** Version name matches the shared version. `versionCode` increases for every Play upload, including a replacement candidate with the same user-visible version.
- **Database and functions:** Applied migration files are immutable. Schema or service rollback uses a reviewed forward migration and exact-commit function deployment rather than editing deployed history.

## Release Procedure

1. Choose the target semantic version and update both shared version files in one commit.
2. Add user-facing release notes and update affected privacy, accessibility, store-disclosure, or service documents.
3. Run the release-version contract and applicable local checks, then push the exact commit to `main`.
4. Require a successful Quality run. Web deployment follows automatically; native release workflows remain manual and protected.
5. Perform the platform's candidate-specific accessibility, privacy, update, data-retention, signing, and distribution acceptance.
6. Record the exact commit, product version, platform build number, tester, date, and decision without recording credentials or customer data.

## Updates And Rollback

- Web and installed PWAs receive a tested content update through the service worker and apply it after the user accepts the visible update control.
- macOS clients install only a user-approved archive that passes the embedded updater signature check.
- iOS/iPadOS and Android updates are distributed by their stores; Android may offer the Play flexible-update flow.
- A faulty web release is rolled back by redeploying a previously tested commit through the protected deployment path.
- A faulty native release is superseded by a higher patch version or build number. Previously published assets and signing identities are not mutated.
- A destructive or ambiguous data migration is not shipped without a tested forward recovery path and backup/export compatibility review.

## Beta Builds

Closed beta evidence always identifies the exact commit and deployment URL. A beta code grants an entitlement but does not change the application version. Native TestFlight and Play internal-track candidates must use store-visible build numbers distinct from public candidates.
