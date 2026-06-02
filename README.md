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
lastReviewedAt: 2026-06-01
lastReviewedCommit: 24f96578290267865df3ee1244a96723129bc376
---

# TianGong LCA CLI

Package: `@tiangong-lca/cli` Executable: `tiangong-lca` Node: `24.x`

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

Exact process exchange fingerprints with matching identity context block duplicate creation, while weaker inventory-only matches still route to manual review. Flow preflight also blocks alias-equivalent flows when type, reference property, unit, and category/CAS evidence match.

## Build Plan Gate

Use build-plan gates after identity preflight and before publish handoff. These commands validate the minimum authoring contract for a process or flow build plan, write a standard `GateReport` for Foundry/skill orchestration, and materialize deterministic canonical TIDAS payloads when no explicit payload is embedded in the plan.

```bash
tiangong-lca process build-plan validate --input ./process-build-plan.json --out-dir ./process-build-plan --json
tiangong-lca process build-plan materialize --input ./process-build-plan.json --out-dir ./process-build-plan --json
tiangong-lca flow build-plan validate --input ./flow-build-plan.json --out-dir ./flow-build-plan --json
tiangong-lca flow build-plan materialize --input ./flow-build-plan.json --out-dir ./flow-build-plan --json
```

The minimum plan contract requires an automatic identity decision, EvidenceManifest sources and field bindings, name plan, and the relevant process reference-flow or flow-property fields. Process materialization carries name, quantitative reference, exchange, source evidence, modelling, administrative, and annual supply/production fields from the plan into `processDataSet`; when annual volume is not explicit, it falls back to reference-flow `meanAmount` and then `resultingAmount`. Flow materialization carries name, flow type, reference property, source evidence, administrative, and classification fields into `flowDataSet`. `--report-only` keeps exit code `0` while still reporting blockers.

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
tiangong-lca dataset curation-queue build --processes ./rows/processes.jsonl --flows ./rows/flows.jsonl --support ./rows/sources.jsonl --out-dir /abs/path/to/curation-queue --json
tiangong-lca dataset evidence-search plan --query "中国2026年电力结构数据" --out-dir /abs/path/to/evidence-search --json
tiangong-lca dataset evidence-search run --input ./evidence-search.request.json --results ./search-results.json --out-dir /abs/path/to/evidence-search --json
tiangong-lca dataset references rewrite --input ./rows.jsonl --from flow:<old-id>@<old-version> --to flow:<new-id>@<new-version> --out-dir /abs/path/to/dataset-rewrite --json
tiangong-lca lifecyclemodel auto-build --input ./examples/lifecyclemodel-auto-build.request.json --out-dir /abs/path/to/lifecyclemodel-run --json
tiangong-lca lifecyclemodel validate-build --run-dir /abs/path/to/lifecyclemodel-run --json
tiangong-lca lifecyclemodel publish-build --run-dir /abs/path/to/lifecyclemodel-run --json
tiangong-lca lifecyclemodel save-draft --input ./lifecyclemodels.jsonl --out-dir /abs/path/to/lifecyclemodel-save-draft --dry-run --json
tiangong-lca lifecyclemodel graph --input ./lifecyclemodels.jsonl --out-dir /abs/path/to/lifecyclemodel-graph --format all --json
tiangong-lca lifecyclemodel orchestrate plan --input ./lifecyclemodel-orchestrate.request.json --out-dir /abs/path/to/lifecyclemodel-recursive-run --json
tiangong-lca qa process --rows-file ./process-list-report.json --out-dir ./process-qa
tiangong-lca qa process --run-root /abs/path/to/process-run --run-id <run_id> --out-dir ./process-qa
tiangong-lca process save-draft --input ./patched-processes.jsonl --out-dir /abs/path/to/process-save-draft --dry-run --json
tiangong-lca process save-draft --input ./patched-processes.jsonl --out-dir /abs/path/to/process-save-draft --commit --json
tiangong-lca flow publish-version --input-file ./ready-flows.jsonl --out-dir /abs/path/to/flow-publish --dry-run --json
tiangong-lca flow publish-reviewed-data --flow-rows-file ./reviewed-flows.jsonl --out-dir /abs/path/to/reviewed-publish --dry-run --json
tiangong-lca publish run --input ./publish-request.json --dry-run
tiangong-lca doctor --json
```

For `publish run`, relative `out_dir` values from either the request body or `--out-dir` are resolved against the request file directory, not the shell `cwd`. Use an absolute path when you want a fixed destination independent of the request file location.

For `qa process`, `--rows-file` accepts either raw process rows as JSON/JSONL or the full JSON report emitted by `tiangong-lca process list --json`, as long as it contains a `rows` array.

For `process identity-preflight` and `flow identity-preflight`, canonical TIDAS wrappers are schema-checked when present. Loose target objects are accepted for early planning and produce `schema_validation.status: "not_applicable"` until materialization. Candidate rows can be embedded in the request, loaded from repeatable `--candidate-input` local files/directories, or fetched through explicit `--remote-candidates` hybrid search; `identity-candidate-sources.json` records scanned files, remote endpoints, queries, filters, and row counts.

For `process build-plan` and `flow build-plan`, canonical payloads embedded in the plan are schema-checked during `materialize`. Plan-only materialization now creates deterministic canonical `processDataSet` / `flowDataSet` wrappers from the build plan and validates them with the TIDAS SDK before reporting `passed`.

For `process save-draft`, canonical process payloads are validated locally with `ProcessSchema` before any `--commit` write. Schema-invalid rows remain in `outputs/save-draft-rpc/failures.jsonl` instead of being persisted.

For `flow publish-version`, canonical flow payloads are validated locally with `FlowSchema` before remote visibility planning or writes. The command always writes `flow-publish-version-gate-report.json`; blocked rows are written to the remote-failure JSONL without calling the remote service.

For `process publish-build`, canonical process payloads are validated locally with `ProcessSchema` before publish handoff artifacts are written. The gate report is `reports/process-publish-schema-gate.json`.

For `publish run`, `verification-report.json` is written next to `publish-report.json` and summarizes the publish ruleset status, blockers, failed entries, deferred entries, and executed entries.

For `lifecyclemodel save-draft`, canonical lifecyclemodel payloads are validated locally with `LifeCycleModelSchema` before any `--commit` write. Schema-invalid rows remain in `outputs/save-draft-bundle/failures.jsonl` instead of being persisted.

For `dataset evidence-search`, `plan` creates the field-level query matrix and search budget. `run` accepts normalized external search results from browser/web-search tools or a generic JSON provider endpoint, then writes `outputs/evidence-search-plan.json`, `outputs/evidence-search-results.jsonl`, `outputs/evidence-search-report.json`, and `outputs/evidence-search-declaration.json` when evidence is absent or only partial. The CLI records scope and normalization; Codex/skills still own semantic judgement and source selection.

For `dataset curation-queue build`, the CLI writes entity-level Foundry import queue artifacts: `outputs/curation-queue-manifest.json`, `outputs/curation-queue-tasks.jsonl`, `outputs/curation-queue-locks.json`, `outputs/curation-queue-blockers.jsonl`, and per-entity `input.jsonl`, `closure.json`, and `entity-run-plan.json`. The command only builds deterministic queue state. AI authoring must return structured patches or build plans, and remote writes remain gated by deterministic apply, schema/QA, prewrite verify, and readback.

For `dataset references rewrite`, `--commit` executes the state-aware save-draft path for patched process and lifecyclemodel rows; without `--commit`, the command only writes local rewrite artifacts.

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
