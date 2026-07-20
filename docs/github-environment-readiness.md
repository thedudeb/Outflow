# GitHub Environment Readiness Contract

Outflow keeps external staging and production signing disabled until their GitHub environments are explicitly protected and configured. The versioned inventory in `config/github-environments.json` covers the `staging`, `macos-production`, `ios-production`, and `android-production` environments used by protected workflows.

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

A `READY` report proves only that the GitHub control plane has the expected names and protection shape. It does not inspect values, validate provider credentials, deploy services, run signing jobs, prove reviewer identity, or satisfy staging, store, notarization, real-device, accessibility, or distribution acceptance. Run the applicable protected workflows and operator procedures after readiness passes.

A `BLOCKED` report is expected before operator provisioning. Add environments and branch/reviewer protection first, then enter independently generated provider or signing material through GitHub's environment settings. Do not place secret values in shell history, issues, documentation, repository variables, test fixtures, or commits.
