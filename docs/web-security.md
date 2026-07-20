# Public Web Security Contract

Outflow's production HTML receives a build-generated Content Security Policy before any application resource and a `no-referrer` document policy. This is a defense-in-depth boundary for the public local-first release; it does not replace React output escaping, input validation, Supabase RLS, provider authentication, or browser security updates.

## Policy Modes

- The public guest build permits same-origin application scripts, styles, fonts, forms, workers, manifests, and network requests. Images additionally permit local `blob:` and `data:` sources used by application assets.
- A configured account build adds only the exact `https://<project>.supabase.co` origin and its matching `wss://` origin. Non-HTTPS, wildcard, credential-bearing, path-bearing, query-bearing, fragment-bearing, and non-Supabase values fail the production build.
- A native Tauri build adds only its required `ipc:` and local asset origins. The native response-level CSP remains independently enforced by Tauri.
- Inline scripts remain forbidden. Inline styles are allowed because subscription colors and forecast geometry are rendered as bounded React style attributes.

The referrer policy prevents the application URL from being sent with outgoing document requests and navigations. The public guest policy contains no provider origin, so the deployed build cannot connect to Supabase, Stripe, Resend, or another third-party API through normal document fetch or WebSocket behavior.

## Delivery Boundary

GitHub Pages does not receive repository-defined response headers from this build, so Outflow delivers the enforceable document directives through an early `<meta http-equiv="Content-Security-Policy">` element. The meta-delivered policy cannot enforce `frame-ancestors`, report-only delivery, `report-uri`, or `sandbox`. Outflow omits those unsupported directives rather than claiming they protect the Pages release. A future host with response-header control must add framing protection and should move the same policy to an HTTP header.

The `no-referrer` policy is delivered through `<meta name="referrer">`, which is a defined document-policy mechanism. Both metadata elements are cached with the application shell and remain active after an offline relaunch.

## Automated Contract

`npm run test:web-security` verifies source construction, exact configured origins, invalid-origin rejection, native scheme isolation, early build injection, and documentation/CI wiring. `npm run test:pwa` and `npm run test:pwa:pages` execute the generated policy at root and repository paths while proving installation, offline behavior, and CSV, iCalendar, and full-list downloads. The post-deployment `npm run test:web-deployment` gate requires the exact public policy and referrer setting in both desktop and mobile Chromium before the release is accepted.

Playwright execution proves the tested browser can load and operate the current application under the policy. It does not prove support in every browser, prevent compromised same-origin code from reading local data, provide CSP violation reporting, or supply response-only protections unavailable on the current host.
