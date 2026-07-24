---
title: cli Validation Guide
docType: guide
scope: repo
status: active
authoritative: false
owner: cli
language: en
whenToUse:
  - when a tiangong-lca-cli change is ready for local validation
  - when deciding the minimum proof required for command, session, artifact, test, or release-gate changes
  - when writing PR validation notes for tiangong-lca-cli work
whenToUpdate:
  - when the repo gains a new canonical validation command or wrapper
  - when change categories require different minimum proof
  - when the protected-branch or coverage contract changes
checkPaths:
  - docs/agents/repo-validation.md
  - .docpact/config.yaml
  - package.json
  - bin/**
  - src/**
  - test/**
  - scripts/**
  - .github/workflows/**
  - .githooks/pre-push
  - scripts/docpact
  - scripts/docpact-gate.sh
  - scripts/install-git-hooks.sh
lastReviewedAt: 2026-07-25
lastReviewedCommit: 0b0cd23104088ee477acb7c7be12bccdb5719331
related:
  - ../../AGENTS.md
  - ../../.docpact/config.yaml
  - ./repo-architecture.md
  - ../../README.md
  - ../../DEV_CN.md
  - ../release-runbook.md
  - ../release-setup.md
---

## Default Baseline

Unless the change is doc-only, the minimum local baseline is:

```bash
npm run lint
npm test
npm run build
```

For protected-branch parity, the authoritative full gate is:

```bash
npm run prepush:gate
```

When command-surface, release-gate, or governed docs change, also run the repo-local documentation governance gate:

```bash
scripts/docpact validate-config --root . --strict
scripts/docpact lint --root . --base <base> --head <head> --mode enforce
```

Review note, 2026-06-04: dataset curation queue state changes are covered by focused `dataset-curation-queue` tests plus the unchanged TypeScript/build gate.

Review note, 2026-06-05: release 0.0.12 uses the existing release proof contract: unpublished-version check, `npm run prepush:gate`, and `npm pack --dry-run`.

Review note, 2026-06-06: release 0.0.13 keeps local validation separate from publication. Local proof is unpublished-version check, `npm run prepush:gate`, `npm pack --dry-run`, and docpact; npm publication must happen only after the version-bump PR merges to upstream `main` and GitHub Actions runs the tag and publish workflows.

Review note, 2026-06-07: release 0.0.14 requires the same local proof plus focused dataset classification coverage for explicit missing location target creation. Publication remains PR merge to upstream `main`, tag workflow, and npm Trusted Publishing.

Review note, 2026-06-11: release 0.0.15 requires the same local proof plus focused dataset import-lca coverage for the tidas-tools 0.0.28 bundle-flag adaptation and disk-derived report fields. Publication remains PR merge to upstream `main`, tag workflow, and npm Trusted Publishing.

Review note, 2026-07-11: `dataset maintenance plan/apply/verify` adds focused proof for exact-row scope freezing, current-user RLS guards, immutable plan hashing, protected-row classification, full-plan drift preflight, approval-before-write, per-action logs, platform audit correlation, failure/resume behavior, and independent readback verification.

Review note, 2026-07-12: `merge-support-aliases` validation freezes and proves the reviewed BAFU owner-draft profile: required scope/plan `target_mode=owner_draft`, current-actor state-0 source/target support and parents, 25 time rows plus 27 length-time rows, exact factors, 20 plus 39 exchange rewrites, 309 unrelated exchanges preserved, one ordered `target_visibility=owner_draft` whole-plan RPC, immutable support/closure evidence, plan/batch audit-correlated replay, and fresh private-state readback. Public, foreign-owner, mixed-visibility, stale, recomputed, corrupted, or dimension-partial proofs must fail.

Review note, 2026-07-13: maintenance pagination proof now covers requested page sizes above a server cap, actual-length offset progression, exact `Content-Range` totals, strict ordered identities, aggregate entity counts, and fail-before-artifact/write behavior. Tests must not describe the resulting multi-request traversal as a transaction-level or MVCC snapshot.

Review note, 2026-07-14: `rebuild-derivatives` proof requires exactly one owner-draft state-0 process action with the exact `extracted_md` plus `embedding_ft` components, a plan-bound action-scoped database snapshot, guarded-RPC-only admission, idempotent request replay, and independent `pending`/`passed`/`failed` verification. Tests must reject any direct Edge/admin/raw queue/SQL/REST mutation fallback and must not treat `accepted`/`queued` as terminal completion.

Review note, 2026-07-16: Step 3 flow-identity tests must cover all 305 reviewed source decisions, one complete census with unaffected process payloads omitted from persisted capture, exactly one capture-attestation POST, permanent rejection of pre-Step2/224-row authority, equal-count semantic tamper rejection, exact five-field reference patches, collision preservation, pending/blocker/orphan closure, process-schema gates, database-owned derivative baselines, safe no-cycle request hashing, exact v2 response variants, serial next-ordinal execution, bounded scope reads, ambiguous-response zero-retry recovery, offline freeze/seal, and independent terminal readback. Runner tests must prove pending and failed derivative decisions make zero finalize calls, exact causal/current readiness makes one finalize call, and a post-read readiness race returning pending is never retried in the same invocation. A failed/stale derivative must stop without process replay; derivative-only compensation is not authorized without a separate plan, freeze, and exact approval.

Review note, 2026-07-17: Issue #157 COMMON proof additionally requires separate `passed` readback hashes/timestamps for both Issue #29 derivative prerequisites; HTTP-success `ok:false` coverage; exactly one fresh scope read after process rejection; and verifier `pending` only for exact `derivatives_pending`. Tests now also prove exact rotating-permit generation/invocation binding, zero bearer persistence, create-only local approval claims across output directories, replay-with-permit rejection, fresh exact recovery approval, and lost-preflight recovery through one exact read-only lookup with zero guarded writes. The database permit is the cross-machine authority and the local claim is defense in depth. Remaining release gates are merge, Preview validation, and coordinated DB/CLI publication.

Review note, 2026-07-15: protected alias-runner proof requires production-only environment binding, a complete pre-token account/support/50-target scan, three server-derived ordered gates inside the at-most-180-second window, immutable attempt evidence before exactly zero or one admission POST, and status-only recovery after every consumed or ambiguous attempt. Terminal verification must prove the exact 52-row/59-exchange/55-audit primary closure plus 23-flow + 27-process causal derivative closure and independent live RLS parity. Zero-child terminal `failed`/`indeterminate` is valid only with the exact not-started envelope; `completed` and `derivatives_pending` must reject that shape.

Review note, 2026-07-15: Issue #171 preparation proof additionally requires a strict freeze/seal split. Freeze tests must prove complete production owner-draft reads, stable exact 23-flow + 27-process capture, canonical toolchain evidence, zero preflight/gate/admission/mutation/approval artifacts, and rejection of public/foreign/stale/malformed closure. Seal tests must prove zero authentication/network/database calls, exact UTF-8 whitespace and final-newline preservation, explicit freeze-file/request/text/account/timestamp hashes, historical-plan rejection, immutable artifacts, and builder/parser/runner round-trip compatibility. The full `src/**/*.ts` coverage gate remains exactly 100%.

Review note, 2026-07-16: Issue #175 proof requires a fixed five-second allowance only when server `completed_at` is slightly ahead of the client clock. Tests must accept the exact tolerance boundary, reject one millisecond beyond it, retain strict stale/reversed/over-180-second rejection, expose only token-free timing diagnostics, and prove parse failure still occurs before gate capture, submission-marker creation, or admission. Server-side expiry and one-shot enforcement are unchanged.

Review note, 2026-07-16: Issue #177 keeps the validation contract unchanged while making existing tests portable across the four-platform quality matrix. Tests use native path helpers and deterministic spawn doubles; POSIX permission-bit checks remain required on non-Windows platforms, while byte preservation, immutability, hashing, and overwrite rejection remain required everywhere.

Review note, 2026-07-16: Issue #182 adds a production-shaped protected-verifier regression in which the CLI canonical payload hash deliberately differs from the PostgreSQL `jsonb::text` hash. Passing proof must bind RLS live row to the approved plan in the CLI domain, exact unique valid primary `action_evidence` to the fresh snapshot in the database domain, and snapshot SHA to terminal completion. Missing, duplicate, foreign, wrong-action, false owner/state/JSON flags, malformed or unequal hashes, and snapshot/terminal drift must all remain fail-closed. Exact `src/**/*.ts` coverage remains 100%.

Review note, 2026-07-16: Issue #184 keeps the validation contract unchanged for the dedicated 0.0.28 release. In addition to the existing exact-coverage and pre-push gates, release proof requires an unpublished-version check, absent-tag check, dry-run package inspection, a fresh four-platform matrix, AI Doc Lint, and Docpact with no diagnostics before merge.

Review note, 2026-07-16: Issue #178 keeps the validation contract unchanged for the dedicated 0.0.27 release. In addition to the existing exact-coverage and pre-push gates, release proof requires an unpublished-version check, tag-name check, dry-run package inspection, a fresh four-platform matrix, and Docpact with no diagnostics before merge.

Review note, 2026-07-16: Issue #186 adds focused LCI/LCIA release proof for command dispatch, masked dry-runs, exact four-profile ZIP validation, signed-upload metadata binding, manager authorization error preservation, Calculation Bundle path allowlisting, atomic private outputs, overwrite refusal, and exact size/SHA-256 verification for every download. The full `src/**/*.ts` coverage requirement remains 100%, and no live mutation test may use a service-role credential.

Review note, 2026-07-17: Issue #191 keeps the validation contract unchanged while making two LCI/LCIA release permission assertions platform-appropriate. POSIX platforms retain the `0600` output-mode and unreachable-cleanup checks; Windows must pass the same functional, integrity, secrecy, full-coverage, and four-platform gates without pretending to enforce POSIX chmod semantics.

Review note, 2026-07-17: Issue #189 keeps the validation contract unchanged for the dedicated 0.0.29 release. In addition to the exact-coverage and pre-push gates, release proof requires unpublished-version and absent-tag checks, all four live CLI-version fixtures at 0.0.29, dry-run package inspection, AI Doc Lint, Docpact, and the release-time platform matrix before npm publication.

Review note, 2026-07-23: Issue #194 adds focused proof for ordered contract binding, stable action-ledger replay exclusion across copied contract/output paths, exact insert/update before-state checks, crash/orphan recovery, ambiguous transport readback, dependency isolation, owner/project mismatch, ledger corruption, and zero-dispatch parser/preflight failures. The same exact 100% `src/**/*.ts`, lint, build, docpact, and pre-push gates remain authoritative.

Review note, 2026-07-23: Issue #196 keeps the validation contract unchanged for the dedicated 0.0.30 release. The manually dispatched Windows gate is required to prove durable attempt/outcome ledger writes no longer fail on read-only-descriptor `fsync`; all execution-contract recovery/no-replay tests, all four live CLI-version fixtures, exact 100% coverage, dry-run package inspection, Docpact, tag/publish workflows, and exact npm provenance remain required.

Review note, 2026-07-23: Issue #198 adds a regression proving SDK validation cannot mutate the execution-contract input payload, its desired SHA, or the eventual dispatch target, and releases the repair as 0.0.31. Focused execution-contract coverage, all four live CLI-version fixtures, exact 100% coverage, Docpact, the full pre-push gate, the four-platform quality gate, package inspection, and exact npm provenance remain required.

Review note, 2026-07-24: Issue #200 releases 0.0.32 and adds focused proof for serial dependency-prefix completion, bounded suffix concurrency, stable report ordering, repeated-target rejection before DML, owner-token rollover, foreign renewed-session rejection at zero attempts, and unchanged success/UNKNOWN no-replay. Exact 100% coverage, Docpact, pre-push, four-platform quality, package inspection, and npm provenance gates remain required.

Review note, 2026-07-24: Issue #202 releases 0.0.33 and adds focused proof for flow delete-only admission, unique targets, complete RLS-visible process inbound scans, bounded concurrency, PREPARED-before-DISPATCHED durability, exact absent commit proof, lost-response recovery, success/UNKNOWN no-replay, independent-row continuation, and public/foreign/non-draft rejection. Exact 100% coverage, Docpact, pre-push, four-platform quality, package inspection, and npm provenance gates remain required.

Review note, 2026-07-24: Issue #204 adds a production-scale regression for the all-visible process fence: more than 250 visible rows must traverse offsets `0,250,...` with `limit=250`, no `user_id` predicate, exact-count completeness, and zero dispatch on scan or inbound-reference failure.

Review note, 2026-07-25: Issue #206 extends that regression to require the exact `id.asc,version.asc` primary-key order on every all-visible page while retaining the no-`user_id` and exact-count assertions. The test continues to prove that incomplete scans or inbound references dispatch zero mutations.

Review note, 2026-07-25: Issue #208 adds positive proof that a fresh exact-SHA all-process proof skips only the unfiltered live scan and still performs protected deletes, plus negative vectors for stale, foreign-project, foreign-actor, wrong-plan, wrong-target-binding, non-SELECT, nonzero-inbound, P0, chunk-gap, chunk-inbound, SHA-mismatch, incomplete-option, and wrong-mode evidence. Existing live-scan regressions remain required.

## Validation Matrix

| Change type | Minimum local proof | Additional proof when risk is higher | Notes |
| --- | --- | --- | --- |
| `bin/**`, `src/main.ts`, or `src/cli.ts` | `npm run lint`; `npm test`; `npm run build` | run the relevant `tiangong-lca --help` or subcommand help path after build | Launcher and dispatch changes affect the public command surface directly. |
| session, auth, env, or remote adapter helpers under `src/lib/{dotenv,env,user-api-key,supabase-*,remote,http}*`, plus command-local remote adapters such as explicit identity-preflight hybrid search | `npm run lint`; `npm test`; `npm run build` | run focused tests for the touched helper plus one command that exercises the changed path | Record any required live env assumptions in the PR note. |
| flow, process, dataset, lifecyclemodel, review, publish, release, or run command families | `npm run lint`; `npm test`; `npm run build` | run focused tests for the touched command family; run `npm run test:coverage:assert-full` if the change touched uncovered branches; prefer `npm run prepush:gate` when the change adds new command paths | Preserve the low-entropy command contract and structured artifact outputs, including BuildPlan, review/dedup ruleset, publish schema, and verification gate reports when authoring or publish commands are involved. LCI/LCIA release proof must preserve manager-only mutation boundaries, exact four-ZIP upload identity/integrity, masked credentials, manifest-path selection, and byte/hash-verified atomic downloads. Dataset maintenance proof must also cover exact-count account pagination under server caps, plan immutability, current-user RLS/protected-row guards, drift rejection, approval-before-write, append-only action logs, stop/resume behavior, and fresh readback. Atomic alias work additionally requires exact closure, arbitrary-precision amounts, one RPC for the complete two-batch plan, and plan/batch/row/exchange proof-chain tests. Protected preparation additionally requires production-read-only freeze, offline byte-exact seal, canonical released-toolchain evidence, exact 23/27 derivative capture, and zero-write/zero-network separation. Derivative rebuild additionally requires single-action/component allowlists, action-scoped snapshots, guarded-RPC admission/replay, unchanged primary fields, and asynchronous terminal verification tests. |
| artifact, IO, or state-lock behavior | `npm run lint`; `npm test`; `npm run build` | run one representative command path that writes the changed artifact layout, if safe | Path and file layout regressions matter for downstream automation. |
| `test/**` or coverage gate scripts | `npm run lint`; `npm test`; `npm run test:coverage`; `npm run test:coverage:assert-full` | run `npm run prepush:gate` when the change affects the protected-branch gate directly | Coverage for `src/**/*.ts` is expected to remain at `100%`. |
| `package.json`, `.nvmrc`, `scripts/ci/**`, or `.github/workflows/**` | `npm run lint`; `npm test`; `npm run build` | run `npm run prepush:gate`; run `docpact lint` when the change affects release or documentation gates | Release-tag checks, workflow guards, and dependency baselines change the repo contract. |
| governed docs only | `scripts/docpact validate-config --root . --strict`; `scripts/docpact lint --root . --staged --mode enforce` | run one focused route check, such as `command-surface`, `remote-session`, or `validation-release`, when the change touches routing or release docs | Refresh review metadata even when prose-only docs change. |

## Coverage Notes

Facts that matter:

- `npm run test:coverage` is the full coverage proof
- `npm run test:coverage:assert-full` verifies the latest coverage artifact without rerunning coverage
- `npm run prepush:gate` is the exact local test gate
- the local `pre-push` hook runs docpact first and then `npm run prepush:gate`
- `.github/workflows/quality-gate.yml` is manual-dispatch only for remote reproduction, not an ordinary push-triggered test runner
- `process save-draft`, `lifecyclemodel save-draft`, ordered `dataset save-draft --execution-contract`, dataset governance commands such as curation queue build/next/verify, BuildPlan gates, publish schema/verification gates, and the newer process maintenance commands are expected to preserve `100%` coverage even when they add schema-validation, rewrite, recovery, or fallback branches
- LCI/LCIA release tests must cover all public actions and error branches without real credentials: user-session bootstrap is stubbed, remote error codes are preserved, upload request metadata is bound to local files, Calculation Bundle artifact selection is exact-path only, credentials stay masked, and no file becomes visible before size/hash verification succeeds. Live smoke tests, when explicitly authorized, use a disposable release identity and a real `data_product_manager` account through the public Edge/Database path; service-role or direct SQL evidence is invalid.
- Dataset maintenance tests must prove exact `id` + `version`, expected state, and current-account ownership are enforced; rows outside the explicitly authorized owner-draft alias profile remain protected; no action runs after full-plan drift or approval mismatch; approval is persisted before the first mutation; each attempted action is appended durably to `apply-progress.jsonl` with plan/action/mode correlation, actor, timing, before/after hashes, result/error, and rollback fields; and `verify` performs its own remote readback instead of trusting `apply` output.
- Exact-count pagination tests must prove that a requested page size such as 5000 still follows a 1000-row server cap with offsets `0,1000,2000...`; an exact multiple terminates without a speculative empty request; a true zero result accepts `*/0`; and missing/invalid/changing totals, early empty pages, range/body mismatch, page overflow, rows beyond total, missing/duplicate/out-of-order identities, foreign-owner rows, malformed/duplicate aggregate table proofs, or partial aggregate table sets fail closed. `plan`, apply preflight, and `verify` must not produce an accepted artifact or write after an incomplete scan. `clear-account` must execute zero deletes after an incomplete initial scan, re-read all five tables at the end, require aggregate `row_count=0` for success, and retain a failure audit if the final proof cannot complete after mutation starts. The evidence proves pagination completeness under stable filtered membership/order, not transaction-level/MVCC snapshot isolation.
- Alias-plan tests must prove exact ordered `time`/`length_time` and `target_mode=owner_draft` binding; factors `0.00011415525114155251`/`1000` without binary floating point; 52 row and 59 exchange identities; embedded UUID/version preservation; 309 unrelated exchanges unchanged; source-reference zeroing and fixed target postconditions; exactly one `target_visibility=owner_draft` `cmd_dataset_alias_plan_guarded` call; rollback of the first 25 rows when the second dimension fails; whole-plan lost-response replay; rejection of public/foreign/mixed/stale or 25-row partial state; and rejection of numeric, foreign, duplicate, or mismatched plan/batch/row audit ids. CLI accepts audit ids only as positive-integer strings so PostgreSQL bigint values cannot lose precision in JavaScript. Verify validates returned plan and nested batch proofs with their local correlation, but does not independently query `public.command_audit_log`; the guarded RPC remains responsible for audit-row creation and replay proof.
- Derivative-rebuild tests must prove `operation=rebuild-derivatives` and `action=rebuild_derivatives` are bidirectionally bound; V1 accepts exactly one exact-version `processes` row with current owner, `state_code=0`, `target_mode=owner_draft`, and exactly `extracted_md` plus `embedding_ft`. They must reject zero/multiple actions, other tables/components, public/foreign/non-draft rows, malformed snapshots, and pre-apply drift. Plan tests must prove the action-scoped database snapshot is included without adding large derivative columns to the account-wide scan. Apply tests must prove exactly one guarded-RPC admission, durable `accepted`/`queued` reporting, idempotent lost-response replay with the same request identity, and no direct Edge, `admin embedding-run`, raw queue, SQL, service-role, or raw REST mutation path. Approval alone must not skip the exact just-in-time preflight; only a valid immutable `derivative-admission-attempt.json`, created immediately before transport and bound to the same plan/action/snapshot/actor, may enable lost-response recovery. Tests must also prove the ordinary sequential executor rejects derivative and unsupported actions before any mutation transport. Verify tests must cover `pending`, `passed`, and `failed`, require both requested derivatives to be current, and fail if any frozen primary precondition changes; an apply admission report alone can never pass verification.
- Protected alias-runner tests must prove commit/status-only mutual exclusion; production project and exact actor/plan/freeze/approval/target-set/baseline bindings; no full rescan after server preflight; three ordered server-derived gates within 180 seconds; immutable per-attempt artifacts; one admission POST maximum; no automatic retry, restart replay, Dev replay, generic apply, or legacy-RPC fallback; read-only recovery for timeout, cancellation, lost response, and transient status-read failures; immutable first terminal evidence; and later-live-drift reporting without canonical overwrite. Contract tests must accept exact zero-child `not_started` derivative evidence only for active pre-dispatch states or terminal `failed`/`indeterminate`, while rejecting it for `completed` and `derivatives_pending`. Terminal verification must require exact 52 rows, 59 exchanges, 55 audits, 50 unique targets with a 23/27 table split, causal Markdown/embedding proof, and independent live RLS snapshot equality.
- Protected preparation tests must prove `freeze-protected` performs complete account/support/projected-reference checks and exactly 50 derivative snapshot reads in stable 23-flow + 27-process order while making zero preflight, gate, admission, execution, or mutation calls. Every derivative snapshot must match the immediately preceding census row identity, owner, state, and `modified_at`; concurrent primary drift must fail before freeze artifacts. Tests must reject non-production project evidence, mismatched running CLI/package evidence, malformed or non-canonical toolchain/freeze/request files, public/foreign/non-draft targets, duplicate or incomplete targets, and each superseded historical plan SHA-256. `seal-protected-approval` must receive no environment, session, HTTP, or remote adapter; tests must prove raw-byte hashing, fatal invalid-UTF-8 rejection, exact whitespace/final-newline preservation, explicit freeze-file/request/text/account/timestamp guards, immutable artifacts, and unchanged acceptance by the existing protected runner/parser and production approval-identity algorithm. The canonical `approved_at_utc` must be present in the pre-review request hash/text, and resealing with any other timestamp must fail.
- Live maintenance validation, when explicitly authorized, must use a disposable current-user draft scope and the official platform command path. Direct SQL, service-role credentials, or raw REST mutation are never acceptable test evidence.
- release-tag and docpact lint workflow changes should be described in the PR note when they alter the local or protected-branch proof
- `tag-release-from-merge.yml` is idempotent when the expected `cli-v*` tag already points at the merge commit, and `publish.yml` can be re-run with `workflow_dispatch` only for an existing `cli-v*` tag on `origin/main`
- local npm authentication is not release validation evidence; routine publication is verified by the upstream tag workflow and npm Trusted Publishing workflow after merge

If the task changes control flow, add or update tests instead of using coverage-ignore pragmas.

## Minimum PR Note Quality

A good PR note for this repo should say:

1. which commands ran
2. which focused tests or help paths were exercised when the change touched one command family
3. whether the full protected-branch gate was run or deferred

## Local Docpact Push Gate

Install the versioned local hook once per checkout:

```bash
./scripts/install-git-hooks.sh
```

The `pre-push` hook runs `scripts/docpact-gate.sh`, which delegates CLI lookup to `scripts/docpact` and performs strict config validation plus enforced lint before the push leaves the machine. It then runs `npm run prepush:gate` as the local test gate. The wrapper checks `DOCPACT_BIN`, Cargo install locations, Homebrew install locations, and then `PATH`, so local agent shells should not fail only because bare `docpact` is unavailable. The default comparison base is `origin/main`. Override it for unusual stacks with `DOCPACT_BASE_REF=<ref>` or `scripts/docpact-gate.sh --base <ref>`. The gate writes its detailed report to a temporary file so normal pushes do not create `.docpact/runs/` artifacts.
