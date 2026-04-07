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
4. Open a normal PR and wait for `quality-gate` to pass.
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
- If npm does not show the expected version yet, wait for registry propagation before treating the release as failed.

## Operator Checklist

- `package.json` and `package-lock.json` both bumped
- release-prep PR merged into `main`
- `Tag Release From Merge` succeeded
- `cli-v<x.y.z>` exists
- `Publish Package` succeeded
- `npm view @tiangong-lca/cli version` equals `<x.y.z>`
- workspace pointer updated only after all checks above passed
