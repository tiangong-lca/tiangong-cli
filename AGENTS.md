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
lastReviewedAt: 2026-07-15
lastReviewedCommit: bd145f692b3fd11e398302dd6a1d2831e058883a
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

Review note, 2026-07-12: the maintenance contract owns the fixed BAFU FP alias operation `merge-support-aliases` in explicit `target_mode=owner_draft`. Source/target FP/UG and all changed flow/process rows must be current-owner `state_code=0`; the ordered `time` plus `length_time` plan is applied through one whole-plan guarded RPC with exact closure, payload/timestamp locks, plan/batch audit-bound replay, and independent private-state readback. Publication remains a separate future workflow and is not a prerequisite of this operation.

Review note, 2026-07-13: maintenance account scans now require exact-count PostgREST pagination. `--page-size` is a requested maximum that may exceed the server cap; the CLI follows the actual returned row count, validates each `Content-Range` exact total and strict `id`/`version` order, and emits per-table plus aggregate completeness proof before accepting artifacts, approval, or writes. This proves pagination completeness while the filtered membership/order is stable; it is not a transaction-level or MVCC snapshot.

Review note, 2026-07-14: `rebuild-derivatives` extends the maintenance contract with one narrowly scoped `rebuild_derivatives` action. V1 accepts exactly one current-owner `processes` draft in `target_mode=owner_draft`, with the exact component set `extracted_md` plus `embedding_ft`. Planning freezes an action-scoped database snapshot; apply may only obtain a durable `accepted`/`queued` result through the guarded RPC; independent verify owns the terminal `pending`/`passed`/`failed` result. This path never mutates primary process data and has no direct Edge, `admin embedding-run`, raw queue, SQL, or REST mutation fallback.

Review note, 2026-07-15: `dataset maintenance run-protected` is the CLI-owned production-only path for one already sealed and exactly approved owner-draft alias execution. It completes full account and derivative-baseline checks before server preflight, binds three ordered live gates to a server window of at most 180 seconds, writes an immutable local marker before at most one admission POST, and permits only status/readback recovery afterward. Terminal success requires the database proof and independent RLS reads to agree on 52 rows, 59 exchanges, 55 audits, and exactly 23 flow plus 27 process derivative targets. It has no Dev replay, legacy alias RPC, automatic retry, publication, or state-code fallback.

Review note, 2026-07-15: Issue #171 keeps protected preparation in the same CLI-owned maintenance boundary. `freeze-protected` may authenticate only to the explicitly confirmed production project and is limited to complete RLS reads plus the protected derivative snapshot RPC; `seal-protected-approval` is local-only and receives no environment, session, or network client. Only `run-protected` owns preflight/admission/execution. Foundry and skills remain thin published-CLI callers and must not duplicate database access, canonical hashing, or approval construction.

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
- `dataset maintenance plan/apply/verify` owns ordinary current-user RLS-scoped row maintenance in `src/lib/dataset-maintenance-{contract,remote,plan,apply,verify}.ts` plus the fixed alias transformation in `src/lib/dataset-maintenance-alias-rewrite.ts`. V1 requires exact `id` + `version`, `state_code=0`, and current-session ownership. Ordinary maintenance can execute `save_draft` / `delete` actions only for `contacts`, `sources`, `flows`, and `processes`. The original whole-plan alias request remains an artifact-compatibility format, but generic `apply` must reject a sealed production `merge-support-aliases` execution before any mutation transport.
- `dataset maintenance run-protected` owns the sealed production alias path in `src/lib/dataset-maintenance-{alias-request,protected-contract,protected-run,protected-verify}.ts`. It requires the exact plan, production freeze/seal, approval, authenticated account, and private output directory. Commit mode completes the full account/support/50-target baseline scan before server preflight, accepts only server-derived ordered gates within the 180-second maximum, creates immutable local one-shot evidence, and makes at most one admission request. Status-only mode never preflights or admits. Any marker, timeout, cancellation, lost response, or ambiguous admission consumes the local attempt and permits only bounded read polling. A terminal pass requires exact server and independent-read agreement on 52 rows, 59 exchanges, 55 audits, and 50 derivative targets split 23 flows plus 27 processes. The database executor is server-dispatched and explicitly actor/user/state/plan/closure fenced; the CLI never carries service-role credentials.
- `rebuild-derivatives` is a separate derivative-only profile: exactly one current-owner state-0 `processes` action, `action=rebuild_derivatives`, `target_mode=owner_draft`, and the exact components `extracted_md` plus `embedding_ft`. Its plan binds an action-scoped database snapshot, apply only records guarded-RPC admission as `accepted`/`queued`, and verify alone resolves `pending`/`passed`/`failed` without changing the process primary payload or `modified_at`. The direct alias-dimension and derivative worker/queue surfaces are not authenticated CLI paths. Public/shared, foreign-owner, mixed-visibility, non-draft, lifecyclemodel, and every other support-table mutation remain protected.
- `src/lib/dataset-maintenance-pagination.ts` owns fail-closed account-scan pagination for row-level maintenance and `clear-account`. It requests `Prefer: count=exact`, treats the configured page size as a requested maximum rather than a guaranteed response size, advances offsets by the number of rows actually returned, and accepts a scan only when exact totals, ranges, ordering, identities, and aggregate entity counts prove pagination completeness under stable filtered membership/order. Incomplete scans stop before maintenance artifacts or mutation gates; the resulting proof does not claim transaction-level snapshot isolation across requests.
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
- Do not generalize `merge-support-aliases` beyond its reviewed two-dimension BAFU profile without a new tracked contract. The fixed factors, 52-row/59-exchange closure, 309 preserved exchanges, and postcondition counts are safety invariants.
- Do not remove or reinterpret the `target_mode=owner_draft` / `target_visibility=owner_draft` binding. The alias operation must never mutate public, foreign-owner, or mixed-visibility support or parent rows.
- Do not execute a sealed production `merge-support-aliases` plan through generic `apply`, the legacy whole-plan RPC, Dev data replay, or a second admission. Use `run-protected` only after the shared database capability is released, the live production state is freshly frozen, and the exact execution is human-approved. A transport-ambiguous attempt is consumed and recoverable only through status/readback.
- Do not implement `rebuild-derivatives` by calling an Edge Function, `admin embedding-run`, a raw queue, direct SQL, service-role credentials, or raw REST mutation. The only apply path is the authenticated guarded RPC; its admission result is not completion, and only independent verify may report `passed`.
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
