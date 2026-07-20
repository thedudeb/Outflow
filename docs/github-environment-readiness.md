# GitHub Environment Readiness Contract

Outflow keeps external staging and production signing disabled until their GitHub environments are explicitly protected and configured. The versioned inventory in `config/github-environments.json` covers the `staging`, `macos-production`, `ios-production`, and `android-production` environments used by protected workflows.

## Protection Provisioning

The repository includes a dry-run-first command that creates only the non-secret environment shell, required reviewer rule, and exact `main` deployment branch policy:

```sh
npm run provision:github-environments -- --reviewer github-login
```

Review the complete plan, then apply it deliberately:

```sh
npm run provision:github-environments -- --reviewer github-login --apply
```

The command resolves one GitHub user, preserves existing reviewers, creates missing environments, and adds missing `main` policies. It refuses unexpected branch or tag policies instead of deleting them. It never requests, writes, or changes variables, secrets, or their values. Re-running it after a successful application is a no-op.

## Read-Only Check

Authenticate the GitHub CLI with repository-administration read access, then run:

```sh
npm run check:github-environments
```

Use `npm run check:github-environments -- --repo owner/repository` only when checking a fork with the same workflow contract. The command reads environment metadata, deployment branch policies, variable names, and secret names through `gh api`. Secret values are never requested, returned, logged, or included in the readiness report.

The check requires every environment to:

- Allow deployments from exactly `main` through a custom deployment branch policy.
- Require at least one reviewer before protected jobs can access environment settings.
- Contain every variable and secret name referenced by its repository workflows.

Additional settings are allowed because operators may need provider-specific metadata, but a workflow setting cannot be removed from the versioned inventory. `npm run test:github-environments` compares every `${{ vars.* }}` and `${{ secrets.* }}` workflow reference against that inventory in CI.

## Current Boundary

A live application on July 20, 2026 created all four repository environments, added `@thedudeb` as a required reviewer, and restricted deployments to the exact `main` branch. Re-running the protection plan returns no changes. The environments intentionally contain no provider or signing settings yet.

A `READY` report proves only that the GitHub control plane has the expected names and protection shape. It does not inspect values, validate provider credentials, deploy services, run signing jobs, prove reviewer identity, or satisfy staging, store, notarization, real-device, accessibility, or distribution acceptance. Run the applicable protected workflows and operator procedures after readiness passes.

A `BLOCKED` readiness report is expected until operator provisioning supplies every named setting. Environment protection can be `READY` while credential readiness remains `BLOCKED`; that is the intended state before external services and signing identities exist. Enter independently generated provider or signing material only through GitHub's environment settings. Do not place secret values in shell history, issues, documentation, repository variables, test fixtures, or commits.
