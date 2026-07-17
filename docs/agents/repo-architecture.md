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
lastReviewedAt: 2026-07-17
lastReviewedCommit: 497ac46bba02297b46cee255429371bf20074487
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

Review note, 2026-07-12: `merge-support-aliases` is one fixed BAFU owner-draft transformation inside the maintenance boundary. Scope and plan require `target_mode=owner_draft`; planning freezes exact current-owner state-0 source/target support and exchange closure; apply sends ordered `time` and `length_time` batches in one `target_visibility=owner_draft` whole-plan guarded RPC; verify re-reads private state and validates the mode-bound plan/batch/row/exchange proof chain. Publication is a separate future workflow.

Review note, 2026-07-13: account-wide maintenance reads now share one exact-count paginator. Requested page size is not treated as the server's effective page size; actual returned lengths advance offsets, exact `Content-Range` totals and strict row identities prove pagination completeness under stable filtered membership/order, and incomplete scans fail before artifacts or writes. The aggregate proof describes a multi-request traversal, not transaction-level/MVCC snapshot isolation.

Review note, 2026-07-14: `rebuild-derivatives` stays inside the native dataset-maintenance family as a derivative-only asynchronous profile. V1 freezes exactly one current-owner state-0 process action and its action-scoped database snapshot, admits work only through an owner-draft guarded RPC, and separates `accepted`/`queued` apply proof from terminal `pending`/`passed`/`failed` verification. No Edge/admin/raw queue/SQL/REST mutation fallback was added.

Review note, 2026-07-15: `run-protected` remains in the native dataset-maintenance family and adds no second orchestration runtime. The command separates sealed request parsing, one-shot execution/recovery, and terminal independent verification into dedicated modules; it is production-only, admits at most once, and requires exact 23-flow + 27-process derivative closure without adding a Dev data replay or legacy-RPC fallback.

Review note, 2026-07-15: Issue #171 adds two preparation commands without broadening the mutation surface. `freeze-protected` owns production-authenticated read-only census/support/derivative capture and canonical unapproved artifacts; `seal-protected-approval` owns byte-exact offline human-approval recording and receives no session, environment, or network client. Only the existing `run-protected` module owns preflight, admission, execution, or recovery. Foundry remains a thin published-CLI caller and must not duplicate canonical hashing or database access.

Review note, 2026-07-16: Issue #157 keeps Step 3 in a dedicated native TypeScript workflow: `dataset-maintenance-flow-identity-{capture,contract,plan,execution-contract,freeze,seal,run,verify}.ts`. It does not reuse generic apply or the Step 2 runner. Capture scans the full owner-draft process table once but persists only the reviewed reference closure, then submits one thin semantic request for an immutable database receipt. The database receipt/ledger, not a later client payload or client-side derivative baseline, owns each exact rewrite. Guarded process calls contain only ordinal, scope proof, process-intent proof, and request hash. Durable database scope state is the resume authority and execution concurrency is one. After primary completion the runner polls scope read-only until a derivative decision: pending/failed/compensation returns without finalize; exact causal/current readiness permits at most one finalize POST in that invocation; an ambiguous process/finalize response or readiness race never triggers an automatic retry. Independent verification re-scans the complete owner-draft process table and exact stable rows before declaring terminal success.

Review note, 2026-07-17: Issue #157 COMMON hardening stays in the existing capture/contract/remote/run/verify modules. Capture binds two separate passed Issue #29 derivative readbacks, and the remote adapter preserves HTTP-success `ok:false` envelopes as deterministic domain rejections. The write path now carries a database-minted one-wrapper permit that rotates after every successful process/finalize write and never enters durable artifacts; the database is the cross-machine authority, while a fixed create-only local approval claim is defense in depth. Losing the permit or initial preflight response requires a fresh exact recovery approval; an exact read-only lookup can recover only the same actor-owned immutable scope. Remaining gates are merge, Preview validation, and coordinated DB/CLI release.

Review note, 2026-07-16: Issue #175 remains inside `protected-contract` parsing and tests. The client accepts at most five seconds of server-ahead skew for `completed_at`, but does not extend token expiry or the 180-second duration; the database still owns authoritative server-clock gate/admission expiry and one-shot uniqueness. No new runtime, adapter, dependency, artifact family, or database behavior is introduced.

Review note, 2026-07-16: Issue #177 modifies only `test/**` portability assumptions. Native path helpers, a guaranteed-missing temporary executable for the default-spawn failure path, an injected successful spawn, and platform-appropriate permission assertions preserve the existing launcher, artifact, protected-maintenance, dependency, and release architecture.

Review note, 2026-07-16: Issue #178 changes the package version to 0.0.27 and updates the one package-version dispatch fixture. No command family, launcher, session, artifact, protected-maintenance, dependency, tag, publication, or workspace-integration architecture changes.

Review note, 2026-07-16: Issue #182 remains entirely inside `dataset-maintenance-protected-verify`. It replaces one invalid cross-serialization equality with an exact three-part proof bridge: CLI-canonical RLS row to approved plan, PostgreSQL-domain primary action evidence to fresh derivative snapshot, and snapshot SHA to terminal completion proof. It adds no runtime, adapter, artifact schema, RPC, database, dependency, or command surface.

Review note, 2026-07-16: Issue #184 changes the package version to 0.0.28 and updates the one live package-version dispatch fixture. No command family, launcher, session, artifact, protected-maintenance, dependency, tag, publication, or workspace-integration architecture changes.

Review note, 2026-07-16: Issue #186 introduces `src/lib/lca-release.ts` as the CLI transport boundary for LCI/LCIA data releases. The standalone release repository owns the 20-stage workflow and canonical plan construction; Edge and Database own authorization/state transitions. The CLI exchanges only a user API key for a session, verifies the exact four-ZIP set before signed upload, derives the publish credential fingerprint locally, and verifies durable byte size/SHA-256 before exposing downloaded bundle or release artifacts.

Review note, 2026-07-17: Issue #191 changes only platform-specific assertions in `test/lca-release.test.ts`. The LCI/LCIA transport, artifact writer, command surface, filesystem architecture, and release workflow remain unchanged; POSIX mode and chmod failure semantics continue to be tested on platforms that implement them.

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
- `src/lib/lca-release.ts`
- `src/lib/publish.ts`
- `src/lib/run.ts`

These files own the public CLI semantics for those workflows.

### LCI/LCIA data-release transport

`src/lib/lca-release.ts` is deliberately a narrow authenticated adapter, not a second release control plane:

- `src/cli.ts` owns `release prepare|upload|finalize|approve|publish|readback-verify|unpublish|status|current|calculation-bundle|calculation-artifact|artifact-download` parsing, help, and human/JSON rendering.
- The normal `TIANGONG_LCA_API_KEY` bootstrap is exchanged for a user session; no service-role credential or release-specific API key is accepted.
- Edge/Database assert the live `data_product_manager` role for private and mutating actions. CLI-side checks are input and integrity checks, never an authorization substitute.
- Upload requires exactly the Unit Process and standalone LifecycleModel+Result profiles in both TIDAS and ILCD. Local size, SHA-256, media type, and profile/format cardinality are validated before requesting signed upload URLs.
- Calculation Bundle projections, chunks, and ZIPs are file-first. The CLI writes atomically with private permissions, refuses overwrite without `--force`, and exposes downloaded bytes only after exact size and SHA-256 verification.
- The result profile reuses existing TIDAS Process exchange and LCIA result structures. Schema identity/version policy and self-contained package closure are produced upstream by the release control plane and TIDAS tools, not reimplemented here.

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
- `src/lib/dataset-maintenance-pagination.ts`
- `src/lib/dataset-maintenance-alias-rewrite.ts`
- `src/lib/dataset-maintenance-alias-request.ts`
- `src/lib/dataset-maintenance-protected-artifacts.ts`
- `src/lib/dataset-maintenance-protected-before.ts`
- `src/lib/dataset-maintenance-protected-contract.ts`
- `src/lib/dataset-maintenance-protected-preparation.ts`
- `src/lib/dataset-maintenance-protected-toolchain.ts`
- `src/lib/dataset-maintenance-protected-freeze.ts`
- `src/lib/dataset-maintenance-protected-seal.ts`
- `src/lib/dataset-maintenance-protected-run.ts`
- `src/lib/dataset-maintenance-protected-verify.ts`
- `src/lib/dataset-maintenance-support-validation.ts`
- `src/lib/dataset-local.ts`
- `src/lib/lifecyclemodel-save-draft-run.ts`
- `src/lib/lifecyclemodel-graph.ts`

These modules keep validation, entity-level curation queue build/next/verify state, reference rewrites, RLS-scoped account and exact-row maintenance, save-draft preparation, graph extraction, and local artifact reports inside the CLI instead of routing through skills or MCP transports.

The row-level maintenance family is deliberately split by responsibility:

- `contract` owns the versioned scope, immutable plan, action, approval, and report shapes.
- `pagination` owns fail-closed PostgREST exact-count traversal for maintenance account scans and clear-account readbacks. It treats page size as a requested maximum, advances by actual returned length, verifies exact totals/ranges plus strict `id`/`version` identities, and builds per-table and aggregate completeness proofs.
- `remote` owns current-session authentication, current-user RLS reads, exact `id` + `version` row lookup, reference-impact reads, action-scoped derivative snapshots, platform `save_draft` / `delete` / guarded owner-draft RPC execution, and audit correlation. It exposes no direct alias-dimension, derivative worker, or raw queue fallback.
- `alias-request` and `protected-contract` own canonical protected execution request/approval/status parsing, exact count/hash bindings, server-window checks, and fail-closed response shapes.
- `protected-artifacts` owns raw-byte SHA-256 reads with fatal UTF-8 decoding, private immutable `0700` directories and `0600` files, and atomic whole-directory publication for completed freeze/seal evidence sets. `protected-before` owns the shared complete-account, support, projected-reference, and stable 23-flow + 27-process derivative validation used by both capture and execution, including census-to-derivative `modified_at` cross-binding.
- `protected-preparation` owns the pure canonical freeze/request/approval builders, exact human approval text contract, stable target derivation, and explicit rejection of superseded historical Step-2 plan identities. `protected-toolchain` validates released database, published CLI, and merged root-workspace evidence against the running CLI version and explicitly confirmed production project.
- `protected-freeze` owns production-authenticated read-only preparation. It performs no server preflight, gate, admission, execution, or mutation call and writes only an unapproved alias request, complete 50-row baseline, freeze, approval request text/JSON, and zero-write report.
- `protected-seal` owns completely offline approval recording. It receives no environment or remote client, preserves the human-returned UTF-8 bytes exactly, verifies explicit freeze/request/text/account/timestamp bindings, and writes approval artifacts without submitting execution.
- `protected-run` owns the production-only full scan, server preflight, three ordered gate receipts, immutable attempt allocation, single admission transport, and status-only recovery state machine. Commit mode shares the preparation denylist so superseded historical approvals cannot bypass a fresh freeze; it never retries admission or falls back to Dev or the legacy whole-plan alias RPC.
- `protected-verify` owns the terminal server proof plus independent current-user RLS cross-read of primary rows, audits, and all 23 flow + 27 process derivative snapshots. It compares only like-for-like hash domains: RLS canonical JSON to the approved plan, closure-hash-validated database action evidence to database snapshots, and snapshot SHA to terminal completion. Local artifacts or a server status alone cannot produce `passed`.
- `alias-rewrite` owns the fixed two-dimension BAFU profile, reviewed target-reference derivation, closure counting, and arbitrary-precision decimal scaling. It never uses JavaScript binary floating point for exchange amounts.
- `support-validation` validates frozen owner-draft FP/UG payload schemas plus embedded root UUID/version without importing publication behavior.
- `plan` requires a complete exact-count account scan before writing `maintenance-scope.json`, `rls-visible-snapshot.json`, `protected-rows.jsonl`, `reference-impact-report.json`, `maintenance-plan.json`, and `dry-run-report.json`; newly generated plans bind the aggregate completeness proof into the plan hash. Alias plans additionally freeze `exchange-rewrite-plan.jsonl`, three support snapshots per batch, per-process exchange locators/hashes, desired payloads, and exact postconditions. Derivative rebuild plans additionally bind a database-produced snapshot for only the one target action; markdown/vector fields do not expand the account-wide scan.
- `apply` requires another complete exact-count scan before approval or mutation, then re-runs a full-plan drift preflight, verifies `--approve-plan <sha256>` and `--confirm <email>`, and persists approval with the current proof. Ordinary actions remain sequential; the complete ordered alias plan is submitted once to `cmd_dataset_alias_plan_guarded` and is never decomposed into dimension or per-row writes. A derivative rebuild submits its frozen single action only to the guarded RPC and records `accepted`/`queued`, never `completed`; replay must recover the same durable request rather than enqueueing a duplicate. Approval alone never authorizes a derivative replay: `derivative-admission-attempt.json` is written only after the exact just-in-time preflight and immediately before the RPC call, then binds plan, action, snapshot, and actor for lost-response recovery. The ordinary sequential executor rejects derivative actions before any mutation transport. Apply records the operation-specific durable proof.
- `verify` performs fresh remote readback independently of apply and writes `readback-verify-report.json`. Ordinary and alias paths retain their complete-account proofs. Derivative rebuild reads its durable request plus a fresh action-scoped database snapshot and returns only `pending`, `passed`, or `failed`; only terminal derivative freshness with unchanged primary preconditions may pass.

`clear-account` applies the same paginator to its initial five-table snapshot, per-table commit checks, and one final fresh scan of all five tables. It reports success only when the final aggregate proof exists with zero rows; a failed final proof is preserved as `completed_with_failures` because earlier deletes may already have committed. An incomplete initial scan produces no snapshot/approval and cannot reach deletion. These proofs establish pagination completeness only while filtered membership/order is stable; they do not provide transaction-level or MVCC snapshot isolation, so hash/timestamp drift guards and quiescent-account operation remain part of the safety model.

Ordinary V1 maintenance only permits current-user, `state_code=0`, exact-version `contacts`, `sources`, `flows`, and `processes` to become `save_draft` or `delete` actions. `merge-support-aliases` is narrower still: exactly two owner-draft batches (`time`, `length_time`), 52 draft rows, 59 selected exchanges, and 309 unrelated exchanges preserved, with reviewed factors and postcondition counts encoded as contract invariants. Source and target FP/UG plus all changed parents must be the current actor's `state_code=0`; public, foreign, or mixed visibility is rejected. It rewrites references and exchange amounts but does not delete support rows or change visibility.

`rebuild-derivatives` is a third, non-primary-write profile and is bidirectionally bound to `action=rebuild_derivatives`. V1 requires exactly one exact-version `processes` row, `target_mode=owner_draft`, current actor ownership, `state_code=0`, and exactly the `extracted_md` plus `embedding_ft` components. Multiple actions, another table or component set, public/foreign/non-draft state, and primary-payload drift all fail closed. The process primary payload, owner/state, and `modified_at` are invariants rather than mutation targets.

All mutation or asynchronous work admission continues through the public platform dataset command path. Direct SQL, service-role access, raw REST mutation, direct Edge calls, `admin embedding-run`, raw queue access, and Foundry-local delete/update/rebuild implementations are outside this architecture; Foundry may only prepare scope, invoke the CLI, and retain its artifacts.

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
