# Android Release Readiness

Outflow can build and inspect a minified ARM64 release APK and Android App Bundle. The repository verifies both an intentionally unsigned release-readiness build and a signed build made with a disposable test certificate. No production keystore, password, certificate, or Play Console credential belongs in the repository.

Passing these checks proves the release artifact and signing pathway. It does not make an artifact production-signed, Play-uploaded, policy-accepted, or real-device-accepted.

## Unsigned Release Gate

Run:

```sh
npm run mobile:android:release
npm run check:mobile:android-release
```

The build creates:

- `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`
- `src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`
- `src-tauri/gen/android/app/build/outputs/mapping/universalRelease/mapping.txt`

The checker requires the production `com.thedudeb.outflow` identifier, version `0.1.0` and code `1000`, API 24 minimum/API 36 target, a non-debuggable manifest, denied cleartext traffic, the restricted permission set, ARM64-only native code, 16 KB APK alignment, an R8 mapping file, and an unsigned APK/AAB. These artifacts are readiness evidence only and must not be distributed.

## Signing Boundary

The generated Gradle project reads a release signing identity only from a complete environment tuple:

```text
OUTFLOW_ANDROID_KEYSTORE_PATH
OUTFLOW_ANDROID_KEYSTORE_PASSWORD
OUTFLOW_ANDROID_KEY_ALIAS
OUTFLOW_ANDROID_KEY_PASSWORD
```

Providing any subset fails Gradle configuration before packaging. Values are not written to `tauri.properties`, source files, build reports, or repository-owned logs.

`npm run test:mobile:android-signing` exercises this boundary with a random password and a temporary self-signed test certificate outside the repository. It proves incomplete configuration is rejected, signs both artifacts, verifies their JAR/APK signatures against the exact certificate SHA-256 fingerprint, and deletes the temporary keystore. The resulting certificate is disposable and is not a production identity.

## Protected GitHub Workflow

`.github/workflows/android-release.yml` is a manual, `main`-only production upload-key acceptance path. Its `android-production` environment must have deployment-branch protection and required reviewers before credentials are added.

Configure these environment variables:

```text
OUTFLOW_ANDROID_KEY_ALIAS
OUTFLOW_ANDROID_UPLOAD_CERT_SHA256
```

The certificate fingerprint is an independent 32-byte SHA-256 pin recorded through a trusted channel, not calculated from the uploaded keystore secret during workflow configuration.

Configure these environment secrets:

```text
OUTFLOW_ANDROID_KEYSTORE_BASE64
OUTFLOW_ANDROID_KEYSTORE_PASSWORD
OUTFLOW_ANDROID_KEY_PASSWORD
```

The workflow installs the pinned toolchain, passes release policy tests, and builds plus inspects an unsigned baseline before exposing any signing secret. It then decodes the keystore into a `0600` file in the ephemeral runner directory, validates its private-key entry and independently pinned certificate, builds the signed APK/AAB, removes the keystore, and verifies both artifacts against the same certificate pin. The preflight uses Java 17 `keytool`'s documented [`-storepass:env` modifier](https://docs.oracle.com/en/java/javase/17/docs/specs/man/keytool.html) so the store password is not placed in the process argument list.

Because this repository is public and the R8 mapping file must travel with the eventual store release, the workflow uploads no APK, AAB, mapping file, keystore, or generic Actions artifact. It writes only the exact commit and SHA-256 hashes of the three ephemeral outputs to the bounded job summary. Play Console upload remains a separate protected operation after device and policy acceptance.

## Operator Release Procedure

1. Create and back up the production upload key outside the repository, restrict operator access, and record its SHA-256 certificate fingerprint through a separate trusted channel.
2. Configure all four signing variables in a protected build environment. Mask the three secret values and limit the keystore file to the release job.
3. Run `npm run mobile:android:release`.
4. Verify the exact expected certificate before an upload:

```sh
OUTFLOW_ANDROID_EXPECT_SIGNED=true \
OUTFLOW_ANDROID_EXPECTED_CERT_SHA256="<pinned fingerprint>" \
npm run check:mobile:android-release
```

5. Retain the matching R8 mapping file with the release and upload the AAB through a protected Play Console path. Never publish the APK/AAB or mapping file as a public CI artifact.
6. Set `https://thedudeb.github.io/Outflow/?view=privacy` as the Play privacy-policy URL, reconcile its version with the exact candidate's network/provider behavior and Data safety answers, then confirm Play App Signing enrollment, package identity, version code, target API, app-content declarations, pre-launch results, upgrade behavior, and staged rollout controls before promotion.

## Remaining Acceptance

Production readiness still requires an operator-owned upload key, Play Console configuration, signed in-place upgrade and rollback testing, phone/tablet real-device coverage, notification permission and delivery checks, configured-service callback/sync checks, TalkBack and text-scaling review, background-behavior decisions, candidate-specific privacy/Data safety acceptance, and Play policy acceptance. The default Quality workflow intentionally uses no production signing material and uploads no mobile artifact.
