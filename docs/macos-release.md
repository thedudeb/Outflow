# macOS Release Readiness

Outflow produces a hardened-runtime macOS application with a complete sealed-resource signature and a headless ZIP distribution container. The default build uses Apple's ad-hoc identity (`-`) and is intentionally rejected by Gatekeeper. It is release-readiness evidence, not a public desktop release.

The production path requires an operator-owned Developer ID Application certificate and successful Apple notarization. Tauri accepts the installed identity through `APPLE_SIGNING_IDENTITY` and supports App Store Connect API or Apple ID notarization credentials. The repository never stores those credentials or uploads a desktop artifact from the default Quality workflow.

## Readiness Build

Run:

```sh
npm run desktop:release
npm run check:desktop:release
```

The build creates:

- `src-tauri/target/release/bundle/macos/Outflow.app`
- `src-tauri/target/release/bundle/macos-release/Outflow_0.1.0_<architecture>.zip`

The checker requires the production `com.thedudeb.outflow` identifier, version `0.1.0`, finance category, expected executable and icon, 64-bit Mach-O code, hardened runtime, a complete sealed-resource inventory, an empty entitlement boundary, and valid strict deep signatures before and after archive extraction. It also requires the default build to have no Team ID or notarization ticket and to fail Gatekeeper distribution assessment.

## Production Environment Preflight

The protected release environment must set:

```text
APPLE_SIGNING_IDENTITY=Developer ID Application: <name> (<team id>)
OUTFLOW_MACOS_EXPECTED_TEAM_ID=<team id>
```

CI may additionally provide `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` together for Tauri to import an exported certificate. They are optional when the Developer ID identity is already installed in the build keychain.

Configure exactly one notarization mode:

```text
APPLE_API_KEY
APPLE_API_ISSUER
APPLE_API_KEY_PATH
```

or:

```text
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
```

Run `npm run check:desktop:release-environment` before building. The preflight requires a canonical Developer ID identity whose Team ID matches the independent pin, rejects partial or mixed notarization modes, and requires an API private key to be a private regular file outside the repository. It reports field names and policy errors without echoing values.

## Protected GitHub Workflow

`.github/workflows/macos-release.yml` is a manual, `main`-only production path. Its `macos-production` environment must have deployment-branch protection and required reviewers before credentials are added.

Configure these environment variables:

```text
OUTFLOW_MACOS_SIGNING_IDENTITY
OUTFLOW_MACOS_TEAM_ID
OUTFLOW_APPLE_API_KEY
OUTFLOW_APPLE_API_ISSUER
```

Configure these environment secrets:

```text
OUTFLOW_APPLE_CERTIFICATE
OUTFLOW_APPLE_CERTIFICATE_PASSWORD
OUTFLOW_APPLE_API_PRIVATE_KEY
```

`OUTFLOW_APPLE_CERTIFICATE` is the certificate payload accepted by Tauri and its password must be stored separately. The workflow installs locked dependencies and passes release policy tests before exposing any production secret. It then writes the App Store Connect private key to a `0600` file in the ephemeral runner directory, binds the release to the exact `main` commit, imports the certificate only for preflight and build steps, and removes the private key before inspecting or uploading the result.

The workflow uploads only the verified notarized ZIP and `SHA256SUMS.txt` as a GitHub Actions release-candidate artifact named for the exact commit, with seven-day retention. Under [GitHub's workflow-artifact access rules](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts), signed-in users with repository read access can download artifacts; in a public repository this is intentionally treated as a review candidate rather than private storage. It does not create a GitHub Release, publish an ad-hoc artifact, or upload the raw `.app`. Promotion remains a separate operator decision after clean-machine acceptance.

## Operator Release Procedure

1. Create or import an operator-owned Developer ID Application certificate and confirm it appears in `security find-identity -v -p codesigning`.
2. Configure the pinned Team ID and one complete notarization mode in a protected macOS build environment.
3. Run `npm run check:desktop:release-environment`.
4. Run `npm run desktop:release`. Tauri signs, submits, and staples the `.app` before the wrapper creates the ZIP.
5. Verify the distributable artifact:

```sh
OUTFLOW_MACOS_EXPECT_DISTRIBUTABLE=true \
OUTFLOW_MACOS_EXPECTED_TEAM_ID="<team id>" \
npm run check:desktop:release
```

The distributable mode rejects ad-hoc signatures, requires the exact Team ID and Developer ID authority, validates the stapled ticket, requires Gatekeeper's notarized Developer ID assessment, and repeats those checks after extracting the ZIP.

## Remaining Acceptance

Before publication, complete a protected Developer ID build, Apple notarization and stapling, clean-machine download and first-launch checks, signed in-place upgrade and rollback testing, native notification permission/delivery acceptance, configured account callback and synchronization testing, VoiceOver and text-scaling review, privacy disclosures, distribution-channel policy, and incident/rollback ownership. Ad-hoc Quality artifacts must never be presented as installable public releases.

See Tauri's official [macOS code-signing guide](https://v2.tauri.app/distribute/sign/macos/) for certificate and notarization setup.
