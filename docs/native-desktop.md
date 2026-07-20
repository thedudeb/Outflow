# Native Desktop Alpha

Outflow has a minimal macOS desktop shell built with Tauri 2. It embeds the same production React bundle as the responsive web product and opens directly into `#app`; subscription rules, forecasts, calendar behavior, CSV/backup exports, and browser-local ledger storage are not reimplemented in Rust.

This is a build-verified guest alpha, not a signed public desktop release. The current shell does not bundle Supabase, Stripe, or Resend credentials, does not enable account/cloud features by itself, and is only ad-hoc signed by the local linker rather than Developer ID signed, notarized, or distributed. A production desktop release still needs signed update and distribution policy, configured-service acceptance in the native webview, account callback handling, real macOS notification-permission acceptance, and persistence validation across an application upgrade.

## Commands

- `npm run desktop:dev` starts Vite on the fixed local development origin and opens the Tauri window.
- `npm run test:device-notifications` verifies runtime permission behavior, privacy-limited native payloads, browser tags, and duplicate in-flight delivery claims.
- `npm run test:desktop-shell` verifies the native entry route, package identity, build contract, CSP, disabled asset protocol, exact notification capability, icon inventory, command-free Rust boundary, and macOS CI gate.
- `npm run desktop:build` creates an ad-hoc-signed macOS `.app` bundle under `src-tauri/target/release/bundle/macos/Outflow.app`; it is not a Developer ID or notarized release.

## Security Boundary

- The main window loads bundled `index.html#app`; no remote page is configured as application content.
- The Rust backend registers no custom commands and exactly one official plugin: Tauri notifications `2.3.3`.
- The main window receives only `is-permission-granted`, `request-permission`, and `notify`. It has no filesystem, shell, process, dialog, updater, channel-management, scheduled-notification, active-notification, or other plugin permission.
- Tauri's asset protocol is disabled, prototype freezing is enabled, and compile-time CSP rewriting remains enabled.
- The CSP denies objects and framing, limits scripts to bundled content, and permits outbound connections only to the application origin, Tauri's internal IPC origin, and HTTPS/WSS Supabase project hosts needed by a future explicitly configured account build.
- The desktop build treats its embedded frontend as offline-capable and does not register the web service worker inside the native webview.

## Verification

The main Quality workflow runs the notification adapter and shell policy contracts on Linux alongside the browser suite and independently builds the ad-hoc-signed `.app` on a fresh `macos-latest` runner. CI does not upload that bundle. Release signing, notarization, update metadata, distributable artifacts, and a real permission/delivery check on supported macOS versions must be added before this alpha is offered to users.
