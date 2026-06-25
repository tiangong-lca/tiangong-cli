---
title: CLI Release Setup
docType: guide
scope: repo
status: active
authoritative: false
owner: cli
language: en
whenToUse:
  - when configuring repository, token, or npm Trusted Publishing prerequisites for CLI releases
whenToUpdate:
  - when release workflow filenames, token names, Trusted Publishing settings, or tag semantics change
checkPaths:
  - docs/release-setup.md
  - .github/workflows/publish.yml
  - .github/workflows/tag-release-from-merge.yml
  - .githooks/pre-push
  - scripts/docpact
  - scripts/docpact
  - scripts/docpact-gate.sh
  - scripts/install-git-hooks.sh
lastReviewedAt: 2026-06-25
lastReviewedCommit: bd2feb36414f4b96508725ace0ca071e6a3e3bc4
related:
  - ../AGENTS.md
  - ../.docpact/config.yaml
  - ./release-runbook.md
  - ./agents/repo-validation.md
---

# Release Setup

This document captures the one-time repository and registry configuration required for the `tiangong-lca-cli` npm release workflows.

For the repeatable per-release operator steps, see [release-runbook.md](./release-runbook.md).

Recommended model:

- maintainers open a normal release-prep PR from `main`
- the PR updates `package.json` and `package-lock.json` version metadata for the next CLI release
- after that PR merges, `tag-release-from-merge.yml` creates the immutable package tag
- `publish.yml` publishes the package from that tag through npm Trusted Publishing
- maintainers do not run local `npm publish` for routine releases

Current workflow files:

- `.github/workflows/tag-release-from-merge.yml`
- `.github/workflows/publish.yml`

Review note, 2026-06-04: `dataset curation-queue next/verify` does not change release workflow files, token names, Trusted Publishing settings, or tag semantics.

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

Review note, 2026-06-02: adding the dataset curation queue command does not change Trusted Publishing, release token, tag, or workflow setup.

Release 0.0.11 note, 2026-06-02: package version bump only; no repository secret, Trusted Publisher, tag, or workflow setup change is required.

Release 0.0.12 note, 2026-06-05: package version bump only; no repository secret, Trusted Publisher, tag, workflow filename, or GitHub environment setup change is required.

Release 0.0.13 note, 2026-06-06: package version and lockfile bump only; no repository secret, Trusted Publisher, tag, workflow filename, or GitHub environment setup change is required. The operator path is PR merge to upstream `main`, then GitHub Actions tag and publish.

Release 0.0.14 note, 2026-06-07: package version and lockfile bump only; no repository secret, Trusted Publisher, tag, workflow filename, or GitHub environment setup change is required. The release includes a deterministic location apply fix and uses the same PR merge to upstream `main`, tag, and npm Trusted Publishing path.

Release 0.0.15 note, 2026-06-11: package version and lockfile bump only; no repository secret, Trusted Publisher, tag, workflow filename, or GitHub environment setup change is required. The release includes the `dataset import-lca convert` adaptation to tidas-tools 0.0.28 process-bundle flags and uses the same PR merge to upstream `main`, tag, and npm Trusted Publishing path.

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

- `publish.yml` validates that the Git tag matches the package version before upload and supports `workflow_dispatch` for existing-tag recovery/backfill.
- `tag-release-from-merge.yml` only creates a tag when `package.json` version changes on `main`, and it runs `npm run prepush:gate` before creating that tag. If the expected tag already points at the current merge commit, the tag step is idempotent; if it points elsewhere, the workflow fails.
- The release-prep PR should update only the intended versioned release metadata for the CLI package, normally `package.json` and `package-lock.json`.
- Local workstations may run `npm pack --dry-run` for package validation, but routine npm publication belongs to GitHub Actions Trusted Publishing after the upstream `main` merge.
- Adding CLI command families such as dataset or lifecyclemodel maintenance commands does not require release setup changes by itself; those feature PRs are covered by the normal quality and docpact gates before a later version bump.

## Local Docpact Push Gate

The repository now includes a local pre-push gate that runs `scripts/docpact-gate.sh` and then `npm run prepush:gate`. It is the ordinary local validation path; release workflows still run release gates before tag creation or npm publishing.
