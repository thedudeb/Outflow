# Outflow Native Mobile Alpha

Outflow has generated Tauri 2 targets for iPhone, iPad, and Android phones and tablets. Both embed the same responsive React tracker as the web and macOS products, open directly into `index.html#app`, and preserve the local-first guest ledger, forecasts, billing calendar, CSV/backup exports, and device-alert concepts without reimplementing subscription rules in native code.

These are build- and emulator-verified guest alphas, not production-signed mobile releases. iOS requires version 14 or newer; Android requires API 24 or newer and targets API 36. Guest data stays inside each application sandbox. Neither target bundles Supabase, Stripe, Resend, bank connectivity, or provider credentials, and neither enables account/cloud features in the default build.

## Commands

- `npm run mobile:ios:init` regenerates the Xcode project and reapplies the tested dark native launch screen. The host needs full Xcode, XcodeGen, CocoaPods, libimobiledevice, and the required Rust iOS targets.
- `npm run mobile:android:init` regenerates the Android Studio project and reapplies the restricted manifest, local-only debug network policy, cache-only file provider, dark native launch resources, and non-edge-to-edge activity. The host needs JDK 17, Android API 36 and Build Tools 36.0.0, NDK 27.2.12479018, and the ARM64 Rust Android target.
- `npm run test:mobile-shell` verifies the generated project identity, iPhone/iPad target, orientation coverage, icon catalog, empty entitlement file, shared mobile entry point, notification-only native boundary, and CI gate.
- `npm run mobile:ios:build` creates an unsigned Apple Silicon simulator bundle at `src-tauri/gen/apple/build/arm64-sim/Outflow.app`.
- `npm run check:mobile:ios-bundle` verifies the built identifier, product/version metadata, minimum OS, simulator platform, compiled assets, unsigned state, and 64-bit Mach-O executable.
- `npm run mobile:android:build` creates a debug-signed ARM64 APK at `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
- `npm run check:mobile:android-bundle` inspects the merged manifest, identity, API levels, permissions, native ABI, debug certificate, and 16 KB ZIP alignment of the built APK.
- `npm run mobile:android:release` creates a minified production-ID APK and AAB. Without a complete signing environment, the release-readiness artifacts intentionally remain unsigned.
- `npm run check:mobile:android-release` verifies production identity, release manifest policy, permission scope, ARM64 packaging, 16 KB alignment, R8 output, AAB structure, and either the expected unsigned boundary or an explicitly requested pinned signing certificate.
- `npm run test:mobile:android-release` covers the protected production environment and workflow policy, while `npm run check:mobile:android-release-environment` validates a real upload keystore, private-key alias, independent certificate pin, and exact `main` commit without printing values.
- `npm run test:mobile:android-signing` rejects partial signing configuration, signs both release artifacts with a disposable external test keystore, pins their certificate fingerprint, and removes the keystore. See [android-release.md](android-release.md).

## Native Boundary

- The generated Objective-C++ entry point calls the shared Rust mobile entry point; there are no custom native commands.
- The official Tauri notification plugin is the only registered plugin. The main window capability grants exactly permission lookup, permission request, and immediate notification delivery.
- The generated iOS entitlement file is empty. The alpha has no keychain group, app group, iCloud, HealthKit, VPN, filesystem, shell, process, updater, scheduled-notification, or background-processing entitlement.
- The Android package requests internet and notification access. Outflow removes the notification library's reboot and wake-lock permissions plus its timed and reboot-restore receivers, and it does not request storage, location, camera, microphone, or contact access.
- Android application backup is disabled. Its non-exported file provider exposes only app cache, not external storage. Production resources deny cleartext traffic; debug resources permit cleartext only to `localhost` and Android emulator host `10.0.2.2` for local development.
- Android launches only as a phone/tablet application. The generated television launcher category is removed.
- Notification payloads contain only the privacy-limited title and body documented in [device-alerts.md](device-alerts.md). Internal delivery identifiers remain inside the app.
- Tauri hosts are treated as native local installations and do not register the web service worker inside the native webview.

## Verification

The local iOS acceptance build compiled an arm64 Simulator app, installed it as `com.thedudeb.outflow`, and launched it successfully on an iPhone 16 simulator running iOS 18.3.1. Visual inspection confirmed that the tracker opens directly, respects the iPhone status area, retains the intended dense layout, and has no horizontal clipping in the initial viewport.

The local Android acceptance build compiled an ARM64 APK, installed it as `com.thedudeb.outflow.debug`, and cold-launched it successfully on a clean Pixel 8 emulator running API 35. The live WebView reported a 412 CSS-pixel viewport and document width, full-width 355-pixel date controls, the expected five-record ledger after in-place APK replacement, and restart-safe local storage across process termination. Visual inspection confirmed a complete year in both native date controls, readable system status content, the intended dense layout, and no horizontal clipping. Filtered runtime logs contained no Outflow crash, fatal exception, blocked cleartext request, or WebView load error.

The Quality workflow independently builds and inspects the unsigned iOS simulator bundle on a fresh `macos-latest` runner. On a fresh `ubuntu-latest` runner it verifies the debug-signed Android APK, the unsigned minified release APK/AAB, protected-workflow policy, incomplete-signing rejection, and a disposable-certificate signed build with exact fingerprint matching. CI does not upload or distribute any mobile artifact and does not receive a production signing identity. The separate manual `Android Production Signing Acceptance` workflow can verify an operator key behind the reviewed `android-production` environment, but it retains only bounded hashes and has not established acceptance until configured and run successfully.

## Release Work

Before offering Outflow through TestFlight, the App Store, or Google Play, complete real-device persistence and upgrade testing, native notification permission and delivery acceptance, background-behavior decisions, account callback and configured-service acceptance, phone and tablet interaction coverage, VoiceOver/TalkBack and text-scaling review, privacy disclosures, operator-owned platform signing, and protected distribution. Android release APK/AAB generation and signing-path verification are present, but the Android release must still pass the production-key and Play Console policy, target-API, app-bundle, data-safety, and pre-launch gates in [android-release.md](android-release.md). Pro purchase portability must follow each eventual platform-store policy rather than being inferred from either guest alpha.
