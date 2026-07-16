---
docType: guide
scope: repo
status: active
authoritative: false
owner: cli
language: en
whenToUse:
  - when installing or invoking the TianGong LCA CLI
  - when checking public command examples
whenToUpdate:
  - when the published CLI executable or invocation contract changes
  - when user-facing command examples change
checkPaths:
  - README.md
  - package.json
  - bin/**
  - src/cli.ts
  - src/main.ts
lastReviewedAt: 2026-07-15
lastReviewedCommit: bd145f692b3fd11e398302dd6a1d2831e058883a
---

# TianGong LCA CLI

Package: `@tiangong-lca/cli` Executable: `tiangong-lca` Node: `24.x`

Review note, 2026-07-12: `dataset maintenance plan/apply/verify` provides current-user RLS-scoped exact-row maintenance with immutable plans, explicit approval, per-action logs, platform audit correlation, and independent readback. `merge-support-aliases` now runs only in `target_mode=owner_draft`: source/target support and all changed rows stay private `state_code=0`; publication is a separate future workflow.

Review note, 2026-07-13: maintenance scans now prove exact-count pagination even when PostgREST returns fewer rows than the requested `--page-size`. An incomplete or inconsistent scan fails before artifacts, approval, or mutation; under stable filtered membership/order the proof represents a complete ordered multi-request traversal, not one transaction-level/MVCC snapshot.

Review note, 2026-07-14: maintenance now includes the protected derivative-only `rebuild-derivatives` operation. V1 plans exactly one current-owner state-0 process with `action=rebuild_derivatives`, `target_mode=owner_draft`, and components `extracted_md` plus `embedding_ft`. Apply only proves guarded-RPC admission (`accepted`/`queued`); independent verify reports `pending`, `passed`, or `failed`.

Review note, 2026-07-15: `dataset maintenance run-protected` adds a production-only path for one sealed private alias execution and its exact 50-target derivative closure. The protected executor is server-dispatched and fenced by the authenticated owner plus exact actor/user_id/state_code=0 and plan-closure checks; RLS remains a defense on public and independent-read surfaces. It performs one server preflight, writes an immutable local attempt marker before one admission POST, and requires status-only recovery after any marker or ambiguous response. It has no dev, legacy-alias, publication, or state-code fallback.

Review note, 2026-07-15: `dataset maintenance freeze-protected` and `seal-protected-approval` close the preparation gap without adding a second execution path. Freeze preparation authenticates directly to the explicitly confirmed production project, performs only complete account/support reads plus the 50 derivative snapshot RPCs, and writes an unapproved canonical request. Approval sealing is entirely local and requires the exact human-returned UTF-8 bytes plus explicit freeze/request/text hashes and account confirmation. Only the later `run-protected` command can preflight or admit work.

Review note, 2026-07-17: `dataset maintenance flow-identity capture|plan|freeze|seal-approval|run|freeze-recovery|seal-recovery-approval|run-recovery|verify` is the dedicated Step 3 workflow for approved BAFU elementary-flow identity mappings. Capture performs one complete authenticated census and one database-attestation POST; plan rejects historical authorities and binds the exact 305-source request to its immutable receipt. The write path uses a database-minted one-wrapper permit that rotates after each successful process/finalize write and is never stored in proof artifacts; a create-only local approval claim is defense in depth. A lost permit or preflight response cannot be replayed: the operator must freeze and approve an exact recovery baseline, while status/recovery may locate only the same actor-owned scope through the exact read-only lookup. Terminal verification independently proves unchanged source/public/support rows, exact desired owner-draft processes, zero approved-source residue, unchanged pending/blocker/orphan closure, and causal derivative completion. Failed/stale derivatives still require a separate derivative-only plan, freeze, and approval and never replay the process mutation. Production use remains gated on merge, Preview validation, and coordinated database/CLI release.

## Run

One-off published run:

```bash
npm exec --yes --package=@tiangong-lca/cli@latest -- tiangong-lca --help
npm exec --yes --package=@tiangong-lca/cli@latest -- tiangong-lca doctor
npm exec --yes --package=@tiangong-lca/cli@latest -- tiangong-lca flow --help
```

Install the published CLI:

```bash
npm install --global @tiangong-lca/cli
tiangong-lca --help
tiangong-lca doctor
tiangong-lca flow --help
```

Run from this repository:

```bash
npm ci
npm run build
node ./bin/tiangong-lca.js --help
```

## Env

Remote commands require:

```bash
TIANGONG_LCA_API_BASE_URL=
TIANGONG_LCA_API_KEY=
TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY=
TIANGONG_LCA_REGION=us-east-1
```

Notes:

- `TIANGONG_LCA_API_BASE_URL` accepts the project root, `/functions/v1`, or `/rest/v1`.
- `TIANGONG_LCA_API_KEY` is the TianGong user API key from the account page, not a Supabase project key.
- The CLI exchanges `TIANGONG_LCA_API_KEY` for a user session, then reuses the access token for both Edge Functions and direct Supabase access.

Optional session control:

```bash
TIANGONG_LCA_SESSION_FILE=
TIANGONG_LCA_DISABLE_SESSION_CACHE=false
TIANGONG_LCA_FORCE_REAUTH=false
```

Optional LLM review env, only for `qa process --enable-llm` or `qa flow --enable-llm`:

```bash
TIANGONG_LCA_REVIEW_LLM_BASE_URL=
TIANGONG_LCA_REVIEW_LLM_API_KEY=
TIANGONG_LCA_REVIEW_LLM_MODEL=
```

## Search

Minimal `search flow` request:

```json
{
  "query": "soda lime glass",
  "filter": {
    "flowType": "Product flow"
  }
}
```

Run:

```bash
tiangong-lca search flow --input ./search-flow.request.json --json
tiangong-lca search process --input ./search-process.request.json --json
tiangong-lca search lifecyclemodel --input ./search-lifecyclemodel.request.json --json
```

Empty search results should be treated as empty whether the response is `[]` or `{"data":[]}`.

## Read

```bash
tiangong-lca flow get --id <flow-id> --version <version> --json
tiangong-lca flow list --id <flow-id> --state-code 100 --limit 20 --json
tiangong-lca process get --id <process-id> --version <version> --json
tiangong-lca process list --state-code 100 --limit 20 --json
```

## Identity Preflight

Use identity preflight before generating new process or flow rows. The command compares one target against local candidate rows and emits a machine-readable `IdentityDecision` so automation can reuse, update, block, or route uncertain cases before payload generation.

```bash
tiangong-lca process identity-preflight --input ./process-preflight.json --out-dir ./process-preflight --json
tiangong-lca flow identity-preflight --input ./flow-preflight.json --out-dir ./flow-preflight --json
tiangong-lca process identity-preflight --input ./process-preflight.json --candidate-input ./exports/processes.jsonl --candidate-input ./local-process-catalog --out-dir ./process-preflight --json
tiangong-lca flow identity-preflight --input ./flow-preflight.json --remote-candidates --remote-query "electricity medium voltage" --remote-limit 20 --out-dir ./flow-preflight --json
```

Minimal input:

```json
{
  "target": {
    "name_en": "market for electricity, medium voltage",
    "reference_flow_id": "flow-electricity",
    "operation": "produce"
  },
  "candidates": [
    {
      "id": "existing-process",
      "name_en": "market for electricity, medium voltage",
      "reference_flow_id": "flow-electricity",
      "operation": "produce"
    }
  ]
}
```

Key outputs under `--out-dir`:

- `outputs/identity-decision.json`
- `outputs/identity-candidates.jsonl`
- `outputs/identity-candidate-sources.json`

`--candidate-input` is repeatable and accepts JSON, JSONL, or a directory scanned recursively for JSON/JSONL candidate rows. Embedded `candidates` from the request and local-scan candidates are evaluated together. Add `--remote-candidates` when the preflight should also call `process_hybrid_search` or `flow_hybrid_search`; `--remote-query` overrides the target-derived search text and `--remote-limit` caps returned candidate rows. Remote candidate search uses the normal Supabase session env: `TIANGONG_LCA_API_BASE_URL`, `TIANGONG_LCA_API_KEY`, `TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY`, and optional `TIANGONG_LCA_REGION`.

When remote search is enabled, the CLI sends a compact fielded `query` string plus supported edge-search options to `process_hybrid_search` or `flow_hybrid_search`: `filter`, `match_count`, `page_size`, `data_source`, `match_threshold`, `full_text_weight`, `extracted_text_weight`, `semantic_weight`, and `rrf_k`. Request-level `remote_candidate_search.profile_hints` are not sent to the Edge Function. They are applied locally before scoring candidates so Foundry can provide source-derived facts such as flow type, flow property, reference unit, elementary categories, geography, reference-flow names, technology route, and system boundary without polluting the full-text/semantic query.

Exact process exchange fingerprints with matching identity context block duplicate creation, while weaker inventory-only matches still route to manual review. Flow preflight also blocks alias-equivalent flows when type, reference property, unit, and category/CAS evidence match.

## Build Plan Gate

Use build-plan gates after identity preflight and before publish handoff. These commands validate the minimum authoring contract for a process or flow build plan, write a standard `GateReport` for Foundry/skill orchestration, and materialize deterministic canonical TIDAS payloads when no explicit payload is embedded in the plan.

```bash
tiangong-lca process build-plan validate --input ./process-build-plan.json --out-dir ./process-build-plan --json
tiangong-lca process build-plan materialize --input ./process-build-plan.json --out-dir ./process-build-plan --json
tiangong-lca flow build-plan validate --input ./flow-build-plan.json --out-dir ./flow-build-plan --json
tiangong-lca flow build-plan materialize --input ./flow-build-plan.json --out-dir ./flow-build-plan --json
```

The minimum plan contract requires an automatic identity decision, EvidenceManifest sources and field bindings, name plan, and the relevant process reference-flow or flow-property fields. Process materialization carries name, quantitative reference, exchange, source evidence, modelling, administrative, and annual supply/production fields from the plan into `processDataSet`; when annual volume source evidence is not explicit, Foundry-facing required-field completion uses the deterministic `9999 missing-data-sentinel/year` value so the schema-required field stays searchable for later database-side curation. Flow materialization carries name, flow type, reference property, source evidence, administrative, and classification fields into `flowDataSet`. `--report-only` keeps exit code `0` while still reporting blockers.

Key outputs under `--out-dir`:

- `outputs/build-plan-gate-report.json`
- `outputs/materialized-process.json`
- `outputs/materialized-flow.json`

## Real DB Flow QA

1. Search or otherwise collect exact flow refs.
2. Materialize DB rows into local QA input.
3. Run QA on the materialized rows.
4. Materialize approved decisions into downstream artifacts.

`flow fetch-rows` input:

```json
[
  {
    "id": "7a285e9a-a9f6-4b86-ab17-6ea17367400c",
    "version": "01.01.001",
    "state_code": 100,
    "cluster_id": "cluster-0001",
    "source": "search-flow"
  }
]
```

`flow materialize-decisions` input:

```json
[
  {
    "cluster_id": "cluster-0001",
    "decision": "merge_keep_one",
    "canonical_flow": {
      "id": "7a285e9a-a9f6-4b86-ab17-6ea17367400c",
      "version": "01.01.001"
    },
    "flow_refs": [
      "7a285e9a-a9f6-4b86-ab17-6ea17367400c@01.01.001",
      "017acdd0-7fd7-44cb-a410-1d559e59c506@01.01.001"
    ],
    "reason": "approved_same_product_flow"
  }
]
```

Run:

```bash
tiangong-lca flow fetch-rows \
  --refs-file ./flow-refs.json \
  --out-dir ./flow-fetch

tiangong-lca qa flow \
  --rows-file ./flow-fetch/qa-input-rows.jsonl \
  --out-dir ./flow-qa

tiangong-lca flow materialize-decisions \
  --decision-file ./approved-decisions.json \
  --flow-rows-file ./flow-fetch/qa-input-rows.jsonl \
  --out-dir ./flow-decisions
```

Key `flow fetch-rows` outputs:

- `qa-input-rows.jsonl`
- `fetch-summary.json`
- `missing-flow-refs.jsonl`
- `ambiguous-flow-refs.jsonl`

Key `flow materialize-decisions` outputs:

- `flow-dedup-canonical-map.json`
- `flow-dedup-rewrite-plan.json`
- `manual-semantic-merge-seed.current.json`
- `decision-summary.json`
- `blocked-clusters.json`

## Other Common Commands

```bash
tiangong-lca process identity-preflight --input ./process-preflight.json --candidate-input /abs/path/to/process-candidates.jsonl --out-dir /abs/path/to/process-preflight --json
tiangong-lca flow identity-preflight --input ./flow-preflight.json --candidate-input /abs/path/to/flow-catalog --out-dir /abs/path/to/flow-preflight --json
tiangong-lca process identity-preflight --input ./process-preflight.json --remote-candidates --remote-limit 20 --out-dir /abs/path/to/process-preflight --json
tiangong-lca process build-plan validate --input ./process-build-plan.json --out-dir /abs/path/to/process-build-plan --json
tiangong-lca flow build-plan validate --input ./flow-build-plan.json --out-dir /abs/path/to/flow-build-plan --json
tiangong-lca process auto-build --input ./examples/process-auto-build.request.json --out-dir /abs/path/to/process-run --json
tiangong-lca process resume-build --run-dir /abs/path/to/process-run --json
tiangong-lca process publish-build --run-dir /abs/path/to/process-run --json
tiangong-lca process batch-build --input ./examples/process-batch-build.request.json --out-dir /abs/path/to/process-batch --json
tiangong-lca dataset validate --input ./rows.jsonl --type auto --out-dir /abs/path/to/dataset-validate --json
tiangong-lca dataset classification audit --type location --input ./rows/processes.jsonl --out-dir /abs/path/to/location-audit --json
tiangong-lca dataset classification apply --type location --input ./rows/processes.jsonl --decisions ./location-decisions.jsonl --out ./rows/processes.located.jsonl --out-dir /abs/path/to/location-apply --json
tiangong-lca dataset curation-queue build --processes ./rows/processes.jsonl --flows ./rows/flows.jsonl --support ./rows/sources.jsonl --out-dir /abs/path/to/curation-queue --json
tiangong-lca dataset curation-queue next --queue-dir /abs/path/to/curation-queue --type support --json
tiangong-lca dataset curation-queue verify --queue-dir /abs/path/to/curation-queue --type process --json
tiangong-lca dataset evidence-search plan --query "中国2026年电力结构数据" --out-dir /abs/path/to/evidence-search --json
tiangong-lca dataset evidence-search run --input ./evidence-search.request.json --results ./search-results.json --out-dir /abs/path/to/evidence-search --json
tiangong-lca dataset references rewrite --input ./rows.jsonl --from flow:<old-id>@<old-version> --to flow:<new-id>@<new-version> --out-dir /abs/path/to/dataset-rewrite --json
tiangong-lca dataset maintenance plan --scope ./maintenance-scope.json --operation redo-import --out-dir /abs/path/to/dataset-maintenance --page-size 1000 --timeout-ms 10000 --json
tiangong-lca dataset maintenance plan --scope ./derivative-rebuild-scope.json --operation rebuild-derivatives --out-dir /abs/path/to/derivative-rebuild --json
tiangong-lca dataset maintenance apply --plan /abs/path/to/dataset-maintenance/maintenance-plan.json --commit --approve-plan <sha256> --confirm <current-account-email> --timeout-ms 10000 --json
tiangong-lca dataset maintenance verify --plan /abs/path/to/dataset-maintenance/maintenance-plan.json --out-dir /abs/path/to/dataset-maintenance/verify --page-size 1000 --timeout-ms 10000 --json
tiangong-lca dataset maintenance run-protected --plan /abs/path/to/maintenance-plan.json --freeze /abs/path/to/protected-execution-freeze.json --approval /abs/path/to/protected-approval.json --out-dir /abs/path/to/protected-run --status-only --json
tiangong-lca lifecyclemodel auto-build --input ./examples/lifecyclemodel-auto-build.request.json --out-dir /abs/path/to/lifecyclemodel-run --json
tiangong-lca lifecyclemodel validate-build --run-dir /abs/path/to/lifecyclemodel-run --json
tiangong-lca lifecyclemodel publish-build --run-dir /abs/path/to/lifecyclemodel-run --json
tiangong-lca lifecyclemodel save-draft --input ./lifecyclemodels.jsonl --out-dir /abs/path/to/lifecyclemodel-save-draft --dry-run --json
tiangong-lca lifecyclemodel graph --input ./lifecyclemodels.jsonl --out-dir /abs/path/to/lifecyclemodel-graph --format all --json
tiangong-lca lifecyclemodel orchestrate plan --input ./lifecyclemodel-orchestrate.request.json --out-dir /abs/path/to/lifecyclemodel-recursive-run --json
tiangong-lca qa process --rows-file ./process-list-report.json --out-dir ./process-qa
tiangong-lca qa process --run-root /abs/path/to/process-run --run-id <run_id> --out-dir ./process-qa
tiangong-lca process save-draft --input ./patched-processes.jsonl --out-dir /abs/path/to/process-save-draft --dry-run --json
tiangong-lca process save-draft --input ./patched-processes.jsonl --out-dir /abs/path/to/process-save-draft --commit --target-user-id <user-id> --json
tiangong-lca flow publish-version --input-file ./ready-flows.jsonl --out-dir /abs/path/to/flow-publish --dry-run --json
tiangong-lca flow publish-reviewed-data --flow-rows-file ./reviewed-flows.jsonl --out-dir /abs/path/to/reviewed-publish --dry-run --json
tiangong-lca publish run --input ./publish-request.json --dry-run
tiangong-lca doctor --json
```

For `publish run`, relative `out_dir` values from either the request body or `--out-dir` are resolved against the request file directory, not the shell `cwd`. Use an absolute path when you want a fixed destination independent of the request file location.

For `qa process`, `--rows-file` accepts either raw process rows as JSON/JSONL or the full JSON report emitted by `tiangong-lca process list --json`, as long as it contains a `rows` array.

For `process identity-preflight` and `flow identity-preflight`, canonical TIDAS wrappers are schema-checked when present. Loose target objects are accepted for early planning and produce `schema_validation.status: "not_applicable"` until materialization. Candidate rows can be embedded in the request, loaded from repeatable `--candidate-input` local files/directories, or fetched through explicit `--remote-candidates` hybrid search; `identity-candidate-sources.json` records scanned files, remote endpoints, queries, filters, edge-search options, and row counts. The remote Edge Function receives only search-safe query/options fields; local-only `profile_hints` stay in the preflight target profile and candidate scoring evidence.

For `process build-plan` and `flow build-plan`, canonical payloads embedded in the plan are schema-checked during `materialize`. Plan-only materialization now creates deterministic canonical `processDataSet` / `flowDataSet` wrappers from the build plan and validates them with the TIDAS SDK before reporting `passed`.

For `process save-draft`, canonical process payloads are validated locally with `ProcessSchema` before any `--commit` write. Schema-invalid rows remain in `outputs/save-draft-rpc/failures.jsonl` instead of being persisted. Batch import callers should pass `--target-user-id`; the CLI then verifies the current auth session and any visible draft owner before writing, while downstream readback verification still proves the final owner and payload.

For `flow publish-version`, canonical flow payloads are validated locally with `FlowSchema` before remote visibility planning or writes. The command always writes `flow-publish-version-gate-report.json`; blocked rows are written to the remote-failure JSONL without calling the remote service.

For `process publish-build`, canonical process payloads are validated locally with `ProcessSchema` before publish handoff artifacts are written. The gate report is `reports/process-publish-schema-gate.json`.

For `publish run`, `verification-report.json` is written next to `publish-report.json` and summarizes the publish ruleset status, blockers, failed entries, deferred entries, and executed entries.

For `lifecyclemodel save-draft`, canonical lifecyclemodel payloads are validated locally with `LifeCycleModelSchema` before any `--commit` write. Schema-invalid rows remain in `outputs/save-draft-bundle/failures.jsonl` instead of being persisted.

For `dataset evidence-search`, `plan` creates the field-level query matrix and search budget. `run` accepts normalized external search results from browser/web-search tools or a generic JSON provider endpoint, then writes `outputs/evidence-search-plan.json`, `outputs/evidence-search-results.jsonl`, `outputs/evidence-search-report.json`, and `outputs/evidence-search-declaration.json` when evidence is absent or only partial. The CLI records scope and normalization; Codex/skills still own semantic judgement and source selection.

For `dataset validate`, `--type auto` supports mixed support scopes containing contact/source/unitgroup/flowproperty rows as well as flow/process/lifecyclemodel rows. For `dataset classification`, `children` and `path` navigate the bundled TIDAS category schemas copied from `tidas-tools`. `audit --type location` scans local rows for schema-derived location-code fields, plus TIDAS LCIA geography and lifecyclemodel connection location fields, whose values are not in `tidas_locations_category.json`; `apply --type location` applies structured decisions to a specific `target_path` when a row has multiple location fields. When `target_path` explicitly points at a schema-derived location field such as `flowDataSet.flowInformation.geography.locationOfSupply`, location apply may create the missing parent object and field; ambiguous or non-location paths still block.

For `dataset curation-queue build/next/verify`, the CLI owns entity-level Foundry import queue state. `build` writes `outputs/curation-queue-manifest.json`, `outputs/curation-queue-tasks.jsonl`, `outputs/curation-queue-locks.json`, `outputs/curation-queue-blockers.jsonl`, and per-entity `input.jsonl`, `closure.json`, and `entity-run-plan.json`. `next` returns one runnable support/flow/process task based on checkpoint state. `verify` passes only when scoped checkpoints are complete and build blockers are absent. AI authoring must return structured patches or build plans, and remote writes remain gated by deterministic apply, schema/QA, prewrite verify, and readback.

For `dataset references rewrite`, `--commit` executes the state-aware save-draft path for patched process and lifecyclemodel rows; without `--commit`, the command only writes local rewrite artifacts.

## Dataset Maintenance

`dataset maintenance plan/apply/freeze-protected/seal-protected-approval/run-protected/verify` is the row-level cleanup surface for bad imports, the fixed BAFU private alias rewrite, and protected derivative rebuilds. Ordinary planning, apply, and independent verification use the authenticated account and RLS. Protected freeze preparation reads the live production owner-draft scope directly with no Dev data replay, while approval sealing is offline. The protected executor is server-dispatched and additionally enforces the sealed actor, user_id, state_code=0, exact target set, and closure hashes on every write.

```bash
tiangong-lca dataset maintenance plan \
  --scope ./maintenance-scope.json \
  --operation repair-references \
  --out-dir ./dataset-maintenance \
  --page-size 1000 \
  --timeout-ms 10000 \
  --json

tiangong-lca dataset maintenance apply \
  --plan ./dataset-maintenance/maintenance-plan.json \
  --commit \
  --approve-plan <sha256> \
  --confirm <current-account-email> \
  --timeout-ms 10000 \
  --json

tiangong-lca dataset maintenance verify \
  --plan ./dataset-maintenance/maintenance-plan.json \
  --out-dir ./dataset-maintenance/verify \
  --page-size 1000 \
  --timeout-ms 10000 \
  --json

tiangong-lca dataset maintenance freeze-protected \
  --plan ./protected-step2/maintenance-plan.json \
  --toolchain-evidence ./protected-step2/toolchain-evidence.json \
  --expected-project-ref <production-project-ref> \
  --confirm <current-account-email> \
  --out-dir ./protected-step2/freeze \
  --page-size 1000 \
  --timeout-ms 10000 \
  --json

# After a human returns protected-approval-request.txt byte-for-byte as human-approval.txt:
tiangong-lca dataset maintenance seal-protected-approval \
  --freeze ./protected-step2/freeze/protected-execution-freeze.json \
  --approval-request ./protected-step2/freeze/protected-approval-request.json \
  --human-approval ./protected-step2/human-approval.txt \
  --approve-freeze-file <freeze-file-sha256> \
  --approve-request <approval-request-sha256> \
  --approve-text <approval-text-sha256> \
  --confirm <current-account-email> \
  --approved-at <approved-at-utc-from-request> \
  --out-dir ./protected-step2/approval \
  --json

tiangong-lca dataset maintenance run-protected \
  --plan ./protected-step2/maintenance-plan.json \
  --freeze ./protected-step2/freeze/protected-execution-freeze.json \
  --approval ./protected-step2/approval/protected-approval.json \
  --out-dir ./protected-step2/run \
  --commit \
  --approve-execution <approved-execution-sha256> \
  --confirm <current-account-email> \
  --wait-seconds 60 \
  --poll-ms 10000 \
  --page-size 1000 \
  --timeout-ms 10000 \
  --json

tiangong-lca dataset maintenance run-protected \
  --plan ./protected-step2/maintenance-plan.json \
  --freeze ./protected-step2/freeze/protected-execution-freeze.json \
  --approval ./protected-step2/approval/protected-approval.json \
  --out-dir ./protected-step2/run \
  --status-only \
  --wait-seconds 60 \
  --json
```

`run-protected` is a separate one-shot path for an already reviewed and sealed production execution; it does not replace ordinary planning. Both modes require the exact plan, freeze artifact, approval artifact, and private output directory. Commit mode additionally requires `--commit`, the exact approved execution identity through `--approve-execution`, and the authenticated account email through `--confirm`. `--status-only` is mutually exclusive with `--commit` and performs no preflight or admission.

`freeze-protected` is the only supported generator for this fixed protected profile. Its toolchain evidence must be canonical JSON with schema `dataset-alias-protected-toolchain-evidence.v1`, production project ref, released-and-read-back database commit/evidence, the currently running published CLI version/commit/evidence, and the merged root-workspace integration commit/Issue. The fixed BAFU profile also has a compiled production project allowlist; the CLI rejects a Dev or arbitrary project even if the operator supplies matching flag/evidence values. The command verifies the exact 52 actions, two batches, six support snapshots, projected reference closure, and stable 23-flow + 27-process derivative snapshots; every derivative snapshot must have the same primary-row `modified_at` as the immediately preceding complete account census. It writes the entire private immutable alias-request, full baseline, freeze, unapproved request JSON/TXT, and final report into a sibling staging directory and atomically exposes the new output directory only after every file succeeds; preflight, gate, admission, mutation, and approval-artifact counts are all zero.

`seal-protected-approval` receives no environment or HTTP client. The freeze command puts one canonical approval-authority `approved_at_utc` into the request JSON, request hash, and human-visible approval text before review; seal requires `--approved-at` to equal that already approved value. The same text therefore cannot be resealed with another timestamp to mint a second database admission identity. The seal report records its actual generation time separately from this pre-authorized identity timestamp. Both commands hash raw file bytes, reject invalid UTF-8, publish their completed output directories atomically, and reject non-canonical freeze/request files, any changed whitespace or final newline, mismatched explicit hash/account/time bindings, and all three superseded historical Step-2 plan identities. Commit-mode `run-protected` rejects the same historical identities, so an old freeze/approval cannot bypass the fresh preparation chain; status-only remains read-only and available for recovery. Seal writes the canonical approval plus a local report, but does not submit execution. Human approval, sealing, and later execution remain separate events.

Before requesting preflight, the command validates the sealed production project, full current-user RLS before-state, support closure, and exact derivative baseline. The server then returns the three expected gate digests and a token valid for at most 180 seconds; the CLI captures and compares the live gate receipts before admission. The server-dispatched write remains fenced to the authenticated actor's exact `user_id`, `state_code=0` rows and sealed plan/closure; independent readback still uses RLS. The CLI writes an immutable local submission marker and sends at most one admission POST. A marker, admission timeout, connection loss, or ambiguous admission response permanently switches that local run to status-only recovery; status-read failures may be polled only within the configured wait window and never cause a second admission or fallback to dev or the legacy whole-plan RPC. The default status polling interval is 10 seconds.

Success requires the terminal database proof and independent RLS readback to agree on the approved execution, exact row/exchange/audit closure, and exactly 50 derivative targets split into 23 flows and 27 processes. `pending`, `failed`, and `indeterminate` all return a non-zero exit status. The protected operation keeps all affected rows private to their owner, changes no `state_code`, and does not publish data.

For the derivative-only profile, use the same three commands with `--operation rebuild-derivatives`. Its scope must contain exactly one `processes` action with `action: "rebuild_derivatives"`, `target_mode: "owner_draft"`, expected current owner, expected `state_code: 0`, and the exact component set `extracted_md` plus `embedding_ft`.

`--page-size` accepts `1-5000` and is only the requested maximum. PostgREST may enforce a lower server-side cap. The CLI requests `Prefer: count=exact`, validates the exact total and returned range from each `Content-Range`, advances the next offset by the number of rows actually returned, and requires strict `id`/`version` ordering without missing or duplicate identities. Each accepted scan records per-table requested/effective page size, page count, rows fetched, exact total, and aggregate entity counts.

This completeness proof means the CLI traversed the filtered result while that table's membership and ordering keys remained stable. Because the tables are read through multiple HTTP requests, it is not a transaction-level or MVCC snapshot of one instant; same-cardinality delete/insert churn can evade total and ordering checks. Plan hashes and apply-time drift checks provide the later mutation guard, and operators must avoid concurrent maintenance of the same account while planning or clearing it.

The scope is intentionally narrow:

- Each requested row must name its table, exact `id`, exact `version`, expected current owner, and draft `state_code=0` state.
- `--operation` accepts `delete`, `retire`, `redo-import`, `repair-references`, `merge-support-aliases`, or `rebuild-derivatives`; it records the operator's maintenance intent and does not broaden the eligible row actions.
- Only current-user `contacts`, `sources`, `flows`, and `processes` can become `save_draft` or `delete` actions.
- `merge-support-aliases` requires top-level `target_mode: "owner_draft"` and accepts only two named batches, `time` and `length_time`. The scope must bind reviewed current-owner draft source and target FP/UG exact ids/versions to 52 `update_json_ordered` actions: 25 time rows (1 FP, 10 flows, 14 processes) and 27 length-time rows (1 FP, 13 flows, 13 processes). Process actions freeze every selected exchange index, internal id, flow id/version, direction, before hash, and both amount strings.
- The alias factors are exact decimal strings: `0.00011415525114155251` for time and `1000` for length-time. Planning requires exactly 20 and 39 selected exchanges, preserves exactly 309 other exchanges in the affected processes, and proves the fixed source-zero/target-reference postconditions. The transformation changes references and the selected `meanAmount`/`resultingAmount`; it does not delete the source FP/UG rows.
- Source alias support, target FP/UG, and every changed flow/process must all belong to the authenticated account at `state_code=0`. Public/shared, foreign-owner, mixed-visibility, non-draft, lifecyclemodel, and unsupported action/table rows remain protected.
- `rebuild-derivatives` accepts exactly one exact-version `processes` row and is bidirectionally bound to `action=rebuild_derivatives`, `target_mode=owner_draft`, and components `extracted_md` plus `embedding_ft`. It cannot target a public/shared row, a foreign owner, a non-draft row, another table, multiple actions, or a partial/different component set. It rebuilds derivatives only; the primary process payload, owner/state, and `modified_at` remain unchanged.
- The CLI classifies and executes an operator-authored scope; it does not decide whether rows are semantically duplicates, canonical replacements, or safe business-level cleanup targets.

`plan` accepts the account scan only after its exact-count proof is complete, then writes the frozen `maintenance-scope.json`, `rls-visible-snapshot.json`, `protected-rows.jsonl`, `reference-impact-report.json`, `maintenance-plan.json`, and `dry-run-report.json`. The snapshot, dry-run report, and newly generated plan carry the aggregate completeness proof, so it is bound into the plan SHA-256. Alias plans additionally write `exchange-rewrite-plan.jsonl`, freeze current-owner state-0 target FP, target UG, and source UG snapshots for each batch, derive schema-valid desired payloads with matching embedded UUID/version, and include the exact closure, `modified_at`, hashes, conversion evidence, and postconditions in the approved plan. A derivative rebuild plan additionally obtains a database-produced snapshot for only the exact target action and binds its primary and derivative preconditions into the plan; large markdown/vector fields are not added to the account-wide scan. The plan SHA-256 is the approval identity; do not edit or recompute the plan after review.

`apply` is write-disabled unless all three commit guards are present: `--commit`, `--approve-plan <sha256>`, and `--confirm <current-account-email>`. Before approval is persisted or any write runs, it requires a fresh complete exact-count account scan and re-checks the whole plan for drift; the current completeness proof is recorded in `approval-record.json`. Ordinary draft updates/deletes use their platform paths. The original V1 alias adapter retains its frozen request and artifact contract for compatibility, but it is not an authorized execution or recovery fallback for a sealed production `merge-support-aliases` plan. That plan must use `run-protected`, whose database contract replaces replay with one durable attempt/admission identity.

For `rebuild-derivatives`, apply submits the frozen single-action plan only to the authenticated guarded RPC. The database admission envelope must report `queued`; the CLI records that durable admission as an `accepted` action with queued proof. It does not mean markdown or embedding generation has completed. Replay must return the same durable request/proof rather than enqueueing a second rebuild. There is no fallback to a direct Edge call, `admin embedding-run`, a raw queue, SQL, service-role credentials, or raw REST mutation.

`verify` requires another complete exact-count account readback rather than trusting the apply report, records its completeness proof, and writes `readback-verify-report.json` in its own output directory. For alias plans it also requires both successful batch records, all 52 correlated row records, all 59 unique exchange records, unchanged support snapshots, and exact desired row payloads. It validates the RPC-returned audit ids against the local proof chain; it does not independently query `public.command_audit_log`. For derivative rebuild plans, verify reads the durable request plus a fresh action-scoped process snapshot and reports only `pending`, `passed`, or `failed`. Database statuses `queued`, `dispatching`, `markdown_pending`, and `embedding_pending` map to `pending`; `completed` maps to `passed` only when both requested derivatives are current and every frozen primary-field precondition remains unchanged; `stale` and `failed` map to `failed`. The raw status proof, including `phase` and `fence_active`, is preserved in the report. A failed rebuild does not by itself prove that the primary-row write fence has been released.

`dataset maintenance clear-account` uses the same exact-count rule for its initial five-table snapshot, per-table commit checks, and a final fresh scan of all five tables. It reports `cleared_account` only when that final aggregate proof exists with `row_count=0`; if the final proof fails after deletions begin, it still writes a `completed_with_failures` audit report. If the initial scan cannot prove completeness, it writes no snapshot or approval artifact and performs zero deletes.

Foundry and skills may prepare the scope, invoke these commands, and retain their artifacts. They must not replace the CLI with direct SQL, service-role access, raw REST mutation, or private Supabase delete/update code.

## More Docs

- `docs/IMPLEMENTATION_GUIDE_CN.md`: maintainer-facing command contract and implementation notes
- `--help`: the canonical command surface for `tiangong-lca`, `tiangong-lca qa`, `tiangong-lca flow`, `tiangong-lca process`, `tiangong-lca lifecyclemodel`, and `tiangong-lca publish`
- `tiangong-lca-skills`: use the skill-specific `SKILL.md` and wrapper docs for agent workflows; the CLI README only covers the public invocation contract

## Help

```bash
tiangong-lca --help
tiangong-lca qa --help
tiangong-lca flow --help
tiangong-lca process --help
tiangong-lca lifecyclemodel --help
tiangong-lca publish --help
```
