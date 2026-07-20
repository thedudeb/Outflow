# Cross-Platform Accessibility Acceptance

**Target:** WCAG 2.2 Level AA for Outflow-controlled content and interactions

**Current status:** Automated shared-UI, production PWA, deployed-site, keyboard, reflow, target-size, text-spacing, reduced-motion, forced-colors, and conditional-state gates are implemented. Manual assistive-technology acceptance remains required for a formal conformance claim.

This contract covers the shared React interface plus the macOS, iPhone, iPad, and Android shells. A passing web scan does not by itself approve a native release: WebView accessibility trees, OS settings, permission prompts, notifications, file/date pickers, and update controls must be exercised on their actual platform.

## Evidence Record

For every manual run, record:

- Candidate commit, app version, build source, and installation method.
- Device model, OS version, browser or WebView version, and assistive-technology version.
- Input mode and settings, including browser zoom, font size, display size, contrast, motion, and orientation.
- Tester, date, workflow result, defect links, screenshots or recordings when they do not expose private financial data.
- Final result as Pass, Pass with documented exception, or Fail.

Never record real subscription names, access codes, private calendar URLs, account exports, or other service secrets in accessibility evidence.

## Shared Workflow

Complete every item without relying on color, pointer hover, or visual position alone:

1. Launch Outflow, use Skip to main content, and identify the page title, current list, connection state, and summary values.
2. Add, edit, pause, resume, and delete a subscription. Confirm required fields, invalid values, successful changes, and destructive confirmation are announced.
3. Change weekly, monthly, and yearly billing, trial end, category, color tag, currency, and reminder timing.
4. Navigate the billing calendar by keyboard or equivalent assistive-technology commands. Confirm selected date, today, charge count, and total remain distinguishable.
5. Open and dismiss Account / Pro, Calendar export, Subscription lists, Alert controls, and CSV import using their close control, Escape or platform equivalent, and backdrop where a pointer is available. Confirm focus returns to the trigger.
6. Export CSV, calendar, and full-list backup; import a valid and invalid file; confirm status and errors are announced without exposing secret content.
7. Exercise guest, signed-in Free, beta Pro, paid Pro, shared-list member, expired invitation, refunded entitlement, maintenance, offline, update-ready, and operation-failure states available to the candidate.
8. Enable and deny notifications. Confirm the permission result and Outflow status are understandable, and inspect the delivered notification without opening the app.
9. Confirm all controls have understandable names, role, state, and value; headings and landmarks support efficient navigation; no focus is lost or trapped outside a modal.
10. Confirm content remains usable at 200% browser zoom or platform text scaling, with long tester names, emails, currencies, and translated date formats where available.

## Web and Installed PWA

Run both browser tabs and the installed PWA:

- VoiceOver with current Safari on macOS.
- NVDA with current Firefox and Chrome on Windows.
- Keyboard-only at 100% and 200% zoom, then at a 320 CSS-pixel reflow width.
- Reduced Motion, increased contrast or forced colors where supported, and custom WCAG text spacing.
- Online launch, offline relaunch, offline edit, reconnection, install prompt, update-ready prompt, accepted update, and retained local data after reload.

Expected result: browser and installed modes expose the same names, order, status announcements, focus behavior, data, and controls. Update and connectivity changes are polite live announcements and do not move focus unexpectedly.

## macOS client

Test the signed candidate on a clean supported Mac:

- VoiceOver with Quick Nav both on and off, Full Keyboard Access, and keyboard-only navigation.
- Increased display scaling, Increase Contrast, Reduce Motion, and Differentiate Without Color.
- Native notification permission, Notification Center delivery, signed update availability, download progress, retry, restart, and retained local data.
- Window resizing down to the supported minimum and restoration after relaunch.

Expected result: the WKWebView exposes the same semantic hierarchy as Safari. The title and first meaningful content are announced at launch, update progress is announced once per meaningful change, and native prompts return focus to a sensible Outflow control.

## iPhone and iPad

Test portrait and landscape on physical phone and tablet candidates:

- VoiceOver touch exploration, rotor navigation by headings, controls, form fields, and landmarks.
- Dynamic Type at 200% and the largest accessibility size, Display Zoom, Reduce Motion, Increase Contrast, and Differentiate Without Color.
- Switch Control through the complete shared workflow without a hardware keyboard, then repeat core form and modal flows with a hardware keyboard.
- Native date/file controls, notification permission and delivery, background/foreground restoration, TestFlight or App Store update, and preserved local data.

Expected result: touch targets are reachable without overlap, reading and focus order follow the visual workflow, orientation changes retain context, and no control or financial value is clipped at the required text sizes.

## Android phone and tablet

Test portrait and landscape on physical phone and tablet candidates:

- TalkBack touch exploration and reading controls, headings, links, form fields, and live regions.
- Font size at 200%, largest display size, high-contrast text where available, Remove animations, and color correction or grayscale.
- Switch Access through the complete shared workflow and external-keyboard navigation of forms, dialogs, and the calendar.
- Native date/file controls, notification permission and delivery, Play flexible-update consent, download, the Outflow update ready Snackbar, Restart action, and retained local data.

Expected result: TalkBack announces the update-ready message and Restart action, system back behavior does not discard work silently, and WebView focus does not jump to browser chrome or disappear after native prompts.

## Severity and Release Decision

- **Blocker:** A core workflow cannot be completed with an assistive technology; focus is lost or trapped; private data is announced outside its context; content is absent at 200%; or a destructive action is not identifiable. Do not release.
- **Major:** Incorrect name, role, state, order, announcement, target, contrast, or reflow materially impedes a workflow. Fix before broad distribution unless the product owner documents a narrow exception and accessible alternative.
- **Minor:** Friction that does not prevent or materially obscure completion. Track with an owner and target release.

A platform passes only when it has no open Blocker or Major defects, all shared and platform workflows have evidence on the release candidate, and an accessibility reviewer signs the result. Automated CI is required evidence but never substitutes for this manual decision.
