# Release Setup

This document captures the one-time repository and registry configuration required for the `tiangong-lca-cli` npm release workflows.

For the repeatable per-release operator steps, see [release-runbook.md](./release-runbook.md).

Recommended model:

- maintainers open a normal release-prep PR from `main`
- the PR updates `package.json` version for the next CLI release
- after that PR merges, `tag-release-from-merge.yml` creates the immutable package tag
- `publish.yml` publishes the package from that tag through npm Trusted Publishing

Current workflow files:

- `.github/workflows/tag-release-from-merge.yml`
- `.github/workflows/publish.yml`

Important constraint:

- if tag creation is automated, do not rely on the default workflow `GITHUB_TOKEN` for those tag pushes
- use a GitHub App token or fine-grained PAT so the downstream tag-triggered publish workflow can run as expected

Required secret:

- in `tiangong-lca/tiangong-cli`: `TIANGONG_CLI_RELEASE_AUTOMATION_TOKEN`

The current workflows expect a token that can:

- create tag refs in `tiangong-lca/tiangong-cli`
- read repository contents needed by the release automation

## GitHub Repository

GitHub Actions must be enabled for the repository.

The publish workflow file is fixed at:

- `.github/workflows/publish.yml`

Do not rename that workflow file without updating the npm Trusted Publisher configuration.

`npm-release` is optional. The current publish job uses npm Trusted Publishing without a GitHub deployment environment. Only create `npm-release` if you later decide to gate npm publishes with a GitHub environment, and update the npm Trusted Publisher configuration to match.

## npm Trusted Publisher

Configure Trusted Publishing for `@tiangong-lca/cli` on npm with:

- organization or user: `tiangong-lca`
- repository: `tiangong-cli`
- workflow filename: `publish.yml`

The publish job expects tags named `cli-vX.Y.Z`.

Leave the environment name unset unless the workflow is explicitly updated to use a GitHub environment for npm releases.

## Repository Settings

- GitHub-hosted runners must be used for trusted publishing.
- Maintainers should avoid long-lived `NPM_TOKEN` secrets once Trusted Publishing is configured.
- If the package name or repository name changes later, update both the workflow and the npm Trusted Publisher configuration before the next release.

## Operational Notes

- `publish.yml` validates that the Git tag matches the package version before upload.
- `tag-release-from-merge.yml` only creates a tag when `package.json` version changes on `main`.
- The release-prep PR should update only the intended versioned release metadata for the CLI package.
