# Web Accessibility Baseline

**Status:** Dialog, motion, and dynamic-status baseline implemented; full release audit pending

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

When `prefers-reduced-motion: reduce` is active, CSS transitions and animations are reduced to effectively immediate durations. The landing-page return-to-top command also switches from smooth to immediate scrolling.

## Dynamic Status Contract

Outflow exposes changes that do not move focus through shared live-region semantics:

- Progress, successful actions, import warnings, hosted-calendar state, and informational account changes use atomic polite status messages.
- Failures that need immediate attention, including account, sync, calendar, backup, and CSV errors, use atomic assertive alerts.
- Account, cloud-sync, calendar, ledger, backup, and CSV surfaces expose `aria-busy` while asynchronous work is active.
- Backup and CSV file inputs expose invalid state and reference their visible error message through `aria-errormessage` and `aria-describedby`.
- Selecting a replacement import file clears the prior preview and error before announcing the new read operation.

## Verified Matrix

Browser QA covers:

1. Initial focus, forward wrapping, reverse wrapping, body scroll lock, background isolation, Escape close, and exact trigger restoration in the ledger dialog.
2. Initial focus, Escape close, and trigger restoration in all five dialogs.
3. Literal `inert` and `aria-hidden` application and cleanup.
4. A visible computed focus outline.
5. CSV dialog geometry at a 390 by 844 viewport with no horizontal overflow.
6. A clean console after desktop and mobile interaction checks.
7. Live-region roles, priorities, atomic announcements, busy states, and file-error relationships in the rendered dialogs.

## Remaining Release Work

Before describing the web product as accessibility-audited, run automated WCAG checks and manual screen-reader testing with VoiceOver/Safari and NVDA/Firefox or NVDA/Chrome. Cover dashboard reading order, form validation announcements, dynamic sync and payment status behavior, calendar navigation, color contrast, browser zoom, and notification-permission flows in addition to the dialog matrix above.
