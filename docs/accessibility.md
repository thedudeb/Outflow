# Web Accessibility Baseline

**Status:** Automated web gate and interaction baseline implemented; manual screen-reader audit pending

Outflow's responsive web experience uses native controls and semantic regions wherever possible. Accessibility remains a release requirement, so individual improvements must be verified as behavior rather than inferred from visual styling or ARIA attributes alone.

## Dialog Contract

Account, calendar export, ledger controls, alert controls, and CSV import share one dialog lifecycle:

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
- Account, cloud-sync, calendar, ledger, backup, and CSV surfaces expose `aria-busy` while asynchronous work is active.
- Backup and CSV file inputs expose invalid state and reference their visible error message through `aria-errormessage` and `aria-describedby`.
- Selecting a replacement import file clears the prior preview and error before announcing the new read operation.

## Automated WCAG Gate

Run `npm run test:a11y` to start an isolated Vite server and execute axe-core through Playwright. The gate checks WCAG 2.0, 2.1, and 2.2 A/AA rules in Chromium using desktop and mobile device profiles.

Coverage includes the landing page, the direct privacy and data-control view, the complete tracker dashboard, and the account, calendar export, ledger controls, and alert controls at both viewport sizes. The same command verifies document reflow and dialog containment at 320 CSS pixels, then emulates forced colors plus reduced motion and requires a computed keyboard-focus outline. The configured-service suite additionally scans the Pro-only CSV import dialog, authenticated shared-collaboration panel, published hosted-calendar state, signed-in one-time offer, and armed account-deletion state. Any reported violation fails the command with its rule, impact, and affected selectors. GitHub Actions includes both suites on pull requests and pushes to `main` after the production build and unit tests.

The 320 CSS-pixel checks are an automated reflow proxy for magnified desktop layouts. They do not replace manual browser-zoom verification because browser chrome, text rendering, and assistive-technology combinations are outside the test fixture.

Automated checks cannot prove reading order quality, announcement timing, understandable control labels, or assistive-technology behavior. They are a regression floor, not a substitute for the manual release audit.

## Verified Matrix

Browser QA covers:

1. Initial focus, forward wrapping, reverse wrapping, body scroll lock, background isolation, Escape close, and exact trigger restoration in the ledger dialog.
2. Initial focus, Escape close, and trigger restoration in all five dialogs.
3. Literal `inert` and `aria-hidden` application and cleanup.
4. A visible computed focus outline.
5. CSV dialog geometry at a 390 by 844 viewport with no horizontal overflow.
6. Landing, privacy, dashboard, and all four guest dialogs at 320 CSS pixels with no document overflow or viewport clipping.
7. A computed two-pixel keyboard focus indicator while Chromium emulates forced colors and reduced motion.
8. A clean console after desktop and mobile interaction checks.
9. Live-region roles, priorities, atomic announcements, busy states, and file-error relationships in the rendered dialogs.
10. Twenty-four automated WCAG A/AA scans across desktop and mobile profiles: fourteen guest/local surfaces and ten configured account-service surfaces, plus six reflow and forced-colors checks, with no violations.
11. Billing-calendar roving focus, day/week/month keyboard movement, cross-month focus retention, current-date semantics, and short-month clamping at desktop and mobile sizes.

## Remaining Release Work

Before describing the web product as accessibility-audited, complete manual screen-reader testing with VoiceOver/Safari and NVDA/Firefox or NVDA/Chrome. Cover dashboard reading order, form validation announcements, dynamic sync and payment status behavior, calendar navigation, browser zoom, and notification-permission flows in addition to the automated gate and dialog matrix above.
