# Web Accessibility Baseline

**Status:** Automated shared-UI and production-web gates implemented; manual platform acceptance pending

Outflow's responsive web experience uses native controls and semantic regions wherever possible. Accessibility remains a release requirement, so individual improvements must be verified as behavior rather than inferred from visual styling or ARIA attributes alone.

The release-candidate procedures for the web/PWA, macOS, iPhone/iPad, and Android products are defined in the [cross-platform accessibility acceptance contract](accessibility-acceptance.md). Native products inherit the shared interface, but they do not inherit a passing platform result until their WebView and OS-controlled surfaces complete that contract.

Every primary view begins with a keyboard-visible skip link that moves focus past repeated navigation and utility controls to the page's level-one heading. Beta tester redemption history uses a named native table with scoped column headers, so tester, account, and redemption-date relationships remain available without relying on the visual grid.

## Dialog Contract

Every modal can be dismissed with its visible close control, the `Escape` key, or by clicking its backdrop. A click inside the dialog never dismisses it. Backdrop and keyboard dismissal remain disabled while a protected account or hosted-calendar operation is in flight, matching the disabled close control.

Account, calendar export, subscription lists, alert controls, and CSV import share one dialog lifecycle:

- Opening captures the invoking element and moves focus to the dialog's designated initial control.
- `Tab` and `Shift+Tab` remain inside the active dialog and wrap at the first and last enabled controls.
- Dashboard siblings receive both `inert` and `aria-hidden="true"` while the dialog is open.
- Background body scrolling is locked and restored without discarding an existing inline overflow value.
- `Escape` invokes the same cleanup path as the visible Close control unless a server action has temporarily locked closing.
- Closing removes background isolation and returns focus to the invoking element when it still exists and no newer modal has opened.
- Every dialog has an accessible name, `aria-modal="true"`, and a programmatically focusable fallback container.

## Focus And Motion

Keyboard focus uses a consistent two-pixel amber `:focus-visible` outline with an offset from the control boundary. Inputs that replace their default outline with border styling still receive this global indicator.

The billing calendar exposes one date in the sequential tab order. Arrow keys, Home/End, and Page Up/Page Down move selection and focus predictably across day, week, and month boundaries; the selected date uses pressed state and today uses `aria-current="date"`.

When `prefers-reduced-motion: reduce` is active, CSS transitions and animations are reduced to effectively immediate durations. The landing-page return-to-top command also switches from smooth to immediate scrolling.

## Dynamic Status Contract

Outflow exposes changes that do not move focus through shared live-region semantics:

- Progress, successful actions, import warnings, hosted-calendar state, and informational account changes use atomic polite status messages.
- Failures that need immediate attention, including account, sync, calendar, backup, and CSV errors, use atomic assertive alerts.
- Account, sync, calendar, subscription-list, backup, and CSV surfaces expose `aria-busy` while asynchronous work is active.
- Backup and CSV file inputs expose invalid state and reference their visible error message through `aria-errormessage` and `aria-describedby`.
- Selecting a replacement import file clears the prior preview and error before announcing the new read operation.

## Automated WCAG Gate

Run `npm run test:a11y` to start an isolated Vite server and execute axe-core through Playwright. The gate checks WCAG 2.0, 2.1, and 2.2 A/AA rules in Chromium using desktop and mobile device profiles.

Coverage includes the landing page, the direct privacy and data-control view, the admin console, the complete tracker dashboard, and the account, calendar export, subscription-list, and alert controls at both viewport sizes. The same command verifies keyboard bypass navigation, document reflow, and dialog containment at 320 CSS pixels, then emulates forced colors plus reduced motion and requires a computed keyboard-focus outline. The configured-service suite additionally scans the populated admin and beta-code controls, Pro-only CSV import dialog, authenticated shared-collaboration panel, published hosted-calendar state, signed-in one-time offer, and armed account-deletion state. It also verifies the tester-history table's accessible name and headers, including reflow at 320 CSS pixels. Any reported violation fails the command with its rule, impact, and affected selectors. GitHub Actions includes both suites on pull requests and pushes to `main` after the production build and unit tests.

Production PWA tests repeat WCAG A/AA scans against the built landing, privacy, tracker, and fully offline states at both root and repository-path scopes. The post-deployment smoke job repeats the scans against the actual HTTPS Pages release. The shared gate also requires 24 by 24 CSS-pixel pointer targets for application controls and verifies primary workflows after the WCAG text-spacing override.

The 320 CSS-pixel checks are an automated reflow proxy for magnified desktop layouts. They do not replace manual browser-zoom verification because browser chrome, text rendering, and assistive-technology combinations are outside the test fixture.

Automated checks cannot prove reading order quality, announcement timing, understandable control labels, or assistive-technology behavior. They are a regression floor, not a substitute for the manual release audit.

## Verified Matrix

Browser QA covers:

1. Initial focus, forward wrapping, reverse wrapping, body scroll lock, background isolation, Escape close, and exact trigger restoration in the subscription-list dialog.
2. Initial focus, Escape close, and trigger restoration in all five dialogs.
3. Literal `inert` and `aria-hidden` application and cleanup.
4. A visible computed focus outline.
5. CSV dialog geometry at a 390 by 844 viewport with no horizontal overflow.
6. Landing, privacy, dashboard, and all four guest dialogs at 320 CSS pixels with no document overflow or viewport clipping.
7. A computed two-pixel keyboard focus indicator while Chromium emulates forced colors and reduced motion.
8. A clean console after desktop and mobile interaction checks.
9. Live-region roles, priorities, atomic announcements, busy states, and file-error relationships in the rendered dialogs.
10. Automated WCAG A/AA scans across desktop, mobile, guest/local, and configured-service surfaces, plus reflow and forced-colors checks, with no violations.
11. Billing-calendar roving focus, day/week/month keyboard movement, cross-month focus retention, current-date semantics, and short-month clamping at desktop and mobile sizes.
12. Keyboard bypass links on landing, privacy, tracker, and configured admin views, plus native table semantics for beta tester history.
13. Minimum pointer-target dimensions and user text-spacing reflow across landing, tracker, and modal workflows.
14. Production PWA WCAG scans while online and offline, plus WCAG scans of the published HTTPS release.

## Remaining Release Work

Before describing any product as accessibility-audited, complete the applicable manual runs in the [cross-platform acceptance contract](accessibility-acceptance.md). At minimum, web/PWA requires VoiceOver/Safari and NVDA/Firefox plus Chrome; macOS requires VoiceOver in the signed client; iPhone/iPad requires VoiceOver, Dynamic Type, and Switch Control; Android requires TalkBack, font/display scaling, and Switch Access.
