# Browser Compatibility Contract

Outflow treats browser compatibility as separate product surfaces rather than one blanket claim. The local tracker, configured account runtime, installable shell, hosted synchronization, and assistive-technology behavior each have different browser capabilities and evidence.

## Automated Matrix

| Surface | Chromium desktop | Chromium mobile | Firefox desktop | WebKit desktop |
| --- | --- | --- | --- | --- |
| Free core and local data workflows | Required | Required | Required | Required |
| Configured account and collaboration runtime | Required | Required | Required | Required |
| Two-client Realtime refresh, stale edit, and reconnect | Required | Required | Required | Required |
| Installable shell and offline relaunch | Required | Required | Not claimed | Not claimed |
| Automated WCAG regression gate | Required | Required | Not claimed | Not claimed |
| Protected hosted browser synchronization | Required | Required | Required | Required |

`npm run test:browser-compatibility` is the direct public-guest compatibility gate. It runs the landing, privacy, and local tracker shells plus subscription CRUD and recurrence, the internal calendar and timeline, CSV export, iCalendar export, versioned backup and restore, and isolated personal/household/team ledgers in desktop Chromium, Firefox, and WebKit. The broader `npm run test:e2e` suite repeats these workflows in desktop and mobile Chromium and adds browser-notification, entitlement-prompt, and automated accessibility coverage.

`npm run test:account-service` separately runs the complete configured-service contract against desktop Chromium, mobile Chromium, desktop Firefox, and desktop WebKit. This includes verified session recovery, explicit migration, local/cloud isolation, optimistic writes and conflict recovery, two-client Realtime behavior, collaboration, entitlement changes, reviewed import, hosted calendar controls, purchase/restore states, and account deletion.

The PWA, browser-notification, and automated accessibility suites remain intentionally scoped to their documented Chromium profiles. Passing either multi-engine matrix does not imply that every browser-specific install prompt, notification permission surface, service-worker lifecycle, or accessibility API behaves identically. Downloaded CSV, backup, and iCalendar artifact contents are directly verified in all three desktop engines.

## Protected Hosted Matrix

After **Staging Account Plane** passes, **Staging Browser Sync** repeats the visible synchronization sequence against the deployed application and provisioned project in all four profiles. Every profile creates isolated owner/editor browser contexts, aborts one pre-service write, proves its credential-free recovery record survives reload and replays the exact immutable operation once before cleanup, and must then show hosted refresh, `stale`, `conflict`, `offline`, reconnect catch-up, and final `synced` states.

The workflow installs pinned Playwright Chromium, Firefox, and WebKit builds from the locked Node dependency. It runs serially; retries, traces, screenshots, videos, and downloads are disabled so each fixed summary maps to one fresh synthetic fixture without retaining credentials or identity-bearing artifacts.

## Release Boundary

Playwright WebKit is engine-level evidence, not a branded Safari release pass. Before public account synchronization is described as broadly supported, manually test current Safari on macOS and iOS, current Firefox, and current Chromium with real network interruption, background/foreground transitions, storage restrictions, and download/notification permission states.

Accessibility remains a separate gate. Complete VoiceOver with Safari and NVDA with Firefox or Chromium as documented in [Accessibility Contract](accessibility.md); an automated WebKit or Firefox pass does not substitute for assistive-technology testing.
