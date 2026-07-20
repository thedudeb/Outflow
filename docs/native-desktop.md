# Native Desktop Alpha

Outflow has a minimal macOS desktop shell built with Tauri 2. It embeds the same production React bundle as the responsive web product and opens directly into `#app`; subscription rules, forecasts, calendar behavior, CSV/backup exports, and browser-local ledger storage are not reimplemented in Rust.

This is a build-verified guest alpha, not a signed public desktop release. The current shell does not bundle Supabase, Stripe, or Resend credentials and does not enable account/cloud features by itself. Default builds now receive a valid full-bundle ad-hoc signature with hardened runtime and sealed resources, but they remain intentionally rejected by Gatekeeper and are not Developer ID signed, notarized, or distributed. A production desktop release still needs signed update and distribution policy, configured-service acceptance in the native webview, account callback handling, real macOS notification-permission acceptance, and persistence validation across an application upgrade.

## Commands

- `npm run desktop:dev` starts Vite on the fixed local development origin and opens the Tauri window.
- `npm run test:device-notifications` verifies runtime permission behavior, privacy-limited native payloads, browser tags, and duplicate in-flight delivery claims.
- `npm run test:desktop-shell` verifies the native entry route, package identity, build contract, CSP, disabled asset protocol, exact notification capability, icon inventory, command-free Rust boundary, and macOS CI gate.
- `npm run desktop:build` creates a hardened, full-bundle ad-hoc-signed macOS `.app` under `src-tauri/target/release/bundle/macos/Outflow.app`; it is not a Developer ID or notarized release.
- `npm run desktop:release` creates the same verified app plus a headless ZIP distribution container without Finder automation.
- `npm run check:desktop:release` verifies bundle identity, metadata, executable architecture, hardened runtime, sealed resources, empty entitlements, signatures before and after archive extraction, and the expected non-distributable ad-hoc boundary.
- `npm run test:desktop-release` covers the production environment policy, while `npm run check:desktop:release-environment` validates a real protected Developer ID/notarization environment without printing values. See [macos-release.md](macos-release.md).

## Security Boundary

- The main window loads bundled `index.html#app`; no remote page is configured as application content.
- The Rust backend registers no custom commands and exactly one official plugin: Tauri notifications `2.3.3`.
- The main window receives only `is-permission-granted`, `request-permission`, and `notify`. It has no filesystem, shell, process, dialog, updater, channel-management, scheduled-notification, active-notification, or other plugin permission.
- Tauri's asset protocol is disabled, prototype freezing is enabled, and compile-time CSP rewriting remains enabled.
- The CSP denies objects and framing, limits scripts to bundled content, and permits outbound connections only to the application origin, Tauri's internal IPC origin, and HTTPS/WSS Supabase project hosts needed by a future explicitly configured account build.
- The desktop build treats its embedded frontend as offline-capable and does not register the web service worker inside the native webview.

## Verification

The main Quality workflow runs the notification adapter and shell policy contracts on Linux alongside the browser suite. On a fresh `macos-latest` runner it independently builds the hardened ad-hoc-signed `.app` and ZIP, deeply verifies both copies of the bundle, and proves that neither contains a notarization ticket nor passes Gatekeeper distribution assessment. CI does not upload either artifact. Operator-owned Developer ID signing, notarization acceptance, update metadata, and real permission/delivery checks on supported macOS versions must be completed before this alpha is offered to users.
