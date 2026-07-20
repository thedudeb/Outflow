# Outflow Installable-Web And Offline Contract

Outflow's responsive web experience is an installable progressive web app. The guest tracker and subscription lists on this device can relaunch and remain editable without a network connection after the production service worker finishes its first install.

The public guest build is released to `https://thedudeb.github.io/Outflow/`. It contains no Supabase or provider configuration, so accounts, cloud writes, purchases, hosted calendars, and email delivery remain absent from that artifact. Subscription data stays in the browser origin's local storage. Its direct [privacy and data-control view](https://thedudeb.github.io/Outflow/?view=privacy) describes that current boundary and the separate behavior of optional hosted services.

## Install Metadata

- The web app manifest uses relative identity, start, scope, and icon URLs. It starts directly in `#app` and remains installable at either an origin root or a repository path such as `/Outflow/`.
- Theme and background colors match the dark application shell.
- PNG icons are available at 192 and 512 pixels, including a maskable 512-pixel declaration, with a separate Apple touch icon in the document metadata.
- The browser install prompt is retained only after `beforeinstallprompt`, shown as an explicit command, and cleared after acceptance or `appinstalled`.
- Production HTML carries the build-generated [public web security policy](web-security.md) and `no-referrer` metadata before application resources; both remain in the cached offline shell.

## Cache And Update Lifecycle

- The production build fingerprints every generated chunk and required public install asset by both path and file content using SHA-256.
- Changes to same-path files such as `manifest.webmanifest`, `index.html`, or an icon therefore create a new cache version instead of retaining stale install metadata.
- The service worker registers inside the configured public base and precaches the application shell, all generated JavaScript/CSS chunks, manifest, icons, and social image within that same scope before installation completes.
- Activation deletes older Outflow cache versions and claims open clients.
- The installed app requests a worker update when it launches, returns online, regains browser focus, becomes visible after suspension, and once per hour while it remains open. Failed and offline checks are silent and do not disturb the cached release.
- A newly installed worker waits when an existing worker controls the app. Outflow exposes an update command, sends `SKIP_WAITING` only after the user chooses it, and reloads after the new worker takes control.
- A chosen update reloads the current tab after activation; other open Outflow tabs reload when they observe that the controlling worker changed, preventing mixed release versions across one browser session.

## Offline Boundary

- Navigation uses the network when available and falls back to the cached application shell when it is not.
- Same-origin shell assets use the installed cache and can populate it after successful online requests.
- Subscription data remains in the versioned localStorage workspace rather than in the service-worker cache. Offline edits therefore use the same validation and persistence path as online local edits.
- Landing, privacy, and tracker URLs all relaunch from the cached shell, and the dashboard visibly reports online/offline state.
- The service worker never handles cloud data or queues network requests. The signed-in application can retain one strict, account-bound subscription snapshot per synchronized list for idempotent foreground retry under the explicit persistence and conflict boundary in [cloud-sync.md](cloud-sync.md).

## Automated Production Contract

`npm run test:pwa` rebuilds Outflow at the origin root and launches the production preview before testing desktop and mobile Chromium. `npm run test:pwa:pages` repeats the same browser contract at `/Outflow/`, and `npm run test:pwa-cache` separately verifies deterministic content fingerprinting plus public-base validation. Together, the contracts prove that:

- Stable-path HTML, manifest, and icon content changes invalidate the cache version.
- The update-check controller is covered for launch, reconnect, focus, visibility, hourly polling, offline suppression, failure containment, and listener/timer cleanup.
- The production manifest exposes the required identity, scope, display mode, colors, and icon declarations.
- The generated worker activates at root scope and installs exactly one content-versioned Outflow cache.
- Every URL declared by the generated precache exists in the installed browser cache.
- A local subscription survives an offline reload, a second subscription can be added offline, and both survive another reload.
- The cached shell can open the complete privacy and data-control view, navigate from tracker to landing, and return while fully offline.
- Returning the browser online updates the visible connection state.
- The root and repository-path documents enforce the exact provider-free guest CSP and `no-referrer` policy without blocking install, offline relaunch, navigation, local edits, or CSV, iCalendar, and full-list downloads.

GitHub Actions runs the root PWA and cache contracts on every pull request and push to `main` before the broader development-server browser suite. After that exact `main` Quality run succeeds, **Deploy web** checks out its immutable commit, repeats the repository-path cache and browser contract, uploads only `dist`, and publishes that tested artifact through the protected `github-pages` environment. Pull-request and failed Quality runs cannot deploy.

After publication, a second fresh-browser job tests the actual HTTPS Pages URL in desktop and mobile Chromium. It requires the landing page, direct privacy URL, and tracker to render without horizontal document overflow or browser errors; requires the policy to identify the guest-only release and its no-bank/no-tracking/no-sale boundary; resolves the manifest identity/start/scope within `/Outflow/`; verifies the hosted worker uses that same index and manifest boundary; observes the installed worker at the exact deployment scope; confirms the active list is visibly personal and on this device with a guest account state; and proves one local edit survives a hosted-page reload. The job receives only the public deployment URL and no account, provider, or repository credential.
