# Outflow Native Mobile Alpha

Outflow has a generated Tauri 2 iOS target for iPhone and iPad. It embeds the same responsive React tracker as the web and macOS products, opens directly into `index.html#app`, and preserves the local-first guest ledger, forecasts, billing calendar, CSV/backup exports, and device-alert concepts without reimplementing subscription rules in native code.

This is a build- and simulator-verified guest alpha, not a signed mobile release. It requires iOS 14 or newer and currently stores guest data inside the application sandbox. It does not bundle Supabase, Stripe, Resend, bank connectivity, or provider credentials, and it does not enable account/cloud features in the default build.

## Commands

- `npm run mobile:ios:init` regenerates the Xcode project and reapplies the tested dark native launch screen. The host needs full Xcode, XcodeGen, CocoaPods, libimobiledevice, and the required Rust iOS targets.
- `npm run test:mobile-shell` verifies the generated project identity, iPhone/iPad target, orientation coverage, icon catalog, empty entitlement file, shared mobile entry point, notification-only native boundary, and CI gate.
- `npm run mobile:ios:build` creates an unsigned Apple Silicon simulator bundle at `src-tauri/gen/apple/build/arm64-sim/Outflow.app`.
- `npm run check:mobile:ios-bundle` verifies the built identifier, product/version metadata, minimum OS, simulator platform, compiled assets, unsigned state, and 64-bit Mach-O executable.

## Native Boundary

- The generated Objective-C++ entry point calls the shared Rust mobile entry point; there are no custom native commands.
- The official Tauri notification plugin is the only registered plugin. The main window capability grants exactly permission lookup, permission request, and immediate notification delivery.
- The generated iOS entitlement file is empty. The alpha has no keychain group, app group, iCloud, HealthKit, VPN, filesystem, shell, process, updater, scheduled-notification, or background-processing entitlement.
- Notification payloads contain only the privacy-limited title and body documented in [device-alerts.md](device-alerts.md). Internal delivery identifiers remain inside the app.
- Tauri hosts are treated as native local installations and do not register the web service worker inside the native webview.

## Verification

The local acceptance build compiled an arm64 iOS Simulator app, installed it as `com.thedudeb.outflow`, and launched it successfully on an iPhone 16 simulator running iOS 18.3.1. Visual inspection confirmed that the tracker opens directly, respects the iPhone status area, retains the intended dense layout, and has no horizontal clipping in the initial viewport.

The Quality workflow independently builds and inspects the unsigned simulator bundle on a fresh `macos-latest` runner. CI does not upload or distribute the app.

## Release Work

Before offering Outflow through TestFlight or the App Store, complete real-device persistence and upgrade testing, native notification permission and delivery acceptance, background-behavior decisions, account callback and configured-service acceptance, iPhone and iPad interaction coverage, VoiceOver and text-scaling review, privacy disclosures, Apple Development/App Store signing, archive export, and protected distribution. Pro purchase portability must also follow the eventual platform-store policy rather than being inferred from the unsigned guest alpha.
