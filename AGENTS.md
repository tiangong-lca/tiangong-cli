---
title: cli AI Working Guide
docType: contract
scope: repo
status: active
authoritative: true
owner: cli
language: en
whenToUse:
  - when a task may change the public `tiangong-lca` command surface, CLI runtime behavior, session handling, or release gating
  - when routing work from the workspace root into tiangong-lca-cli
  - when deciding whether a change belongs here, in tiangong-lca-skills, in tiangong-lca-mcp, or in a remote runtime repo
whenToUpdate:
  - when command ownership or repo boundaries change
  - when validation, packaging, or coverage rules change
  - when docpact routing, retained source docs, or repo-local governance rules change
checkPaths:
  - AGENTS.md
  - README.md
  - DEV_CN.md
  - docs/IMPLEMENTATION_GUIDE_CN.md
  - .docpact/config.yaml
  - docs/agents/**
  - package.json
  - .nvmrc
  - bin/**
  - src/**
  - test/**
  - scripts/**
  - .github/workflows/**
  - .githooks/**
  - scripts/docpact
  - scripts/docpact-gate.sh
  - scripts/install-git-hooks.sh
lastReviewedAt: 2026-07-11
lastReviewedCommit: 192ce9cb233af85b8bcf50136d37fd08d4ae8292
related:
  - .docpact/config.yaml
  - docs/agents/repo-validation.md
  - docs/agents/repo-architecture.md
  - README.md
  - DEV_CN.md
  - docs/IMPLEMENTATION_GUIDE_CN.md
  - docs/release-runbook.md
  - docs/release-setup.md
---

## Repo Contract

`tiangong-lca-cli` owns the checked-in public `tiangong-lca` CLI contract: command nouns and verbs, launcher behavior, local artifact workflow, remote session/auth handling, and the repo-level release gate. Start here when the task may change what the CLI does or how it is validated.

Review note, 2026-06-04: `dataset curation-queue build/next/verify` is the CLI-owned state machine for Foundry entity queues; repo ownership boundaries remain unchanged.

Review note, 2026-06-05: release 0.0.12 only updates CLI package version metadata; command ownership, validation gates, and release workflow boundaries remain unchanged.

Review note, 2026-06-07: release 0.0.14 keeps the CLI-owned dataset classification command family and release workflow boundaries unchanged. `dataset classification apply --type location` may create an explicit missing location field such as `locationOfSupply`, but path ambiguity still blocks.

Review note, 2026-06-11: release 0.0.15 keeps command nouns/verbs, repo ownership, and release workflow boundaries unchanged. `dataset import-lca convert` now matches the tidas-tools 0.0.28 import_lca CLI surface: the wrapper no longer passes a bare `--process-bundles` flag, forwards `--no-process-bundles` when bundles are disabled, and derives report bundle/mapping file fields from on-disk state.

Review note, 2026-07-11: `dataset maintenance plan/apply/verify` is now the CLI-owned v1 row-level maintenance contract. It freezes exact current-user RLS scope and audit artifacts before any write, executes only approved `save_draft` / `delete` actions through platform command paths, and verifies the result with an independent readback.

Review note, 2026-07-11: the maintenance contract now also has an explicit `publish-support` operation limited to schema-valid, root-identity-matching current-owner draft `unitgroups` and `flowproperties`. Apply delegates locked payload/timestamp preconditions, state transition, and audit-proven replay to `cmd_dataset_publish_guarded`; all other support mutations remain protected.

Review note, 2026-07-12: `dataset maintenance approve-support` separates independent review-admin authorization from the dataset owner's apply confirmation. The reviewer RPC records an immutable, exact action/snapshot approval in `command_audit_log`; `apply` passes that audit id to `cmd_dataset_publish_guarded`, and local approval artifacts are correlation handoffs rather than authorization sources.

`publish-support` and `approve-support` are future public-promotion tools. They are not prerequisites for owner-draft cleanup, account-local FP/UG use, or the private-incubation Step 2 workflow.

## Bootstrap Order

Load docs in this order:

1. `AGENTS.md`
2. `.docpact/config.yaml`
3. `scripts/docpact route --root . --intent <intent>` when you need path-specific routing
4. `docs/agents/repo-validation.md` when proof, coverage, CI, or release gating matters
5. `docs/agents/repo-architecture.md` when command ownership, session/runtime layers, or artifact families are unclear
6. `README.md` only for user-facing invocation examples
7. `DEV_CN.md`, `docs/IMPLEMENTATION_GUIDE_CN.md`, `docs/release-runbook.md`, or `docs/release-setup.md` only when that retained source doc matches the task

Do not start with scattered subcommands or tests before you know which command family owns the task.

Preferred docpact commands:

- `scripts/docpact route --root . --intent command-surface`
- `scripts/docpact route --root . --intent remote-session`
- `scripts/docpact route --root . --intent workflow-commands`
- `scripts/docpact route --root . --intent validation-release`
- `scripts/docpact route --root . --intent repo-docs`

## Repo Ownership

This repo owns:

- `bin/tiangong-lca.js` as the stable launcher entrypoint
- `src/cli.ts` and `src/main.ts` for command dispatch, process entry, help, and exit behavior
- `src/lib/**` for reusable CLI command logic, session handling, artifacts, and remote adapters
- `test/**` and `scripts/assert-full-coverage.ts` for the hard validation gate
- package metadata, build output contract, and tag/release checks in `package.json` and `scripts/ci/**`

This repo does not own:

- skill packaging and skill wrapper metadata
- MCP transport or inspector surfaces
- remote product or Edge Function business logic
- workspace integration state after merge

Route those tasks to:

- `tiangong-lca-skills` for skill wrappers and `SKILL.md` packages
- `tiangong-lca-mcp` for MCP transports and tool registration
- the owning runtime repo for API, schema, or product behavior
- `lca-workspace` for root integration after merge

## Runtime Facts

- Repo-local documentation governance is encoded in `.docpact/config.yaml` and enforced locally by the pre-push docpact gate; `.github/workflows/ai-doc-lint.yml` is manual-dispatch fallback.
- Package manager: `npm`
- Node baseline: `>=24 <25`
- Runtime style: TypeScript source, Node-native CLI, direct REST and Edge Function access only
- Newly added process-maintenance commands such as `process identity-preflight`, `process build-plan`, `process scope-statistics`, `process dedup-review`, `process refresh-references`, and `process verify-rows` still belong to the native CLI command surface in `src/cli.ts` and `src/lib/process-*.ts` / shared CLI-native helpers.
- `process save-draft` now has a local `ProcessSchema` validation gate before any commit path writes remote state, and `--target-user-id` is a hard current-session/visible-draft owner guard for account-scoped batch imports.
- Dataset-level local governance commands such as `dataset validate`, `dataset curation-queue build/next/verify`, and `dataset references rewrite` belong to the same native CLI command surface in `src/cli.ts` and `src/lib/dataset-*.ts`.
- `dataset maintenance plan/approve-support/apply/verify` owns current-user RLS-scoped row maintenance in `src/lib/dataset-maintenance-{contract,remote,plan,approve-support,apply,verify}.ts`. V1 requires exact `id` + `version`, `state_code=0`, and current-session ownership. Ordinary maintenance can plan `save_draft` / `delete` actions only for `contacts`, `sources`, `flows`, and `processes`; the separate `publish-support` operation requires an independent review-admin audit before it can publish schema-valid exact drafts in `unitgroups` and `flowproperties` through `cmd_dataset_publish_guarded`. `lifecyclemodels`, public rows, non-owner rows, non-draft rows, and every other support-table mutation remain protected.
- `lifecyclemodel save-draft` validates canonical lifecyclemodel payloads with `LifeCycleModelSchema` before any commit path writes remote state; `lifecyclemodel graph` remains a local artifact command.
- `flow publish-version` validates canonical flow payloads with `FlowSchema` before remote visibility planning or writes, and emits `flow-publish-version-gate-report.json` as the blocking ruleset artifact.
- `process publish-build` validates canonical process payloads with `ProcessSchema` before publish handoff artifacts are written, and emits `reports/process-publish-schema-gate.json`.
- `publish run` emits `verification-report.json` next to `publish-report.json`; this is the deterministic publish ruleset summary for failed/deferred/executed outcomes.
- `src/lib/runtime-rulesets.ts` is the CLI-local runtime activation layer for stable ruleset ids, methodology rule ids, severity, and blocker semantics used by review, dedup, and publish gate artifacts.
- The canonical minimum validation command is `npm run lint`
- The authoritative full gate is `npm run prepush:gate`; the local pre-push hook runs it after docpact.
- Release tagging is guarded in `.github/workflows/tag-release-from-merge.yml` so only the upstream repository can execute the merge-tag flow, and it runs the release gate only when a package version change will create a `cli-v<version>` tag. `.github/workflows/publish.yml` publishes from that tag and also supports `workflow_dispatch` for existing-tag recovery/backfill.
- CLI npm releases must go through a version-bump PR merged to upstream `main`; do not use local `npm publish` as the release path. The release-prep PR updates `package.json` and `package-lock.json`, merge creates `cli-v<version>`, and GitHub Actions publishes through npm Trusted Publishing.
- Coverage for `src/**/*.ts` is expected to stay at `100%` statements, branches, functions, and lines

## Hard Boundaries

- Do not add orchestration frameworks or new npm dependencies without explicit approval
- Do not publish `@tiangong-lca/cli` from a local workstation for routine releases; local npm auth state is not part of the release contract.
- Do not implement dataset maintenance through direct SQL, service-role credentials, raw REST mutation, or Foundry-local database code. Foundry and skills may prepare scope and orchestrate the CLI, but the native CLI must own current-user RLS preflight, platform-command mutation, per-action audit logging, and independent readback verification.
- Do not treat `support-approval-record.json` or the owner's `approval-record.json` as publication authority. Only the exact independent reviewer entry created by `cmd_dataset_support_approve_guarded` and revalidated by `cmd_dataset_publish_guarded` authorizes FP/UG publication.
- Do not move business logic into skill wrappers when the native `tiangong-lca` CLI should own it
- Do not weaken the coverage gate with ignore pragmas; cover the branch or remove dead code
- Do not treat governed docs as optional when command-surface, validation, or release-gate behavior changes; `docpact` should either require a matching source-doc update or record explicit review evidence.
- Do not treat a merged repo PR here as workspace-delivery complete if the root repo still needs a submodule bump

## Workspace Integration

A merged PR in `tiangong-lca-cli` is repo-complete, not delivery-complete.

If the change must ship through the workspace:

1. merge the child PR into `tiangong-lca-cli`
2. update the `lca-workspace` submodule pointer deliberately
3. complete any later workspace-level validation that depends on the updated CLI snapshot

## Local Docpact Push Gate

Install the versioned local hook once per checkout:

```bash
./scripts/install-git-hooks.sh
```

The `pre-push` hook runs `scripts/docpact-gate.sh`, which delegates CLI lookup to `scripts/docpact` and performs strict config validation plus enforced lint before the push leaves the machine. It then runs `npm run prepush:gate` as the local test gate. The wrapper checks `DOCPACT_BIN`, Cargo install locations, Homebrew install locations, and then `PATH`, so local agent shells should not fail only because bare `docpact` is unavailable. The default comparison base is `origin/main`. Override it for unusual stacks with `DOCPACT_BASE_REF=<ref>` or `scripts/docpact-gate.sh --base <ref>`. The gate writes its detailed report to a temporary file so normal pushes do not create `.docpact/runs/` artifacts. The GitHub `quality-gate` workflow is manual-dispatch only; publish and tag workflows still run release gates before release actions.
