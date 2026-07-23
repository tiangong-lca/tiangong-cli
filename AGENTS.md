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
lastReviewedAt: 2026-07-23
lastReviewedCommit: 4daf99c1b0b0fe3e084b5903163cdf6b11fe4de2
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

Review note, 2026-07-16: Issue #157 adds a separate `dataset maintenance flow-identity capture|plan|freeze|seal-approval|run|verify` boundary for Step 3. Capture performs one complete authenticated source/process census, persists only the reviewed process reference closure, and submits exactly one immutable semantic request for a database receipt; it performs no rewrite/finalize or client-side derivative-baseline RPC. Plan accepts only that fresh post-Step2/post-#29 305-source v3 authority and database receipt. Process requests are thin ordinal/intent-proof commands; the immutable database receipt/ledger owns rewrite semantics and derivative baselines. The runner is serial, writes an immutable attempt marker, and never automatically replays an ambiguous process response. Independent verification owns terminal success. Derivative failure cannot trigger process replay; any later derivative-only compensation requires a new plan/freeze/approval.

Review note, 2026-07-17: Issue #157 COMMON hardening requires independent `status=passed` readback identities for both Issue #29 derivative prerequisites before capture. An HTTP-success RPC body with `ok:false` is a deterministic database domain rejection, not a transport ambiguity; after a process rejection the current invocation performs exactly one fresh scope read and never replays the process. Independent verify may report `pending` only for an exact `derivatives_pending` database status with no hard readback mismatch. The protected runner now enforces `approval_reusable=false` with a database-minted one-wrapper rotating permit as the cross-machine authority; a create-only local approval claim is defense in depth. Permit or preflight-response loss requires a fresh exact recovery approval and can locate the existing actor-owned scope only through the exact read-only lookup. The remaining production gate is merge, Preview validation, and coordinated DB/CLI release, not an unresolved design boundary.

Review note, 2026-07-16: Issue #175 keeps protected preflight validation fail-closed while allowing up to five seconds of server-ahead clock skew only for the client-side `completed_at` comparison. Expired, reversed, over-180-second, foreign, and malformed proofs still fail before gates or admission, the database remains authoritative for token expiry and one-shot consumption, and timing diagnostics never include the preflight token. The command, ownership, release, and workspace-integration boundaries are unchanged.

Review note, 2026-07-16: Issue #177 changes tests only: native path helpers replace POSIX separators, the default-spawn failure uses a guaranteed-missing temporary executable, successful spawn remains injected, and POSIX mode-bit assertions run only where those semantics exist. Runtime behavior, raw protected bytes, ownership, release, and workspace-integration boundaries are unchanged.

Review note, 2026-07-16: Issue #178 is the dedicated 0.0.27 version-bump release for the merged protected clock-skew fix and Windows-portable validation suite. It adds no command, runtime, dependency, approval, database, or alternate publication path; automated tag creation, Trusted Publishing, and exact released-commit workspace integration remain mandatory.

Review note, 2026-07-16: Issue #182 corrects only the terminal protected verifier's JSON hash-domain bridge. Independent RLS rows remain bound to the approved plan with the CLI canonical hash; the already closure-hash-validated primary action evidence binds PostgreSQL `jsonb::text` hashes to the fresh derivative snapshot; and the snapshot SHA remains bound to the terminal completion proof. Cross-domain hashes are never compared directly. Missing, duplicate, foreign, invalid, or drifting evidence still fails closed, and admission, ownership, database, release, and workspace-integration boundaries are unchanged.

Review note, 2026-07-16: Issue #184 is the dedicated 0.0.28 version-bump release for merged verifier fix #182. It adds no command, runtime, dependency, approval, database, or alternate publication path; automated tag creation, Trusted Publishing, provenance verification, and exact released-commit workspace integration remain mandatory before production status-only verification.

Review note, 2026-07-16: Issue #186 adds the CLI-owned `release` transport for LCI/LCIA data releases. The standalone release control plane remains the workflow owner, Edge/Database remain the authorization and state-machine owners, and this repo owns file-first command parsing, user-session exchange, exact four-ZIP upload verification, stable reports, and hash-verified downloads. The CLI never receives a service-role key; private and mutating operations depend on a server-verified `data_product_manager` account.

Review note, 2026-07-17: Issue #191 changes only LCI/LCIA release tests so the four-platform matrix asserts POSIX mode bits and chmod-based cleanup failures only where those semantics exist. Runtime behavior, command ownership, credentials, release automation, and workspace-integration requirements are unchanged.

Review note, 2026-07-17: Issue #189 is the dedicated 0.0.29 version-bump release for the merged LCI/LCIA release transport in Issue #186 / PR #187. It adds no command, runtime, dependency, credential, approval, database, or alternate publication path; automated tag creation, npm Trusted Publishing, provenance verification, and exact released-commit workspace integration remain mandatory.

Review note, 2026-07-23: Issue #194 extends `dataset save-draft` with an explicit ordered owner-draft execution contract. The CLI binds project, owner, state 0, row identity, payload hashes, expected operations, before hashes, and earlier-action dependencies; it records each `action_id@desired_sha256` attempt in stable user state before dispatch and resolves ambiguous or orphaned attempts by exact owner readback without replay. This adds no service-role, direct-table, publication, delete, state/schema, or package-release path.

Review note, 2026-07-23: Issue #196 is the dedicated 0.0.30 release for merged Issue #194 / PR #195. Windows release-gate evidence exposed that `fsync` on a reopened read-only execution-ledger descriptor returns `EPERM`; the release now fsyncs create/append operations on their write-capable descriptors before close. Attempt-before-dispatch ordering, no-replay semantics, dependencies, authorization, tag automation, npm Trusted Publishing, provenance verification, and exact released-commit workspace integration remain unchanged.

Review note, 2026-07-23: Issue #198 releases 0.0.31 and makes dataset save-draft validation side-effect free. SDK schema/entity validation receives a deep clone, while execution-contract hashing, dispatch, and readback remain bound to the original exact input payload. Owner/state/project fencing, attempt-before-dispatch ordering, no-replay semantics, command ownership, and publication boundaries remain unchanged.

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
- `scripts/docpact route --root . --intent lca-data-release`
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
- `dataset maintenance flow-identity` owns Step 3 in `src/lib/dataset-maintenance-flow-identity-*.ts`. Capture/plan/freeze/seal-approval are immutable file-first boundaries; capture makes one attestation POST after one complete census and stores only the affected/reference-closure process subset. Run uses thin authenticated guarded scope/per-process/finalize RPCs, serializes on the database-ledger next ordinal, and never computes derivative baselines client-side; verify performs a fresh exact-count owner-draft process census plus exact source/public/support/process readback. This path changes only the five TIDAS flow-reference fields in affected process exchanges. It never mutates the 305 source flows, public targets, support data, state codes, or publication state, and it never uses generic maintenance apply or the Step 2 protected runner as a fallback.
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
