# Native Desktop Alpha

Outflow has a minimal macOS desktop shell built with Tauri 2. It embeds the same production React bundle as the responsive web product and opens directly into `#app`; subscription rules, forecasts, calendar behavior, CSV/backup exports, and subscription-list storage are not reimplemented in Rust.

This is a build-verified guest alpha, not a signed public desktop release. The current shell does not bundle Supabase, Stripe, or Resend credentials and does not enable account/cloud features by itself. Default builds receive a valid full-bundle ad-hoc signature with hardened runtime and sealed resources, but they remain intentionally rejected by Gatekeeper and are not distributed. The protected production path adds Developer ID signing, notarization, and cryptographically signed in-place updates; it remains fail-closed until the operator provisions Apple and updater credentials.

## Commands

- `npm run desktop:dev` starts Vite on the fixed local development origin and opens the Tauri window.
- `npm run test:device-notifications` verifies runtime permission behavior, privacy-limited native payloads, browser tags, and duplicate in-flight delivery claims.
- `npm run test:app-updates` verifies native-runtime gating, the universal macOS channel, download progress, install ordering, and restart behavior.
- `npm run test:desktop-shell` verifies the native entry route, package identity, build contract, CSP, disabled asset protocol, exact platform-scoped capabilities, icon inventory, command-free Rust boundary, and macOS CI gate.
- `npm run desktop:build` creates a hardened, full-bundle ad-hoc-signed macOS `.app` under `src-tauri/target/release/bundle/macos/Outflow.app`; it is not a Developer ID or notarized release.
- `npm run desktop:release` creates the same verified app plus a headless ZIP distribution container without Finder automation.
- `npm run check:desktop:release` verifies bundle identity, metadata, executable architecture, hardened runtime, sealed resources, empty entitlements, signatures before and after archive extraction, and the expected non-distributable ad-hoc boundary.
- `npm run test:desktop-release` covers the production environment policy, while `npm run check:desktop:release-environment` validates a real protected Developer ID/notarization environment without printing values. See [macos-release.md](macos-release.md).
- The manual `macOS Production Release` workflow binds a reviewed `macos-production` environment to one exact `main` commit and confirmed version. It builds a universal binary, verifies the notarized app and updater signature set, retains a seven-day review artifact, rejects duplicate versions, and publishes the GitHub Release only as the final step.

## Security Boundary

- The main window loads bundled `index.html#app`; no remote page is configured as application content.
- The Rust backend registers no custom commands. It loads Tauri notifications on all native targets and loads the official updater and process plugins only when compiling for macOS.
- The shared notification capability grants only permission lookup, permission request, and immediate delivery. A separate macOS-only main-window capability grants update check, verified download/install, and restart. It grants no filesystem, shell, dialog, arbitrary process execution, notification-channel management, scheduled notification, or active-notification access.
- Tauri's asset protocol is disabled, prototype freezing is enabled, and compile-time CSP rewriting remains enabled.
- The CSP denies objects and framing, limits scripts to bundled content, and permits outbound connections only to the application origin, Tauri's internal IPC origin, and HTTPS/WSS Supabase project hosts needed by a future explicitly configured account build.
- The desktop build treats its embedded frontend as offline-capable and does not register the web service worker inside the native webview.

## Verification

The main Quality workflow runs notification, update, shell, and release-policy contracts alongside the browser suite. On a fresh `macos-latest` runner it independently builds the hardened ad-hoc-signed `.app` and ZIP, deeply verifies both copies, and proves that neither contains a notarization ticket nor passes Gatekeeper distribution assessment. CI does not upload either artifact. The protected production workflow cannot publish until all credentials are provisioned and the complete signed-update set passes inspection. A clean-machine first install, in-place upgrade, local-data persistence, rollback response, and real notification delivery check remain required before public desktop distribution.
