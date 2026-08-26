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
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - scripts/ci/**
  - .github/workflows/quality-gate.yml
  - .github/workflows/publish.yml
  - .github/workflows/tag-release-from-merge.yml
  - .githooks/pre-push
  - scripts/docpact
  - scripts/docpact
  - scripts/docpact-gate.sh
  - scripts/install-git-hooks.sh
lastReviewedAt: 2026-08-26
lastReviewedCommit: 76a1693a64e7153bb63031c00d7f016c88096e3e
lastReviewedNote: 'Reviewed for Issue #232: feature delivery stays at 0.1.1; typed public primitives require a separate release-only PR and the existing matrix, provenance, registry, and integration gates.'
related:
  - ../AGENTS.md
  - ../.docpact/config.yaml
  - ./release-setup.md
  - ./agents/repo-validation.md
---

# CLI Release Runbook

This document is the operator runbook for each `@tiangong-lca/cli` release.

Review note, 2026-08-25: Issue #224 keeps the feature branch at 0.0.33 while replacing the repository toolchain with Node 24, pnpm 11.23.0, TypeScript 7.0.2, and Oxlint. Because that migration changes maintainer and release compatibility, prepare 0.1.0 in a separate release-only PR after the feature PR merges and `test:package`, exact 100% coverage, package inspection, Docpact, and release automation all pass. Historical npm-era notes below are retained only as dated evidence and are not current commands.

Review note, 2026-08-25: Issue #226 is that dedicated 0.1.0 release-only delivery for merged Issue #224 / PR #225. It updates package version metadata and the four live CLI-version fixtures, and adds test-only proof for ESM/CJS hosts importing the existing explicit bin launcher subpath, while keeping runtime files, package-root exports, dependencies, and `pnpm-lock.yaml` unchanged. Before merge it must prove npm/tag absence, package/prepush/audit/Docpact and the exact four-platform matrix; after merge it must prove `cli-v0.1.0` identity, native pnpm Trusted Publishing/provenance, the public-registry consumer, and exact released-commit workspace integration.

Review note, 2026-08-25: Issue #228 adds a feature command and a local-only production read-case script without changing package version, tag creation, Trusted Publishing, provenance, or workspace follow-up mechanics. The ignored production test credential remains local and must never enter GitHub Actions or npm release configuration. After the feature merges, any public package delivery still uses a separate version-only release PR and every existing post-merge registry/provenance/integration check below.

Review note, 2026-08-25: Issue #230 is that separate 0.1.1 release. It keeps the published runtime dependency graph unchanged while adding exact `sigstore@5.0.0` to the dev-only verification graph and regenerating the sole pnpm lock for that reviewed change. `.nvmrc`, engines, all workflows, tests, and active docs pin latest-stable Node 24.19.0. The four-platform workflow is reusable, asserts actual platform/architecture, and blocks tag creation. `release:verify-published` cryptographically verifies the SLSA bundle against the GitHub OIDC issuer, exact workflow/tag certificate identity, certificate transparency and Rekor, binds its `gitCommit` and tarball sha512, runs pnpm registry-signature verification, isolates user/global package-manager configuration, pins pnpm 11.23.0, scans all production dependency sections, and exercises clean bin/ESM/CJS consumers. The child finish continuation owns root integration create/reuse and child completion; operators never create a parallel task or finish the child twice. Local publication and manual tag creation remain forbidden.

Review note, 2026-08-26: Issue #232 is a feature delivery for typed CommandSpec/batch/run-lock subpaths and keeps package version 0.1.1. It adds no dependency, secret, tag, or alternate publish path. A later release-only PR must advance the version and rerun the existing matrix, provenance, registry, packed ESM/CJS/TS public-subpath consumer, and exact workspace-integration gates before downstream repositories pin the new API.

Review note, 2026-07-14: Issue #165 adds the guarded `dataset maintenance rebuild-derivatives` command profile but does not change the release procedure. Its command, contract, remote-adapter, asynchronous verification, and no-fallback tests must pass the existing pre-push/docpact gate before a later version-bump PR; the feature PR itself must not publish locally or alter package version metadata.

Review note, 2026-07-15: Issue #168 adds the production-only protected alias runner without changing package-version, tag, Trusted Publishing, or workspace follow-up mechanics. The feature PR must pass docpact and the full pre-push gate without changing package metadata. A separate patch release may start only after database-engine#262 reaches production and its schema/function/ACL readback passes; the release is still a dedicated version-bump PR and never a local publish.

Review note, 2026-07-15: Issue #171 adds production-read-only protected freeze generation and completely offline human-approval sealing without changing release mechanics. Its feature PR must keep package metadata at the current released version and pass focused contract/zero-write tests, exact 100% coverage, docpact, and the full pre-push gate. Only after that feature PR merges may a separate patch version-bump PR publish through the existing tag/Trusted Publishing workflows. A fresh production freeze is not permitted until the published package provenance/registry integrity is verified and the exact release commit is merged into root-workspace integration Issue #406.

Review note, 2026-07-16: Issue #175 fixes bounded client clock-skew validation without changing release mechanics. The feature PR keeps package metadata unchanged and must pass focused timing/one-shot tests, exact coverage, docpact, and the full pre-push gate. Recovery then requires a separate patch version-bump PR, Trusted Publishing verification, and a new root-workspace integration before any fresh protected freeze.

Review note, 2026-07-16: Issue #177 changes only cross-platform tests needed to make the existing four-platform quality matrix authoritative. It does not alter package metadata, tag creation, Trusted Publishing, release eligibility, protected-execution behavior, or the requirement for a separate 0.0.27 release PR after all matrix jobs pass.

Review note, 2026-07-16: Issue #178 is that separate 0.0.27 release PR. It must prove the version is unpublished, retain exact coverage and all four platform results, and use the existing merge-triggered tag plus tag-triggered Trusted Publishing workflows. Local publish or manual tag creation remains forbidden; npm provenance and `gitHead` must match the immutable release merge commit before workspace integration starts.

Review note, 2026-07-16: Issue #182 fixes the protected terminal verifier without changing package metadata or release mechanics. Its feature PR must pass the production-shaped cross-hash-domain regression, exact coverage, docpact, and the full pre-push gate. Only after it merges may a separate patch version-bump PR use the existing tag and Trusted Publishing workflows; npm provenance and exact root-workspace integration must be verified before the existing protected request receives one status-only readback.

Review note, 2026-07-16: Issue #184 is that separate 0.0.28 release. It must prove the version and tag are absent, retain exact coverage and all four platform results, pass AI Doc Lint and Docpact, and use only the existing merge-triggered tag plus tag-triggered Trusted Publishing workflows. Local publish or manual tag creation remains forbidden; npm provenance and `gitHead` must match the immutable release merge commit before workspace integration and status-only verification.

Review note, 2026-07-16: Issue #186 adds an LCI/LCIA data-release command family but does not change this npm package-release procedure. The feature PR keeps package metadata unchanged and must pass focused release command tests, exact coverage, docpact, and the full pre-push gate; any later npm publication remains a separate version-bump PR through the existing tag and Trusted Publishing workflows.

Review note, 2026-07-17: Issue #191 fixes two Windows-only permission-test assumptions before the 0.0.29 release without changing package metadata or release mechanics. The test-only prerequisite must pass all four quality-matrix platforms before the existing dedicated version-bump PR is updated and merged.

Review note, 2026-07-17: Issue #189 is that separate 0.0.29 release. It must prove the version and tag are absent, retain exact coverage, pass AI Doc Lint and Docpact, and use only the merge-triggered tag plus tag-triggered npm Trusted Publishing workflows. Local publish and manual tag creation remain forbidden; npm provenance and `gitHead` must match the immutable release merge commit before workspace integration.

Review note, 2026-07-16: Issue #157 adds the Step 3 flow-identity feature without changing package metadata or release mechanics. Its feature PR must pass the exact DB contract, production-scale Preview capture timing, 100% CLI coverage, Docpact, and the full pre-push gate. A separate patch version-bump PR may begin only after database-engine #235 is promoted and deployed; production capture/plan/freeze still requires the released CLI plus a fresh exact human approval.

Review note, 2026-07-17: Issue #157 COMMON hardening now includes the DB/CLI one-wrapper rotating permit, strict create-only local claim as defense in depth, fresh exact recovery approval, and exact read-only scope lookup after response loss. This closes the protocol design boundary without changing version, tag, or Trusted Publishing mechanics. The Step 3 patch release remains gated on feature merge, database Preview validation/promotion, focused cross-contract evidence, and the separate coordinated DB/CLI release; local publish and manual tag creation remain forbidden.

Review note, 2026-07-23: Issue #194 adds the generic ordered owner-draft execution contract without changing package metadata or release mechanics. Its feature PR must pass focused ledger/recovery tests, exact 100% coverage, docpact, and the full pre-push gate. Any npm publication remains a separate version-bump PR through the existing merge-triggered tag and Trusted Publishing workflows; local publish and manual tag creation remain forbidden.

Review note, 2026-07-23: Issue #196 is the separate 0.0.30 release for merged Issue #194 / PR #195. It must prove the version and tag are absent, retain exact coverage, pass Docpact and the four-platform quality gate, including Windows durable-ledger creation/append/recovery, and use only the merge-triggered tag plus tag-triggered npm Trusted Publishing workflows. Local publish and manual tag creation remain forbidden; npm provenance and `gitHead` must match the immutable release merge commit before workspace integration.

Review note, 2026-07-23: Issue #198 is the 0.0.31 hotfix release for side-effect-free dataset save-draft validation. It must prove the exact input remains unchanged through contract binding and dispatch preparation, keep exact coverage, pass Docpact and the four-platform quality gate, and use only the merge-triggered tag plus tag-triggered npm Trusted Publishing workflows. Local publish and manual tag creation remain forbidden; npm provenance and `gitHead` must match the immutable release merge commit before workspace integration.

Review note, 2026-07-24: Issue #200 is the 0.0.32 hotfix release for bounded ordered-batch concurrency and current-owner token renewal. It must prove serial dependency-prefix completion, unique-target suffix concurrency no greater than 8, exact owner revalidation before dispatch, and unchanged durable attempt/no-replay behavior. Publication remains merge-triggered tag creation plus npm Trusted Publishing; local publish/manual tags remain forbidden, and npm provenance plus `gitHead` must match the release merge before workspace integration.

Review note, 2026-07-24: Issue #202 is the 0.0.33 release for bounded delete-only flow convergence. It must prove a complete visible-process inbound barrier, target uniqueness, owner/state exactness, durable dispatch-before-request evidence, exact absent readback, ambiguity no-replay, and independent-row continuation at concurrency no greater than 8. Publication remains merge-triggered tag creation plus npm Trusted Publishing; local publish/manual tags remain forbidden, and npm provenance plus `gitHead` must match the release merge before workspace integration or production deletion.

Review note, 2026-07-24: Issue #204 is a main-commit operational fix for the all-visible process preflight page size. The BAFU topology run binds the exact merged commit and built-file fingerprint; no package version, manual tag, local publish, or alternate release path is introduced by this fix.

Review note, 2026-07-25: Issue #206 is a main-commit operational fix that changes only the stable order of the same all-visible preflight to `(id, version)`. The BAFU topology run must bind the exact merged commit and built-file fingerprint; no package version, tag, publish, credential, or alternate release path is introduced.

Review note, 2026-07-25: Issue #208 is a main-commit operational fix that admits a separately captured, SHA-approved all-process SELECT-only proof before bounded flow deletion. Production use must bind the exact merged commit, built-file fingerprint, proof file SHA, capture time, project/actor/plan, and target binding. No package version, tag, publish, credential, raw-SQL CLI path, or alternate mutation path is introduced.

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
- confirm any command-surface feature PRs that will be included in the release have passed the local pre-push gate, including `pnpm prepush:gate` and docpact, before preparing the version bump
- do not publish routinely from a local workstation; the canonical release path is a version-bump PR merged to upstream `main`, followed by tag creation and npm Trusted Publishing in GitHub Actions

Review note, 2026-06-02: dataset curation queue command additions follow the existing feature-then-release flow; release prep still remains a separate package metadata bump.

Review note, 2026-06-04: `dataset curation-queue next/verify` follows the same feature-then-release flow; no release command or tag semantics changed.

Review note, 2026-07-13: exact-count maintenance pagination follows the same feature-then-release flow. It changes runtime completeness checks and artifacts but does not change version-bump, tag, npm Trusted Publishing, or workspace follow-up semantics.

Historical npm-era release 0.0.11 note (retired; do not use as current instructions), 2026-06-02: prechecks were `node ./scripts/ci/release-version.cjs assert-unpublished --version 0.0.11`, `npm run prepush:gate`, and `npm pack --dry-run`.

Historical npm-era release 0.0.12 note (retired; do not use as current instructions), 2026-06-05: prechecks were `node ./scripts/ci/release-version.cjs assert-unpublished --version 0.0.12`, `npm run prepush:gate`, and `npm pack --dry-run`; no tag or publish workflow semantics changed.

Historical npm-era release 0.0.13 note (retired; do not use as current instructions), 2026-06-06: prechecks were `node ./scripts/ci/release-version.cjs assert-unpublished --version 0.0.13`, `npm run prepush:gate`, and `npm pack --dry-run`; this release added `process save-draft --target-user-id` account/write guard support for batch import handoff.

Historical npm-era release 0.0.14 note (retired; do not use as current instructions), 2026-06-07: prechecks were `node ./scripts/ci/release-version.cjs assert-unpublished --version 0.0.14`, `npm run prepush:gate`, and `npm pack --dry-run`; this release let `dataset classification apply --type location` create explicit missing location fields such as flow `locationOfSupply` while keeping ambiguous paths blocked.

Historical npm-era release 0.0.15 note (retired; do not use as current instructions), 2026-06-11: prechecks were `node ./scripts/ci/release-version.cjs assert-unpublished --version 0.0.15`, `npm run prepush:gate`, and `npm pack --dry-run`; this release adapted `dataset import-lca convert` to the tidas-tools 0.0.28 process-bundle CLI surface (no bare `--process-bundles` flag, `--no-process-bundles` forwarded when disabled) and derived report bundle/mapping file fields from on-disk state.

Historical npm-era Issue #210 packaging note (retired; do not use as current instructions), 2026-07-27: feature PRs did not bump or publish the CLI package. The later release PR used `npm pack --dry-run` to prove `assets/import-smoke/simapro.csv` was included and Python packages, tidas-tools checkouts, venvs, and native executables were absent. The current pnpm package gate preserves that artifact contract.

Useful commands:

```bash
git fetch origin
git checkout main
git merge --ff-only origin/main

pnpm install --frozen-lockfile
pnpm test:package
pnpm prepush:gate
node ./scripts/ci/release-version.cjs next-version --part patch
node ./scripts/ci/release-version.cjs assert-unpublished --version <x.y.z>
pnpm --filter @tiangong-lca/cli --fail-if-no-match pack --dry-run >/dev/null
```

`next-version` is only a helper for choosing the next version. The generic example above shows a patch bump; the separate post-Issue-#224 compatibility release should use `--part minor` to propose 0.1.0. The actual release version is whatever the tracked release decision puts into `package.json`.

## Release-Prep PR

1. Create a dedicated branch from `main`.
2. Update the CLI package version metadata:
   - `package.json`
   - keep the sole root `pnpm-lock.yaml` present and unchanged because a version-only bump does not change the dependency graph
   - if an independently reviewed release-control dependency changes, pin it exactly, regenerate the sole lock with pnpm, prove it remains dev-only, and record that exception explicitly; Issue #230 adds only `sigstore@5.0.0` for cryptographic post-publish verification
3. Keep the PR focused on the release bump.
4. Open a normal PR with local pre-push gate evidence. Before merge, manually dispatch `quality-gate` on the exact release head and record all four successful jobs. After merge, `Tag Release From Merge` independently invokes that same reusable matrix on the exact merge commit and cannot create a tag unless it succeeds.
5. Merge the PR into `main`.

Release automation starts only after the version bump PR is merged into upstream `main`. A local workstation may run `pnpm --filter @tiangong-lca/cli --fail-if-no-match pack --dry-run` for package validation, but it must not publish the package; local npm authentication and personal registry permissions are intentionally outside the release contract. `pnpm test:package` must also prove the tarball is clean and its consumer does not depend on pnpm-specific workspace behavior.

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
- release detection runs before expensive validation and starts the reusable pnpm quality matrix only when the CLI version changed
- macOS arm64, Ubuntu x64, Ubuntu arm64, and Windows x64 all pass on the exact merge commit, and each job fail-closes unless `process.platform`/`process.arch` matches its exact matrix declaration
- the release detector and every later job run only after the same exact Node 24.19.0 pnpm setup
- the `tag-release` job depends on both release detection and the successful four-platform matrix, then reruns the Ubuntu release/docpact gates before tag creation
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

If a pnpm-era tag exists but the publish workflow needs to be re-run with the current workflow definition, use the manual dispatch input:

```bash
gh workflow run publish.yml --repo tiangong-lca/tiangong-cli --field tag_name=cli-v<x.y.z>
```

Manual replay supports only tags whose tagged commit contains the root `pnpm-lock.yaml`. A pre-pnpm `cli-v*` tag is rejected before install/build/publish; the workflow intentionally has no npm fallback. Recover a historical release from its original immutable workflow evidence instead of replaying it through the current pnpm workflow.

### 3. npm registry

Confirm npm has the expected version:

```bash
pnpm view @tiangong-lca/cli version
pnpm view @tiangong-lca/cli dist-tags --json
pnpm release:verify-published -- --version <x.y.z> --expected-git-head <release-merge-sha>
```

Expected result:

- `version` equals `<x.y.z>`
- `latest` points to `<x.y.z>` unless this release intentionally uses a different dist-tag strategy
- `release:verify-published` returns `ok: true`, verifies an optional registry `gitHead` when the registry exposes it, and always requires the cryptographically verified SLSA provenance `gitCommit` to equal `<release-merge-sha>`
- Sigstore verifies the Fulcio certificate against the GitHub OIDC issuer, an anchored exact `publish.yml@refs/tags/cli-v<x.y.z>` identity, certificate transparency, and Rekor before any decoded statement is trusted
- the verified statement has exact in-toto/SLSA types and binds the canonical repository, tag, workflow, GitHub Actions invocation, and independently downloaded tarball sha512
- the temporary consumer proves exact pnpm 11.23.0 and registry signatures, overrides both user and global package-manager configuration with private public-registry-only files, exercises the bin, `auth identity-receipt --help` for 0.1.1 and later, explicit ESM/CJS launcher imports, and scans dependencies, optional dependencies, and peers for production TypeScript

The verifier intentionally reports `registryGitHead: null` when npm omits that legacy metadata field; this is not a bypass because the signed provenance `gitCommit` remains mandatory. Do not update the workspace pointer until the complete verifier returns `ok: true`.

## Workspace Follow-Up

If the workspace tracks the CLI submodule, bump the workspace pointer only after:

- the child PR is merged
- the release tag exists
- the publish workflow succeeds
- npm resolves to the new version
- `pnpm release:verify-published` succeeds for the exact release merge commit

From the workspace root, first run the child completion preflight:

```bash
scripts/workspace-ops task finish tiangong-lca/tiangong-cli#<cli-issue-number>
```

Read the complete result and follow the exact `Next` command. The first finish call is non-mutating; execute only the short-lived continuation it returns. That continuation creates or reuses the required root integration task, completes the child task, and returns the integration task's exact start action. Do not independently create a root task and do not rerun finish on the now-complete child.

Follow the integration task's returned start/update/submit sequence, use the workspace integration runbook for the exact gitlink and PR target, and bind the child Issue/PR, `cli-v<x.y.z>`, release merge SHA, successful tag/publish runs, and verifier output. After the root integration PR merges, finish the integration task itself:

```bash
scripts/workspace-ops task finish tiangong-lca/workspace#<integration-issue-number>
```

Use only that task's successful preflight continuation to complete delivery. Do not reconstruct lifecycle transitions with direct GitHub writes.

## Failure Handling

- If the version bump PR is not merged, no release should happen.
- If tag creation fails, fix the workflow or repository secret/config first. Do not manually continue the workspace bump.
- If publish fails, inspect the failed GitHub Actions run and npm/Trusted Publisher configuration before retrying the release flow.
- If a pnpm-era tag exists and points to the intended merge commit but publish did not run, re-run `publish.yml` with `tag_name=cli-v<x.y.z>`.
- If manual dispatch reports that the tagged commit has no root `pnpm-lock.yaml`, stop: the tag predates the pnpm contract and is not replayable through the current workflow.
- If npm does not show the expected version yet, wait for registry propagation before treating the release as failed.

## Operator Checklist

- only the intended package version and explicitly reviewed release-control dependency changed; Issue #230 pins dev-only `sigstore@5.0.0`, regenerates the sole pnpm lock, and leaves published runtime dependencies unchanged
- release-prep PR merged into `main`
- `Tag Release From Merge` succeeded
- `cli-v<x.y.z>` exists
- `Publish Package` succeeded
- `pnpm view @tiangong-lca/cli version` equals `<x.y.z>`
- `pnpm release:verify-published` returns `ok: true` for the immutable release merge commit
- published provenance `gitCommit` and optional registry `gitHead` resolve to the immutable release merge commit
- Sigstore certificate/CT/Rekor verification, independently downloaded tarball integrity, registry signatures, isolated user/global config, and the credential-free public pnpm ESM/CJS/bin consumer pass
- the child finish preflight's short-lived continuation owns integration-task create/reuse and child completion; no independent create or second child finish occurs
- the root integration task follows its returned lifecycle and its own finish preflight/continuation after merge
- workspace pointer updated only after all checks above passed

## Local Docpact Push Gate

The repository now includes a local pre-push gate that runs `scripts/docpact-gate.sh` and then `pnpm prepush:gate`. It is the ordinary local validation path. For a detected CLI version change, the merge-triggered tag workflow additionally calls the reusable four-platform pnpm matrix and makes tag creation depend on its success; the publish workflow retains its independent tag-bound release gate.
