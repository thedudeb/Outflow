# iOS Release Readiness

Outflow can build an App Store Connect IPA through the pinned Tauri CLI and inspect its production identity, package metadata, code signature, entitlements, and embedded provisioning profile. The default Quality workflow continues to build only an unsigned Simulator app and receives no Apple signing material.

Passing these checks proves the protected signing pathway and one exact IPA. It does not upload to App Store Connect, establish TestFlight or App Store acceptance, or replace real-device and accessibility acceptance.

## Signing Boundary

The production path uses the manual signing inputs supported by Tauri:

```text
IOS_CERTIFICATE
IOS_CERTIFICATE_PASSWORD
IOS_MOBILE_PROVISION
```

`IOS_CERTIFICATE` is a base64-encoded Apple Distribution PKCS #12 file. `IOS_MOBILE_PROVISION` is a base64-encoded App Store distribution profile restricted to `com.thedudeb.outflow`. Store neither decoded file nor either secret in the repository.

The independent release policy also requires:

```text
OUTFLOW_IOS_EXPECTED_TEAM_ID
OUTFLOW_IOS_EXPECTED_CERT_SHA256
OUTFLOW_IOS_BUILD_NUMBER
```

Run `npm run check:mobile:ios-release-environment` before building. It decodes signing material only into a private temporary directory, passes the certificate password to OpenSSL through the environment rather than the process argument list, proves that the PKCS #12 contains the matching private key, and always removes the temporary files. It requires a currently valid Apple Distribution certificate and App Store profile with at least 30 days remaining, exact Team ID and certificate pins, the production bundle identifier, debugging disabled, no registered devices, and only the app's approved entitlement and keychain-group set. Error output names fields and policies without printing values.

## Build And Inspection

After the preflight passes, run:

```sh
npm run mobile:ios:release
npm run check:mobile:ios-release
```

The release command invokes `tauri ios build --ci --target aarch64 --export-method app-store-connect` with the configured build number. Tauri appends that number to the application version, so version `0.1.0` and build `42` produce `CFBundleVersion` `0.1.0.42`. The resulting candidate is expected at:

```text
src-tauri/gen/apple/build/arm64/Outflow.ipa
```

The inspector rejects unsafe or ambiguous ZIP structure, requires one `Payload/Outflow.app`, verifies production identifier/version/platform/minimum OS metadata, checks the ARM64 executable and compiled assets, runs strict deep `codesign` verification, and requires the exact Team ID and independently pinned signing certificate. It also checks the signed entitlements and embedded App Store profile against the same narrow allowlist and expiry policy.

## Protected GitHub Workflow

`.github/workflows/ios-release.yml` is a manual, `main`-only acceptance path. Configure deployment-branch protection and required reviewers on the `ios-production` environment before adding credentials.

Configure these environment variables:

```text
OUTFLOW_IOS_TEAM_ID
OUTFLOW_IOS_DISTRIBUTION_CERT_SHA256
```

Record the certificate's 32-byte SHA-256 fingerprint through a trusted channel independent of the uploaded PKCS #12 secret.

Configure these environment secrets:

```text
OUTFLOW_IOS_CERTIFICATE_BASE64
OUTFLOW_IOS_CERTIFICATE_PASSWORD
OUTFLOW_IOS_MOBILE_PROVISION_BASE64
```

The workflow installs locked dependencies, passes release contracts, and builds plus inspects an unsigned Simulator baseline before exposing any production secret. Secrets are scoped only to real-material preflight and signed-build steps. The post-build inspector receives only the Team ID, certificate fingerprint, build number, and exact commit.

Because this is a public repository, the workflow uploads no IPA, archive, certificate, profile, or generic Actions artifact. Its job summary retains only the exact commit and ephemeral IPA SHA-256 hash. App Store Connect upload remains a separate protected operator action after device, accessibility, privacy, and policy acceptance.

## Operator Procedure

1. Export and securely back up the operator-owned Apple Distribution certificate, and create an App Store Connect provisioning profile for `com.thedudeb.outflow` containing that certificate.
2. Record the Team ID and certificate SHA-256 fingerprint through an independent trusted channel.
3. Add the two variables and three secrets to the protected `ios-production` GitHub environment.
4. Dispatch `iOS Production Signing Acceptance` from the exact `main` commit and review the bounded hash evidence.
5. Retrieve or rebuild the same candidate only through a protected operator environment, repeat `npm run check:mobile:ios-release`, and upload it to App Store Connect without publishing it as a general CI artifact.
6. Complete signed upgrade, real-device, notification, VoiceOver, text-scaling, configured-service, privacy-disclosure, TestFlight, and staged-release checks before promotion.

See Tauri's official [iOS code-signing guide](https://v2.tauri.app/distribute/sign/ios/) and [CLI reference](https://v2.tauri.app/reference/cli/) for the supported signing variables and export options.
