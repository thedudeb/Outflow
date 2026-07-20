# macOS Release And Updates

Outflow's default macOS build is a hardened, ad-hoc-signed release-readiness artifact. It is intentionally rejected by Gatekeeper and is never uploaded by Quality. The protected production path builds one universal Apple Silicon/Intel app, applies an operator-owned Developer ID signature and Apple notarization, and creates a separate Tauri updater signature.

Published clients check `https://github.com/thedudeb/Outflow/releases/latest/download/latest.json` after launch. A client downloads an update only after the user selects the update control, verifies the archive against its embedded updater public key, installs it, and relaunches. The updater endpoint and public key are injected only into protected production builds.

## Readiness Build

Run:

```sh
npm run desktop:release
npm run check:desktop:release
```

This creates `src-tauri/target/release/bundle/macos/Outflow.app` and a versioned ZIP in `macos-release`. The checker validates identity, version, category, architecture, hardened runtime, sealed resources, empty entitlements, and strict signatures before and after extraction. It also proves that the default artifact has no Team ID or notarization ticket and fails Gatekeeper distribution assessment. Updater metadata is deliberately absent.

## Production Credentials

The protected `macos-production` GitHub environment must allow exactly `main`, require review, and contain these variables:

```text
OUTFLOW_MACOS_SIGNING_IDENTITY
OUTFLOW_MACOS_TEAM_ID
OUTFLOW_APPLE_API_KEY
OUTFLOW_APPLE_API_ISSUER
OUTFLOW_UPDATER_PUBLIC_KEY
```

It must contain these secrets:

```text
OUTFLOW_APPLE_CERTIFICATE
OUTFLOW_APPLE_CERTIFICATE_PASSWORD
OUTFLOW_APPLE_API_PRIVATE_KEY
OUTFLOW_UPDATER_PRIVATE_KEY
OUTFLOW_UPDATER_PRIVATE_KEY_PASSWORD
```

The Apple certificate and password enable Developer ID signing. The App Store Connect key ID, issuer, and private key enable notarization. The encrypted Tauri updater private key signs update archives; its password must remain a separate secret. Generate and back up the updater key outside the repository. Losing it prevents existing installations from accepting future updates, while exposing it permits unauthorized update signatures.

`npm run check:github-environments` validates environment protection and setting names without reading secret values. `npm run check:desktop:release-environment` validates the Developer ID, Team ID, notarization mode, universal target, exact version, and updater credential presence without echoing values.

## Protected Workflow

`.github/workflows/macos-release.yml` is manual and `main`-only. Dispatch requires the exact version already committed in `src-tauri/tauri.conf.json`. The workflow:

1. Installs locked dependencies and both macOS Rust targets.
2. Runs notification, updater, shell, and release policy contracts before exposing secrets.
3. Builds and notarizes a universal app and creates the updater archive and detached signature.
4. Removes the temporary notarization key, then verifies the app, ZIP, architectures, notarization, updater signature set, and `latest.json` linkage.
5. Uploads the complete set as a seven-day GitHub Actions review artifact and refuses an existing version.
6. Publishes the GitHub Release as the final step with the manual ZIP, update archive, signature, manifest, and checksums.

The workflow does not publish a raw `.app`, an ad-hoc artifact, or replacement assets under an existing version.

## Release Procedure

1. Provision the protected environment with independently generated Apple and updater credentials.
2. Increment `src-tauri/tauri.conf.json`, commit the version to `main`, and wait for Quality to pass.
3. Dispatch `macOS Production Release` from that exact commit with the exact version and optional notes.
4. Review and approve the protected environment only after confirming the commit and version.
5. Download the review artifact and perform clean-machine first-launch and upgrade acceptance.
6. Confirm that the previous release discovers the new version, rejects altered signatures, installs only after user action, preserves local data, and relaunches successfully.

For a local operator reproduction, supply the production signing environment and run:

```sh
OUTFLOW_MACOS_TARGET=universal-apple-darwin \
OUTFLOW_MACOS_REQUIRE_UPDATER=true \
OUTFLOW_MACOS_EXPECTED_VERSION="<version>" \
npm run desktop:release

OUTFLOW_MACOS_TARGET=universal-apple-darwin \
OUTFLOW_MACOS_REQUIRE_UPDATER=true \
OUTFLOW_MACOS_EXPECTED_DISTRIBUTABLE=true \
OUTFLOW_MACOS_EXPECTED_TEAM_ID="<team id>" \
npm run check:desktop:release
```

Before broad distribution, complete interrupted-download recovery, rollback response, native notification acceptance, configured account callback and sync testing, VoiceOver and text-scaling review, privacy review, and incident ownership. Ad-hoc Quality artifacts must never be presented as public releases.

See Tauri's official [macOS code-signing guide](https://v2.tauri.app/distribute/sign/macos/) and [updater guide](https://v2.tauri.app/plugin/updater/) for the underlying contracts.
