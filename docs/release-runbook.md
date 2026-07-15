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
lastReviewedAt: 2026-07-15
lastReviewedCommit: bd145f692b3fd11e398302dd6a1d2831e058883a
related:
  - ../AGENTS.md
  - ../.docpact/config.yaml
  - ./release-setup.md
  - ./agents/repo-validation.md
---

# CLI Release Runbook

This document is the operator runbook for each `@tiangong-lca/cli` release.

Review note, 2026-07-14: Issue #165 adds the guarded `dataset maintenance rebuild-derivatives` command profile but does not change the release procedure. Its command, contract, remote-adapter, asynchronous verification, and no-fallback tests must pass the existing pre-push/docpact gate before a later version-bump PR; the feature PR itself must not publish locally or alter package version metadata.

Review note, 2026-07-15: Issue #168 adds the production-only protected alias runner without changing package-version, tag, Trusted Publishing, or workspace follow-up mechanics. The feature PR must pass docpact and the full pre-push gate without changing package metadata. A separate patch release may start only after database-engine#262 reaches production and its schema/function/ACL readback passes; the release is still a dedicated version-bump PR and never a local publish.

Review note, 2026-07-15: Issue #171 adds production-read-only protected freeze generation and completely offline human-approval sealing without changing release mechanics. Its feature PR must keep package metadata at the current released version and pass focused contract/zero-write tests, exact 100% coverage, docpact, and the full pre-push gate. Only after that feature PR merges may a separate patch version-bump PR publish through the existing tag/Trusted Publishing workflows. A fresh production freeze is not permitted until the published package provenance/registry integrity is verified and the exact release commit is merged into root-workspace integration Issue #406.

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
- do not run local `npm publish` for routine releases; the canonical release path is a version-bump PR merged to upstream `main`, followed by tag creation and npm Trusted Publishing in GitHub Actions

Review note, 2026-06-02: dataset curation queue command additions follow the existing feature-then-release flow; release prep still remains a separate package metadata bump.

Review note, 2026-06-04: `dataset curation-queue next/verify` follows the same feature-then-release flow; no release command or tag semantics changed.

Review note, 2026-07-13: exact-count maintenance pagination follows the same feature-then-release flow. It changes runtime completeness checks and artifacts but does not change version-bump, tag, npm Trusted Publishing, or workspace follow-up semantics.

Release 0.0.11 note, 2026-06-02: prechecks are `node ./scripts/ci/release-version.cjs assert-unpublished --version 0.0.11`, `npm run prepush:gate`, and `npm pack --dry-run`.

Release 0.0.12 note, 2026-06-05: prechecks are `node ./scripts/ci/release-version.cjs assert-unpublished --version 0.0.12`, `npm run prepush:gate`, and `npm pack --dry-run`; no tag or publish workflow semantics changed.

Release 0.0.13 note, 2026-06-06: prechecks are `node ./scripts/ci/release-version.cjs assert-unpublished --version 0.0.13`, `npm run prepush:gate`, and `npm pack --dry-run`; this release adds `process save-draft --target-user-id` account/write guard support for batch import handoff.

Release 0.0.14 note, 2026-06-07: prechecks are `node ./scripts/ci/release-version.cjs assert-unpublished --version 0.0.14`, `npm run prepush:gate`, and `npm pack --dry-run`; this release lets `dataset classification apply --type location` create explicit missing location fields such as flow `locationOfSupply` while keeping ambiguous paths blocked.

Release 0.0.15 note, 2026-06-11: prechecks are `node ./scripts/ci/release-version.cjs assert-unpublished --version 0.0.15`, `npm run prepush:gate`, and `npm pack --dry-run`; this release adapts `dataset import-lca convert` to the tidas-tools 0.0.28 process-bundle CLI surface (no bare `--process-bundles` flag, `--no-process-bundles` forwarded when disabled) and derives report bundle/mapping file fields from on-disk state.

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

Release automation starts only after the version bump PR is merged into upstream `main`. A local workstation may run `npm pack --dry-run` for package validation, but it must not publish the package; local npm authentication and personal registry permissions are intentionally outside the release contract.

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
