# Browser Compatibility Contract

Outflow treats browser compatibility as separate product surfaces rather than one blanket claim. The local tracker, configured account runtime, installable shell, hosted synchronization, and assistive-technology behavior each have different browser capabilities and evidence.

## Automated Matrix

| Surface | Chromium desktop | Chromium mobile | Firefox desktop | WebKit desktop |
| --- | --- | --- | --- | --- |
| Free core and local data workflows | Required | Required | Smoke through configured account matrix | Smoke through configured account matrix |
| Configured account and collaboration runtime | Required | Required | Required | Required |
| Two-client Realtime refresh, stale edit, and reconnect | Required | Required | Required | Required |
| Installable shell and offline relaunch | Required | Required | Not claimed | Not claimed |
| Automated WCAG regression gate | Required | Required | Not claimed | Not claimed |
| Protected hosted browser synchronization | Required | Required | Required | Required |

`npm run test:account-service` is the deterministic multi-engine compatibility gate. It runs the complete configured-service contract against desktop Chromium, mobile Chromium, desktop Firefox, and desktop WebKit. This includes verified session recovery, explicit migration, local/cloud isolation, optimistic writes and conflict recovery, two-client Realtime behavior, collaboration, entitlement changes, reviewed import, hosted calendar controls, purchase/restore states, and account deletion.

The broader local-ledger, PWA, and accessibility suites remain intentionally scoped to their documented Chromium profiles. Passing the configured account matrix does not imply that every browser-specific install prompt, notification permission surface, download presentation, service-worker lifecycle, or accessibility API behaves identically.

## Protected Hosted Matrix

After **Staging Account Plane** passes, **Staging Browser Sync** repeats the visible synchronization sequence against the deployed application and provisioned project in all four profiles. Every profile creates isolated owner/editor browser contexts, aborts one pre-service write, proves its credential-free recovery record survives reload and replays the exact immutable operation once before cleanup, and must then show hosted refresh, `stale`, `conflict`, `offline`, reconnect catch-up, and final `synced` states.

The workflow installs pinned Playwright Chromium, Firefox, and WebKit builds from the locked Node dependency. It runs serially; retries, traces, screenshots, videos, and downloads are disabled so each fixed summary maps to one fresh synthetic fixture without retaining credentials or identity-bearing artifacts.

## Release Boundary

Playwright WebKit is engine-level evidence, not a branded Safari release pass. Before public account synchronization is described as broadly supported, manually test current Safari on macOS and iOS, current Firefox, and current Chromium with real network interruption, background/foreground transitions, storage restrictions, and download/notification permission states.

Accessibility remains a separate gate. Complete VoiceOver with Safari and NVDA with Firefox or Chromium as documented in [Accessibility Contract](accessibility.md); an automated WebKit or Firefox pass does not substitute for assistive-technology testing.
