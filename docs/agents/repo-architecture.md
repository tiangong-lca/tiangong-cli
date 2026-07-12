---
title: cli Architecture Notes
docType: guide
scope: repo
status: active
authoritative: false
owner: cli
language: en
whenToUse:
  - when you need a compact mental model of the CLI before editing command routing, helper modules, or release gates
  - when deciding which file family owns a behavior change
  - when launcher, session, review, publish, or artifact hotspots are mentioned without exact paths
whenToUpdate:
  - when major repo paths or command families change
  - when session or artifact architecture moves
  - when coverage or release gating becomes materially different
checkPaths:
  - docs/agents/repo-architecture.md
  - .docpact/config.yaml
  - package.json
  - bin/**
  - src/**
  - test/**
  - scripts/**
  - .githooks/pre-push
  - scripts/docpact
  - scripts/docpact-gate.sh
  - scripts/install-git-hooks.sh
lastReviewedAt: 2026-07-12
lastReviewedCommit: afcd941537cbaeb355e2c753a2e2b847b4c1909e
related:
  - ../../AGENTS.md
  - ../../.docpact/config.yaml
  - ./repo-validation.md
  - ../../README.md
  - ../../DEV_CN.md
---

## Repo Shape

This repo is organized around one stable launcher plus a library-style `src/lib/**` tree that implements command families and shared helpers.

Review note, 2026-06-04: Foundry entity queue state now stays in the native CLI command family as `dataset curation-queue build/next/verify`; no secondary orchestration runtime was introduced.

Review note, 2026-06-05: release 0.0.12 is a package metadata bump only; no command-family ownership, launcher, session, artifact, or release architecture paths changed.

Review note, 2026-06-06: release 0.0.13 keeps the release architecture unchanged: maintainers open a version-bump PR, update `package.json` and `package-lock.json`, merge to upstream `main`, and let GitHub Actions create the tag and publish through npm Trusted Publishing. Local `npm publish` is not part of the release architecture.

Review note, 2026-06-07: release 0.0.14 keeps the architecture in the existing TypeScript dataset classification command family. The location apply helper now creates only explicit schema-derived missing location targets and does not introduce a new orchestration layer or release path.

Review note, 2026-06-11: release 0.0.15 keeps the import-lca wrapper inside the existing TypeScript dataset command family. Only the tidas-tools spawn argument construction and report file derivation changed to match tidas-tools 0.0.28; no new orchestration layer or release path.

Review note, 2026-07-11: row-level dataset maintenance is implemented in the native CLI as `dataset maintenance plan/apply/verify`. The architecture keeps scope freezing, current-user RLS reads, protected-row classification, approved platform-command writes, append-only action logging, and independent verification in separate maintenance modules.

Review note, 2026-07-12: `merge-support-aliases` is one fixed BAFU owner-draft transformation inside the maintenance boundary. Scope and plan require `target_mode=owner_draft`; planning freezes exact current-owner state-0 source/target support and exchange closure; apply sends `target_visibility=owner_draft` in one atomic guarded RPC per dimension; verify re-reads private state and validates the mode-bound row/exchange/batch proof chain. Publication is a separate future workflow.

## Stable Path Map

| Path group | Role |
| --- | --- |
| `bin/tiangong-lca.js` | stable launcher entrypoint exposed as the public `tiangong-lca` executable |
| `src/main.ts` | process entry, dotenv loading, stdout and stderr wiring |
| `src/cli.ts` | top-level command dispatch, parsing, and help routing |
| `src/lib/**` | command-family implementations plus shared auth, IO, artifact, and remote helpers |
| `test/**` | unit and launcher tests that back the coverage gate |
| `scripts/assert-full-coverage.ts` | strict coverage enforcement |
| `scripts/ci/**` | release-tag and package publication checks |

## Current Architectural Clusters

### Launcher and entry contract

The public `tiangong-lca` surface starts in:

- `bin/tiangong-lca.js`
- `src/main.ts`
- `src/cli.ts`

If a task changes help output, exit behavior, or how subcommands are registered, start here.

### Session and remote access layer

The CLI talks to remote services directly through helper modules such as:

- `src/lib/env.ts`
- `src/lib/dotenv.ts`
- `src/lib/user-api-key.ts`
- `src/lib/supabase-session.ts`
- `src/lib/supabase-client.ts`
- `src/lib/supabase-rest.ts`
- `src/lib/remote.ts`
- `src/lib/http.ts`

This is where the CLI-owned remote access contract lives.

### Workflow command families

The widest feature families currently live in:

- `src/lib/flow-*.ts`
- `src/lib/dataset-*.ts`
- `src/lib/*-qa.ts`
- `src/lib/process-*.ts`
- `src/lib/lifecyclemodel-*.ts`
- `src/lib/publish.ts`
- `src/lib/run.ts`

These files own the public CLI semantics for those workflows.

### Process maintenance and QA commands

Recent process maintenance commands extend the same native CLI layer instead of introducing a secondary orchestration surface:

- `src/lib/process-save-draft-run.ts`
- `src/lib/process-payload-validation.ts`
- `src/lib/process-scope-statistics.ts`
- `src/lib/process-dedup-review.ts`
- `src/lib/process-refresh-references.ts`
- `src/lib/process-verify-rows.ts`
- `src/lib/identity-preflight.ts`
- `src/lib/process-flow-build-plan.ts`
- `src/lib/process-qa.ts`
- `src/lib/runtime-rulesets.ts`

These modules share one contract:

- `src/cli.ts` owns subcommand registration, help, and exit semantics
- `process/flow identity-preflight` owns embedded/local candidate scan inputs, explicit hybrid-search remote candidate inputs, identity/fingerprint comparison, duplicate/manual-review decisions, and `identity-candidate-sources.json` provenance artifacts before any build-plan or generation step
- `process/flow build-plan` validates minimum authoring contracts and writes standard gate artifacts before downstream materialization or publish handoff; materialize now creates canonical `processDataSet` / `flowDataSet` wrappers from plan fields when no canonical payload is supplied
- `process save-draft` validates canonical payloads with `ProcessSchema` before remote writes and accepts `--target-user-id` as an account/write guard that must match the current CLI auth user and any visible draft owner
- `flow publish-version` and `process publish-build` validate canonical payloads with `FlowSchema` / `ProcessSchema` before publish planning or handoff artifacts proceed
- `publish run` writes a deterministic `verification-report.json` next to the final publish report so downstream automation can read blockers without parsing execution details
- `runtime-rulesets` maps CLI-local QA, dedup, and publish findings to stable methodology rule ids so Foundry and UI handoffs can consume one ruleset profile contract
- maintenance and QA commands still emit artifact-first local outputs and remain covered by the strict `src/**/*.ts` coverage gate

### Dataset and lifecyclemodel governance commands

Dataset-local governance now uses the same CLI-native command layer:

- `src/lib/dataset-validate.ts`
- `src/lib/dataset-curation-queue.ts`
- `src/lib/dataset-references-rewrite.ts`
- `src/lib/dataset-maintenance-clear-account.ts`
- `src/lib/dataset-maintenance-{contract,remote,plan,apply,verify}.ts`
- `src/lib/dataset-maintenance-alias-rewrite.ts`
- `src/lib/dataset-maintenance-support-validation.ts`
- `src/lib/dataset-local.ts`
- `src/lib/lifecyclemodel-save-draft-run.ts`
- `src/lib/lifecyclemodel-graph.ts`

These modules keep validation, entity-level curation queue build/next/verify state, reference rewrites, RLS-scoped account and exact-row maintenance, save-draft preparation, graph extraction, and local artifact reports inside the CLI instead of routing through skills or MCP transports.

The row-level maintenance family is deliberately split by responsibility:

- `contract` owns the versioned scope, immutable plan, action, approval, and report shapes.
- `remote` owns current-session authentication, current-user RLS reads, exact `id` + `version` row lookup, reference-impact reads, platform `save_draft` / `delete` / guarded owner-draft alias-batch RPC execution, and audit correlation.
- `alias-rewrite` owns the fixed two-dimension BAFU profile, reviewed target-reference derivation, closure counting, and arbitrary-precision decimal scaling. It never uses JavaScript binary floating point for exchange amounts.
- `support-validation` validates frozen owner-draft FP/UG payload schemas plus embedded root UUID/version without importing publication behavior.
- `plan` freezes `maintenance-scope.json`, `rls-visible-snapshot.json`, `protected-rows.jsonl`, `reference-impact-report.json`, `maintenance-plan.json`, and `dry-run-report.json` before any write. Alias plans additionally freeze `exchange-rewrite-plan.jsonl`, three support snapshots per batch, per-process exchange locators/hashes, desired payloads, and exact postconditions.
- `apply` re-runs a full-plan drift preflight, verifies `--approve-plan <sha256>` and `--confirm <email>`, and persists approval before the first write. Ordinary actions remain sequential; an alias dimension is submitted once to `cmd_dataset_alias_batch_guarded` and is never decomposed into per-row writes. Apply records `apply-progress.jsonl`, `alias-exchange-progress.jsonl`, and `alias-batch-progress.jsonl`, and repairs a lost-response/log gap only through an audit-proven whole-batch replay.
- `verify` performs a fresh readback independently of apply, validates the immutable support snapshots and exact durable proof chain, and writes `readback-verify-report.json`.

Ordinary V1 maintenance only permits current-user, `state_code=0`, exact-version `contacts`, `sources`, `flows`, and `processes` to become `save_draft` or `delete` actions. `merge-support-aliases` is narrower still: exactly two owner-draft batches (`time`, `length_time`), 52 draft rows, 59 selected exchanges, and 309 unrelated exchanges preserved, with reviewed factors and postcondition counts encoded as contract invariants. Source and target FP/UG plus all changed parents must be the current actor's `state_code=0`; public, foreign, or mixed visibility is rejected. It rewrites references and exchange amounts but does not delete support rows or change visibility.

All mutation continues through the public platform dataset command path. Direct SQL, service-role access, raw REST mutation, and Foundry-local delete/update implementations are outside this architecture; Foundry may only prepare scope, invoke the CLI, and retain its artifacts.

### Artifact and filesystem behavior

Artifact materialization and local state handling cluster around:

- `src/lib/artifacts.ts`
- `src/lib/io.ts`
- `src/lib/state-lock.ts`

If a task changes output layout, locking, or local run roots, inspect these first.

### Repo-local validation and release gates

Repo-level maintenance gates are now split across:

- `.github/workflows/quality-gate.yml` for manual remote reproduction of the local gate
- `.github/workflows/ai-doc-lint.yml`
- `.github/workflows/tag-release-from-merge.yml`
- `.github/workflows/publish.yml`

Important constraints:

- `npm run prepush:gate` remains the authoritative local proof for code changes and runs from the local pre-push hook
- `ai-doc-lint` keeps the historical check identity, but its implementation should run `docpact`
- `docpact` enforces that command-surface and release-gate changes also refresh or review the governed source docs
- the merge-tag workflow is guarded so only the upstream repository can execute release tagging
- the publish workflow releases from `cli-v<package.json version>` and supports manual dispatch for existing-tag recovery/backfill
- routine npm releases must flow through an upstream `main` PR merge and GitHub Actions Trusted Publishing; local workstations may validate with `npm pack --dry-run` but must not publish

## Cross-Repo Boundaries

- `tiangong-lca-skills` wraps CLI commands but does not own the native command contract
- `tiangong-lca-mcp` owns MCP transports and tool exposure, not the CLI executable
- runtime API, schema, or product behavior still belong in their owning repos
- `lca-workspace` owns root delivery completion after a child PR merges

## Common Misreads

- a skill wrapper is not the source of truth for a missing command
- the CLI should not absorb MCP transport behavior
- a merged child PR does not finish workspace delivery

## Local Docpact Push Gate

This repository has a versioned local `pre-push` hook under `.githooks/pre-push` that delegates to `scripts/docpact-gate.sh` and then runs `npm run prepush:gate`. The gate resolves the CLI through `scripts/docpact`, so local agent shells do not need bare `docpact` on `PATH`. The hook is the local guard for docpact config validation, enforced doc-governance linting, and the CLI test gate; ordinary GitHub push tests are replaced by this local gate plus release-time gates.
