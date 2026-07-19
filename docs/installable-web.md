# Outflow Installable-Web And Offline Contract

Outflow's responsive web experience is an installable progressive web app. The guest tracker and browser-local ledgers can relaunch and remain editable without a network connection after the production service worker finishes its first install.

## Install Metadata

- The web app manifest identifies Outflow, starts directly at `/#app`, uses root scope, and requests standalone display.
- Theme and background colors match the dark application shell.
- PNG icons are available at 192 and 512 pixels, including a maskable 512-pixel declaration, with a separate Apple touch icon in the document metadata.
- The browser install prompt is retained only after `beforeinstallprompt`, shown as an explicit command, and cleared after acceptance or `appinstalled`.

## Cache And Update Lifecycle

- The production build fingerprints every generated chunk and required public install asset by both path and file content using SHA-256.
- Changes to same-path files such as `manifest.webmanifest`, `index.html`, or an icon therefore create a new cache version instead of retaining stale install metadata.
- The service worker precaches the application shell, all generated JavaScript/CSS chunks, manifest, icons, and social image before installation completes.
- Activation deletes older Outflow cache versions and claims open clients.
- A newly installed worker waits when an existing worker controls the app. Outflow exposes an update command, sends `SKIP_WAITING` only after the user chooses it, and reloads after the new worker takes control.

## Offline Boundary

- Navigation uses the network when available and falls back to the cached application shell when it is not.
- Same-origin shell assets use the installed cache and can populate it after successful online requests.
- Subscription data remains in the versioned localStorage workspace rather than in the service-worker cache. Offline edits therefore use the same validation and persistence path as online local edits.
- Landing and tracker URLs both relaunch from the cached shell, and the dashboard visibly reports online/offline state.
- Cloud reads and writes are not queued by the service worker. Account-backed synchronization retains the explicit failure and conflict boundary in [cloud-sync.md](cloud-sync.md).

## Automated Production Contract

`npm run test:pwa` rebuilds Outflow and launches the production preview before testing desktop and mobile Chromium. `npm run test:pwa-cache` separately verifies deterministic content fingerprinting. Together, the contracts prove that:

- Stable-path HTML, manifest, and icon content changes invalidate the cache version.
- The production manifest exposes the required identity, scope, display mode, colors, and icon declarations.
- The generated worker activates at root scope and installs exactly one content-versioned Outflow cache.
- Every URL declared by the generated precache exists in the installed browser cache.
- A local subscription survives an offline reload, a second subscription can be added offline, and both survive another reload.
- The cached shell can navigate from tracker to landing and back while fully offline.
- Returning the browser online updates the visible connection state.

GitHub Actions runs both PWA contracts on every pull request and push to `main` before the broader development-server browser suite.
