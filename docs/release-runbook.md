---
title: CLI Release Runbook
docType: runbook
scope: repo
status: active
authoritative: false
owner: cli
language: en
whenToUse:
  - when preparing, verifying, or handing off an `@tiangong-lca/cli` release
whenToUpdate:
  - when per-release commands, tag verification, npm verification, or workspace follow-up changes
checkPaths:
  - docs/release-runbook.md
  - docs/release-setup.md
  - package.json
  - scripts/ci/**
  - .github/workflows/publish.yml
  - .github/workflows/tag-release-from-merge.yml
  - .githooks/pre-push
  - scripts/docpact
  - scripts/docpact
  - scripts/docpact-gate.sh
  - scripts/install-git-hooks.sh
lastReviewedAt: 2026-06-02
lastReviewedCommit: f9968a4f59ade568ddc97413501ceadade8bfb42
related:
  - ../AGENTS.md
  - ../.docpact/config.yaml
  - ./release-setup.md
  - ./agents/repo-validation.md
---

# CLI Release Runbook

This document is the operator runbook for each `@tiangong-lca/cli` release.

Use this document for:

- per-release prechecks
- version bump PR execution
- post-merge release verification
- workspace follow-up

Do not use this document for one-time repository or npm registry setup. For one-time setup, see [release-setup.md](./release-setup.md).

## Preconditions

Before starting a release:

- work from the latest `main`
- keep the release-prep change scoped to CLI package version metadata
- confirm npm has not already published the target version
- confirm any command-surface feature PRs that will be included in the release have passed the local pre-push gate, including `npm run prepush:gate` and docpact, before preparing the version bump

Useful commands:

```bash
git fetch origin
git checkout main
git merge --ff-only origin/main

npm ci
npm run prepush:gate
node ./scripts/ci/release-version.cjs next-version --part patch
node ./scripts/ci/release-version.cjs assert-unpublished --version <x.y.z>
npm pack --dry-run >/dev/null
```

`next-version` is only a helper for choosing the next version. The actual release version is whatever you put into `package.json`.

## Release-Prep PR

1. Create a dedicated branch from `main`.
2. Update the CLI package version metadata:
   - `package.json`
   - `package-lock.json`
3. Keep the PR focused on the release bump.
4. Open a normal PR with local pre-push gate evidence. Use the manual `quality-gate` workflow only when remote reproduction is needed.
5. Merge the PR into `main`.

Release automation starts only after the version bump PR is merged into `main`.

## Post-Merge Checks

After the PR merges, verify the release in this order.

### 1. Tag workflow

The merge to `main` should trigger:

- `.github/workflows/tag-release-from-merge.yml`

Check:

```bash
gh run list --repo tiangong-lca/tiangong-cli --workflow "Tag Release From Merge" --limit 3
gh api repos/tiangong-lca/tiangong-cli/git/ref/tags/cli-v<x.y.z>
```

Expected result:

- the workflow finishes successfully
- `npm run prepush:gate` runs inside the tag workflow before tag creation when a CLI version change is detected
- tag `cli-v<x.y.z>` exists

### 2. Publish workflow

The release tag should trigger:

- `.github/workflows/publish.yml`

Check:

```bash
gh run list --repo tiangong-lca/tiangong-cli --workflow "Publish Package" --limit 3
gh run watch <publish-run-id> --repo tiangong-lca/tiangong-cli
```

Expected result:

- `Publish Package` finishes successfully

If the tag exists but the publish workflow needs to be re-run with the current workflow definition, use the manual dispatch input:

```bash
gh workflow run publish.yml --repo tiangong-lca/tiangong-cli --field tag_name=cli-v<x.y.z>
```

### 3. npm registry

Confirm npm has the expected version:

```bash
npm view @tiangong-lca/cli version
npm view @tiangong-lca/cli dist-tags --json
```

Expected result:

- `version` equals `<x.y.z>`
- `latest` points to `<x.y.z>` unless this release intentionally uses a different dist-tag strategy

Do not update the workspace pointer until npm verification succeeds.

## Workspace Follow-Up

If the workspace tracks the CLI submodule, bump the workspace pointer only after:

- the child PR is merged
- the release tag exists
- the publish workflow succeeds
- npm resolves to the new version

From the workspace root, the release-aware helper can collapse that sequence into one command:

```bash
uv run python .agents/skills/lca-workspace-delivery-workflow/scripts/workflow_ops.py finalize-release-child-delivery \
  --repo cli \
  --issue <cli-issue-number> \
  --pr <cli-pr-number> \
  --parent <workspace-parent-issue-number>
```

For the CLI repo, that helper defaults to:

- package: `@tiangong-lca/cli`
- tag workflow: `Tag Release From Merge`
- publish workflow: `Publish Package`
- tag prefix: `cli-v`
- npm dist-tag check: `latest`

## Failure Handling

- If the version bump PR is not merged, no release should happen.
- If tag creation fails, fix the workflow or repository secret/config first. Do not manually continue the workspace bump.
- If publish fails, inspect the failed GitHub Actions run and npm/Trusted Publisher configuration before retrying the release flow.
- If the tag exists and points to the intended merge commit but publish did not run, re-run `publish.yml` with `tag_name=cli-v<x.y.z>`.
- If npm does not show the expected version yet, wait for registry propagation before treating the release as failed.

## Operator Checklist

- `package.json` and `package-lock.json` both bumped
- release-prep PR merged into `main`
- `Tag Release From Merge` succeeded
- `cli-v<x.y.z>` exists
- `Publish Package` succeeded
- `npm view @tiangong-lca/cli version` equals `<x.y.z>`
- workspace pointer updated only after all checks above passed

## Local Docpact Push Gate

The repository now includes a local pre-push gate that runs `scripts/docpact-gate.sh` and then `npm run prepush:gate`. It is the ordinary local validation path; release workflows still run their own release gates before creating tags or publishing.
