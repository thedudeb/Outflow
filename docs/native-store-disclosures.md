# Native Store Privacy Disclosures

**Status:** Draft, not submitted; exact signed candidate review required

Outflow's canonical native local-guest answer set is [`store-disclosures/native-local-guest.json`](../store-disclosures/native-local-guest.json). It applies only to version `0.1.0` candidates for `com.thedudeb.outflow` built without account or hosted-service configuration. It is operator input for App Store Connect and Play Console, not evidence that either store has reviewed or accepted the app.

The repository checker binds the draft answers to the public policy version, Tauri identity and version, JavaScript dependency lock, Android Gradle dependencies, iOS privacy manifest, Android source permissions, disabled Android backup, denied production cleartext traffic, and absent Supabase browser configuration. SHA-256 pins make a dependency, manifest, or production network-policy change require explicit review. Both native release wrappers inspect the process environment and `.env`, `.env.local`, `.env.production`, and `.env.production.local`; any hosted browser value stops packaging without printing its value. The signed IPA and Android release inspectors repeat the disclosure check before accepting an artifact.

## Current Data Boundary

- Subscription records, ledgers, trial dates, tags, notification rules, and preferences remain in the application sandbox.
- Immediate device notifications are generated from local records. Outflow does not operate a notification server in this candidate.
- CSV, backup, and calendar exports occur only after a user command. A user controls the resulting file and any later transfer.
- The package contains no configured Supabase account, synchronization, Resend email, hosted calendar, Stripe payment, analytics, advertising, tracking, or bank-connection service.
- Android requests internet access for the WebView runtime and user-selected web links, but this candidate has no configured Outflow service destination. Production cleartext traffic is denied.
- Android release builds ask Google Play Core whether a Play-approved update is available. Google Play owns consent, download, signature verification, and installation; Outflow receives transient availability and install status and does not retain update history. Debug and non-Play installs do not use this path.
- iOS updates remain App Store/TestFlight-managed, and the app does not fetch replacement executable code.
- The repository has not commissioned an independent mobile security review and does not claim a Google Play Families badge.

Apple states that data processed only on a device is not collected for App Privacy answers. Google defines collection as transmission off device and excludes data processed only on device. Both platforms require answers to include applicable third-party code and controlled webview behavior. The operator must therefore repeat the candidate review whenever code, dependencies, destinations, permissions, entitlements, or configuration changes.

## App Store Connect

Use these answers for the exact local guest candidate:

| Field | Draft answer |
| --- | --- |
| Privacy Policy URL | `https://thedudeb.github.io/Outflow/?view=privacy` |
| Privacy Choices URL | `https://thedudeb.github.io/Outflow/?view=privacy` |
| Data collection | **No, we do not collect data from this app** |
| Collected data types | None |
| Tracking | No |

App Privacy responses are app-level and must represent every platform in the App Store record. Do not publish this answer if another included platform or third-party component transmits user data. The separate `PrivacyInfo.xcprivacy` required-reason declaration remains mandatory and does not replace these App Store Connect answers.

## Google Play

Use these answers for the exact local guest candidate:

| Form | Field | Draft answer |
| --- | --- | --- |
| Data safety | Does the app collect or share required user data types? | **No** |
| Data safety | Collected or shared data types | None |
| Data safety | Independent security review | No |
| Data safety | Families policy badge | No |
| Financial features | Selection | **Other** |
| Financial features | Operator scope note | Local subscription and recurring-charge tracking only; no bank connection, payment execution, lending, financial advice, investing, insurance, credit reporting, or money transfer. |

The `Other` selection is conservative because Outflow is categorized as Finance and helps users track recurring expenses, while offering none of the named banking, payment, lending, trading, advice, insurance, or credit services. Google requires every published app to complete both the Data safety and Financial features declarations, including apps that report no collection or no financial features.

## Verification And Submission

Run before exposing signing credentials:

```sh
npm run test:mobile:store-disclosures
npm run check:mobile:store-disclosures
```

Then build and inspect the exact candidate through the platform release procedure. Before entering or publishing answers in either console, review the signed IPA or AAB plus its dependency lock, permissions, entitlements, privacy manifest, network destinations, WebView links, export behavior, and notification behavior. Confirm that the policy version and store URLs are still public. Record the submitted answer version and candidate hash in the private operator release record.

Accounts, hosted services, analytics, advertising, tracking, new SDKs, new network destinations, permission or entitlement changes, export or notification changes, and version or policy changes invalidate this draft until it is reviewed and updated. Store acceptance, legal review, real-device acceptance, and accessibility acceptance remain separate release gates.

Authoritative references: [Apple Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy), [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/), [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Google Play Data safety](https://support.google.com/googleplay/android-developer/answer/10787469), [Google Play Financial features](https://support.google.com/googleplay/android-developer/answer/13849271), and [Google Play in-app updates](https://developer.android.com/guide/playcore/in-app-updates).
