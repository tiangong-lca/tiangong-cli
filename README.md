# TianGong LCA CLI

`tiangong-lca-cli` is the unified TianGong command-line entrypoint.

Current implementation choices:

- TypeScript on Node 24
- ship built JavaScript artifacts from `dist/`
- direct REST / Edge Function calls instead of MCP
- file-first input and JSON-first output
- one stable command surface for humans, agents, CI, and skills
- zero npm production runtime dependencies

## MCP replacement policy

The CLI replaces MCP with two explicit strategies:

- strategy 1: call domain APIs directly through `tiangong-lca-edge-functions` (Edge Functions / REST)
- strategy 2: access Supabase directly without MCP; prefer the official Supabase JS SDK for broader CRUD semantics, but keep narrow read-only paths on deterministic REST when that avoids unnecessary runtime dependencies

This prevents reintroducing a generic MCP transport layer into the CLI runtime.

## Implemented commands

- `tiangong doctor`
- `tiangong search flow`
- `tiangong search process`
- `tiangong search lifecyclemodel`
- `tiangong process get`
- `tiangong process auto-build`
- `tiangong process resume-build`
- `tiangong process publish-build`
- `tiangong process batch-build`
- `tiangong lifecyclemodel auto-build`
- `tiangong lifecyclemodel validate-build`
- `tiangong lifecyclemodel publish-build`
- `tiangong lifecyclemodel build-resulting-process`
- `tiangong lifecyclemodel publish-resulting-process`
- `tiangong lifecyclemodel orchestrate`
- `tiangong review process`
- `tiangong review flow`
- `tiangong review lifecyclemodel`
- `tiangong flow get`
- `tiangong flow list`
- `tiangong flow remediate`
- `tiangong flow publish-version`
- `tiangong flow publish-reviewed-data`
- `tiangong flow build-alias-map`
- `tiangong flow scan-process-flow-refs`
- `tiangong flow plan-process-flow-repairs`
- `tiangong flow apply-process-flow-repairs`
- `tiangong flow regen-product`
- `tiangong flow validate-processes`
- `tiangong publish run`
- `tiangong validation run`
- `tiangong admin embedding-run`

## Remaining planned command surface

The remaining planned placeholders in the documented surface are now limited to `auth *` and `job *`.

The stable launcher is `bin/tiangong.js`. It loads the compiled runtime at `dist/src/main.js`, while `npm start -- ...` rebuilds and dogfoods the same launcher path.

## Quality gate

The repository enforces:

- `npm run lint`
- `npm run prettier`
- `npm test`
- `npm run test:coverage`
- `npm run test:coverage:assert-full`
- `npm run prepush:gate`

`npm run lint` is the required local gate. It runs `eslint`, deprecated API diagnostics, `prettier --check`, and `tsc`. Coverage is enforced at 100% for `src/**/*.ts`. Launcher smoke tests remain in the normal test suite.

## Quick start

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

nvm install
nvm alias default 24
nvm use

npm install

npm update && npm ci
```

Create `.env`:

```bash
cp .env.example .env
```

Current CLI env contract:

```bash
TIANGONG_LCA_API_BASE_URL=
TIANGONG_LCA_API_KEY=
TIANGONG_LCA_REGION=us-east-1
```

Optional env that only applies to implemented commands which opt into semantic review:

```bash
TIANGONG_LCA_LLM_BASE_URL=
TIANGONG_LCA_LLM_API_KEY=
TIANGONG_LCA_LLM_MODEL=
```

Command-level env reality:

| Command group | Required env |
| --- | --- |
| `doctor` | none |
| `search *` | `TIANGONG_LCA_API_BASE_URL`, `TIANGONG_LCA_API_KEY`, optional `TIANGONG_LCA_REGION` |
| `admin embedding-run` | `TIANGONG_LCA_API_BASE_URL`, `TIANGONG_LCA_API_KEY`, optional `TIANGONG_LCA_REGION` |
| `process get` | `TIANGONG_LCA_API_BASE_URL`, `TIANGONG_LCA_API_KEY` |
| `process auto-build` | none |
| `process resume-build` | none |
| `process publish-build` | none |
| `process batch-build` | none |
| `lifecyclemodel auto-build` | none |
| `lifecyclemodel validate-build` | none |
| `lifecyclemodel publish-build` | none |
| `lifecyclemodel orchestrate` | none |
| `lifecyclemodel build-resulting-process` | none for local-only runs; `TIANGONG_LCA_API_BASE_URL` and `TIANGONG_LCA_API_KEY` when `process_sources.allow_remote_lookup=true` |
| `lifecyclemodel publish-resulting-process` | none |
| `review process` | none for rule-only review; optional `TIANGONG_LCA_LLM_BASE_URL`, `TIANGONG_LCA_LLM_API_KEY`, and `TIANGONG_LCA_LLM_MODEL` when `--enable-llm` is set |
| `review flow` | none for rule-only review; optional `TIANGONG_LCA_LLM_BASE_URL`, `TIANGONG_LCA_LLM_API_KEY`, and `TIANGONG_LCA_LLM_MODEL` when `--enable-llm` is set |
| `review lifecyclemodel` | none |
| `flow get` | `TIANGONG_LCA_API_BASE_URL`, `TIANGONG_LCA_API_KEY` |
| `flow list` | `TIANGONG_LCA_API_BASE_URL`, `TIANGONG_LCA_API_KEY` |
| `flow remediate` | none |
| `flow publish-version` | `TIANGONG_LCA_API_BASE_URL`, `TIANGONG_LCA_API_KEY` |
| `flow publish-reviewed-data` | none for local dry-run; `TIANGONG_LCA_API_BASE_URL` and `TIANGONG_LCA_API_KEY` when `--commit` publishes prepared flow/process rows |
| `flow build-alias-map` | none |
| `flow scan-process-flow-refs` | none |
| `flow plan-process-flow-repairs` | none |
| `flow apply-process-flow-repairs` | none |
| `flow regen-product` | none |
| `flow validate-processes` | none |
| `publish run` | none |
| `validation run` | none |

This CLI does not currently require KB, TianGong unstructured service, MCP, or `OPENAI_*` env keys. Optional semantic review now goes through the canonical `TIANGONG_LCA_LLM_*` keys instead of legacy provider-specific names. The repo already contains internal helper modules for future KB and TianGong unstructured integrations, but no public command consumes those env keys yet, so they are intentionally absent from `.env.example`.

Run the CLI:

```bash
npm start -- --help
npm start -- doctor
npm start -- doctor --json
npm start -- search flow --input ./request.json --dry-run
npm start -- process get --id <process-id> --version <version> --json
npm start -- process auto-build --input ./examples/process-auto-build.request.json --json
npm start -- process resume-build --run-id <run-id> --json
npm start -- process publish-build --run-id <run-id> --json
npm start -- process batch-build --input ./examples/process-batch-build.request.json --json
npm start -- lifecyclemodel auto-build --input ./examples/lifecyclemodel-auto-build.request.json --json
npm start -- lifecyclemodel validate-build --run-dir ./artifacts/lifecyclemodel_auto_build/<run_id> --json
npm start -- lifecyclemodel publish-build --run-dir ./artifacts/lifecyclemodel_auto_build/<run_id> --json
npm start -- lifecyclemodel orchestrate plan --input ./lifecyclemodel-orchestrate.request.json --out-dir ./artifacts/lifecyclemodel_recursive/<run_id> --json
npm start -- lifecyclemodel build-resulting-process --input ./request.json --json
npm start -- lifecyclemodel publish-resulting-process --run-dir ./runs/example --publish-processes --publish-relations --json
npm start -- review process --run-root ./artifacts/process_from_flow/<run_id> --run-id <run_id> --out-dir ./review --json
npm start -- review flow --rows-file ./flows.json --out-dir ./flow-review --json
npm start -- review lifecyclemodel --run-dir ./artifacts/lifecyclemodel_auto_build/<run_id> --out-dir ./lifecyclemodel-review --json
npm start -- flow get --id <flow-id> --version <version> --json
npm start -- flow list --id <flow-id> --state-code 100 --limit 20 --json
npm start -- flow remediate --input-file ./invalid-flows.jsonl --out-dir ./flow-remediation --json
npm start -- flow publish-version --input-file ./ready-flows.jsonl --out-dir ./flow-publish --dry-run --json
npm start -- flow publish-reviewed-data --flow-rows-file ./reviewed-flows.jsonl --original-flow-rows-file ./original-flows.jsonl --out-dir ./flow-publish-reviewed --dry-run --json
npm start -- flow build-alias-map --old-flow-file ./old-flows.jsonl --new-flow-file ./new-flows.jsonl --out-dir ./flow-alias-map --json
npm start -- flow scan-process-flow-refs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-scan --json
npm start -- flow plan-process-flow-repairs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --scan-findings ./flow-scan/scan-findings.json --out-dir ./flow-repair-plan --json
npm start -- flow apply-process-flow-repairs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --scan-findings ./flow-scan/scan-findings.json --out-dir ./flow-repair-apply --json
npm start -- flow regen-product --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-regen --apply --json
npm start -- flow validate-processes --original-processes-file ./before.jsonl --patched-processes-file ./after.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-validate --json
npm start -- publish run --input ./examples/publish-run.request.json --dry-run
npm start -- validation run --input-dir ./tidas-package --engine auto
npm start -- admin embedding-run --input ./jobs.json --dry-run
```

## Process build scaffold

`tiangong process get` is the CLI-owned read-only process detail surface. It derives a deterministic Supabase REST read path from `TIANGONG_LCA_API_BASE_URL`, resolves one process row by `id/version` with a latest-version fallback, and returns one structured JSON payload without reintroducing MCP, Python, or a generic transport layer.

`tiangong process auto-build` is the first migrated `process_from_flow` slice. It reads one request JSON from `--input`, loads the referenced ILCD flow dataset from `flow_file`, preserves the old run id contract (`pfw_<flow_code>_<flow_uuid8>_<operation>_<UTC_TIMESTAMP>`), and writes a local run scaffold under `artifacts/process_from_flow/<run_id>/` or `--out-dir`.

The command keeps the legacy per-run layout that later stages still expect, including `input/`, `exports/processes/`, `exports/sources/`, `cache/process_from_flow_state.json`, and `cache/agent_handoff_summary.json`. It also adds CLI-owned manifests such as the normalized request snapshot, flow summary, assembly plan, lineage manifest, invocation index, run manifest, and a compact report artifact.

`tiangong process resume-build` is the second migrated `process_from_flow` slice. It reopens one existing local run by `--run-id` or `--run-dir`, validates the required run artifacts, takes the local state lock, clears any persisted `stop_after` checkpoint, records `resume-metadata.json` and `resume-history.jsonl`, updates `invocation-index.json`, rewrites `agent_handoff_summary.json`, and emits `process-resume-build-report.json`.

`tiangong process publish-build` is the third migrated `process_from_flow` slice. It reopens one existing local run by `--run-id` or `--run-dir`, validates `process_from_flow_state.json`, `agent_handoff_summary.json`, `run-manifest.json`, and `invocation-index.json`, collects canonical process/source datasets from `exports/` or state fallbacks, writes `stage_outputs/10_publish/publish-bundle.json`, `publish-request.json`, `publish-intent.json`, rewrites `agent_handoff_summary.json`, updates the run state and invocation index, and emits `process-publish-build-report.json`.

`tiangong process batch-build` is the fourth migrated `process_from_flow` slice. It reads one batch manifest, prepares a self-contained batch root, fans out multiple local `process auto-build` runs through the CLI-owned contract, writes a structured per-item aggregate report, and preserves deterministic item-level artifact paths for downstream `resume-build` or `publish-build` steps.

`resume-build`, `publish-build`, and `batch-build` all still stop at local handoff boundaries. They do not execute remote publish CRUD or commit mode themselves; that boundary remains in `tiangong publish run`.

`tiangong lifecyclemodel auto-build` is the first migrated `lifecyclemodel_automated_builder` slice. It reads one local-run manifest from `--input`, resolves one or more `process-automated-builder` run directories, infers the process graph from shared flow UUIDs, chooses one reference process, computes `@multiplicationFactor`, writes native `json_ordered` lifecyclemodel datasets plus `run-plan.json`, `resolved-manifest.json`, `selection/selection-brief.md`, `discovery/reference-model-summary.json`, `models/**/summary.json`, `connections.json`, and `process-catalog.json`, and keeps the run local-only and read-only.

The canonical `tiangong-lca-skills/lifecyclemodel-automated-builder` entrypoint now uses a native Node `.mjs` wrapper that delegates directly to `tiangong lifecyclemodel auto-build`. The canonical build path no longer routes through Bash, Python, or MCP.

`tiangong lifecyclemodel validate-build` is the second migrated `lifecyclemodel_automated_builder` slice. It reopens one existing local lifecyclemodel build run by `--run-dir`, scans `models/*/tidas_bundle/lifecyclemodels/*.json`, runs the unified validation module against each model bundle, writes per-model reports under `reports/model-validations/`, updates `manifests/invocation-index.json`, and emits `reports/lifecyclemodel-validate-build-report.json`.

`tiangong lifecyclemodel publish-build` is the third migrated `lifecyclemodel_automated_builder` slice. It reopens one existing local lifecyclemodel build run by `--run-dir`, collects native lifecyclemodel payloads from `models/*/tidas_bundle/lifecyclemodels/*.json`, reads the aggregate validation summary when present, writes `stage_outputs/10_publish/publish-bundle.json`, `publish-request.json`, and `publish-intent.json`, updates `manifests/invocation-index.json`, and emits `reports/lifecyclemodel-publish-build-report.json`.

The current lifecyclemodel build family intentionally keeps three boundaries out of the auto-build slice:

- no remote lifecyclemodel CRUD
- no reference-model discovery against MCP / KB / LLM services
- no automatic chaining into validate-build or publish-build

`tiangong lifecyclemodel build-resulting-process` remains local-first, but it no longer hard-fails when a request explicitly enables `process_sources.allow_remote_lookup`. In that mode the CLI derives a deterministic Supabase REST read path from `TIANGONG_LCA_API_BASE_URL`, resolves missing process datasets by exact `id/version` with a latest-version fallback, and keeps the same local artifact contract instead of routing through MCP or semantic search.

`tiangong lifecyclemodel orchestrate` is the native recursive assembly command for multi-node product-system runs. `plan` writes `assembly-plan.json`, `graph-manifest.json`, `lineage-manifest.json`, and `boundary-report.json`; `execute` invokes only native CLI-backed builder slices and records per-invocation results under `invocations/`; `publish` reopens one orchestrator run and prepares `publish-bundle.json` plus `publish-summary.json` from prior local artifacts. Legacy `process_builder.mode=langgraph` and `process_builder.python_bin` are rejected; there is no Python fallback path.

`tiangong review process` is the first migrated review slice. It reopens one local `process_from_flow` run under `exports/processes/`, replays the existing artifact-first review contract, writes bilingual markdown findings plus structured JSON reports, and keeps optional semantic review behind the CLI-owned `TIANGONG_LCA_LLM_*` abstraction instead of direct `OPENAI_*` calls in a skill script.

`tiangong review flow` is the flow-side local governance review slice. It accepts exactly one of `--rows-file`, `--flows-dir`, or `--run-root`, materializes explicit local flow snapshots when needed, writes `rule_findings.jsonl`, `llm_findings.jsonl`, `findings.jsonl`, `flow_summaries.jsonl`, `similarity_pairs.jsonl`, `flow_review_summary.json`, `flow_review_zh.md`, `flow_review_en.md`, `flow_review_timing.md`, and `flow_review_report.json`, and keeps optional semantic review behind the same CLI-owned `TIANGONG_LCA_LLM_*` abstraction. The current CLI slice is intentionally local-first and does not implement `--with-reference-context` or local registry enrichment yet.

`tiangong review lifecyclemodel` is the lifecyclemodel-side local review slice. It reopens one existing lifecyclemodel build run by `--run-dir`, scans `models/*/tidas_bundle/lifecyclemodels/*.json`, reuses `summary.json`, `connections.json`, `process-catalog.json`, and the aggregate `reports/lifecyclemodel-validate-build-report.json` when present, writes `model_summaries.jsonl`, `findings.jsonl`, `lifecyclemodel_review_summary.json`, `lifecyclemodel_review_zh.md`, `lifecyclemodel_review_en.md`, `lifecyclemodel_review_timing.md`, and `lifecyclemodel_review_report.json`, and stays local-first without introducing Python, LangGraph, or skill-local review runtimes.

`tiangong flow get` is the CLI-owned read-only flow detail surface. It derives a deterministic Supabase REST read path from `TIANGONG_LCA_API_BASE_URL`, resolves one visible flow row by `id` plus optional `version` / `user_id` / `state_code`, falls back to the latest visible version when an exact version lookup misses, and rejects ambiguous visible matches instead of guessing.

`tiangong flow list` is the CLI-owned deterministic flow enumeration surface. It reads `/rest/v1/flows` directly, supports stable filters such as repeated `--id`, `--state-code`, and `--type-of-dataset`, defaults to `order=id.asc,version.asc`, and can fetch all matching rows through explicit offset pagination via `--all --page-size <n>` without reintroducing MCP or skill-local transport code.

`tiangong flow remediate` is the first CLI-owned remediation slice for flow governance. It reads one invalid-flow JSON or JSONL input, applies deterministic round1 local remediation, and writes the historical remediation artifacts under one output directory without reintroducing Python or MCP.

`tiangong flow publish-version` is the first CLI-owned remote write slice for flow governance. It reads one ready-for-publish JSON or JSONL input, derives a deterministic Supabase REST path from `TIANGONG_LCA_API_BASE_URL`, performs dry-run or commit mode against `/rest/v1/flows`, and preserves the historical success-list, remote-failure, and sync-report artifact names for downstream follow-up. It still does not implement round2 retry; post-governance product-side regeneration now lives in `tiangong flow regen-product`.

`tiangong flow publish-reviewed-data` is the CLI-owned reviewed publish preparation slice for flow governance. It reads reviewed flow rows and/or reviewed process rows from local JSON or JSONL inputs, can use `--original-flow-rows-file` to skip unchanged flow rows before planning publish, supports `skip | append_only_bump | upsert_current_version`, writes `prepared-flow-rows.json`, `prepared-process-rows.json`, `flow-version-map.json`, `skipped-unchanged-flow-rows.json`, `process-flow-ref-rewrite-evidence.jsonl`, and `publish-report.json`, and preserves the historical success-list / remote-failure / sync-report files for downstream follow-up. The native CLI path now covers local process-row preparation, optional process flow-ref rewrites, and commit-time process publish through the same REST-backed writer layer; no legacy fallback path remains for reviewed process rows.

`tiangong flow build-alias-map` is the CLI-owned deterministic alias-map slice for flow governance. It reads one or more old flow snapshots plus one or more new flow snapshots, optionally consumes a seed alias map, writes `alias-plan.json`, `alias-plan.jsonl`, `flow-alias-map.json`, `manual-review-queue.jsonl`, and `alias-summary.json`, and keeps the boundary local-only instead of routing through skill-local Python.

`tiangong flow scan-process-flow-refs` is the CLI-owned standalone process-reference scan slice for flow governance. It reads one local process row set plus one or more local scope/catalog flow row sets, classifies every `referenceToFlowDataSet`, optionally excludes emergy-named processes up front, and writes stable `emergy-excluded-processes.json`, `scan-summary.json`, `scan-findings.json`, and `scan-findings.jsonl` artifacts without falling back to skill-local Python.

`tiangong flow plan-process-flow-repairs` is the CLI-owned standalone deterministic repair-planning slice for flow governance. It reads one local process row set plus one or more local scope flow row sets, optionally consumes prior `scan-findings`, applies the explicit `disabled | alias-only | alias-or-unique-name` auto-patch boundary, and writes `repair-plan.json`, `repair-plan.jsonl`, `manual-review-queue.jsonl`, and `repair-summary.json`.

`tiangong flow apply-process-flow-repairs` is the CLI-owned standalone deterministic repair-apply slice for flow governance. It reuses the same local process/scope/alias/scan contract as the planning command, applies only the deterministic subset, emits per-process patch evidence under `process-patches/`, writes `patched-processes.json`, and can sync exact-version rows back into a local `process-pool-file`.

`tiangong flow regen-product` is the CLI-owned local product-side regeneration slice for flow governance. It reads one local process row set plus one or more local scope/catalog flow row sets, runs `scan -> repair plan -> optional apply -> optional validate` under one run root, writes stable `scan/`, `repair/`, `repair-apply/`, `validate/`, and `flow-regen-product-report.json` artifacts, and keeps exit code `1` reserved for validation failures after `--apply`.

`tiangong flow validate-processes` is the CLI-owned standalone validation slice for locally patched process rows after governance repair. It reads one original process snapshot, one patched process snapshot, and one or more scope flow snapshots, verifies that only `referenceToFlowDataSet` paths changed, keeps quantitative references stable, optionally runs `tidas-sdk` validation through the existing CLI-side loader, and writes `validation-report.json` plus `validation-failures.jsonl` without falling back to skill-local Python.

## Publish and validation

`tiangong process publish-build` is the process-side local publish handoff command. It prepares the local bundle/request/intent artifacts expected by `tiangong publish run` without reintroducing Python, MCP, or legacy remote writers into the CLI.

`tiangong process batch-build` is the process-side local batch orchestration command. It keeps batch execution file-first and JSON-first, reuses the single-run `process auto-build` contract for each item, and emits one batch report instead of pushing shell loops or Python coordinators back onto the caller.

`tiangong lifecyclemodel validate-build` is the lifecyclemodel-side local validation command. It keeps validation file-first, reuses the unified `tiangong validation run` module under the hood, and writes both per-model reports and one aggregate build report without reintroducing Python or MCP into the CLI.

`tiangong lifecyclemodel publish-build` is the lifecyclemodel-side local publish handoff command. It prepares the local bundle/request/intent artifacts expected by `tiangong publish run` without reintroducing Python, MCP, or legacy remote writers into the CLI.

`tiangong lifecyclemodel publish-resulting-process` is the lifecyclemodel-side local publish handoff command. It reads a prior resulting-process run, writes `publish-bundle.json` and `publish-intent.json`, and preserves the old builder's artifact contract without reintroducing Python or MCP into the CLI.

`tiangong publish run` is the CLI-side publish contract boundary. It normalizes publish requests, ingests upstream `publish-bundle.json` inputs, writes `normalized-request.json`, `collected-inputs.json`, `relation-manifest.json`, and `publish-report.json`, and keeps commit-mode execution behind explicit executors instead of reintroducing MCP-specific logic into the CLI.

`tiangong validation run` is the CLI-side validation boundary. It standardizes local TIDAS package validation through one JSON report shape, supports `--engine auto|sdk`, and keeps the local package-validation path inside the bundled `tidas-sdk` parity validator instead of shelling out to `tidas-tools`.

Run the built artifact directly:

```bash
node ./bin/tiangong.js doctor
node ./bin/tiangong.js process get --id <process-id> --json
node ./bin/tiangong.js flow get --id <flow-id> --json
node ./bin/tiangong.js flow list --state-code 100 --limit 20 --json
node ./bin/tiangong.js flow publish-reviewed-data --flow-rows-file ./reviewed-flows.jsonl --out-dir ./flow-publish-reviewed --dry-run --json
node ./bin/tiangong.js flow build-alias-map --old-flow-file ./old-flows.jsonl --new-flow-file ./new-flows.jsonl --out-dir ./flow-alias-map --json
node ./bin/tiangong.js flow scan-process-flow-refs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-scan --json
node ./bin/tiangong.js flow plan-process-flow-repairs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --scan-findings ./flow-scan/scan-findings.json --out-dir ./flow-repair-plan --json
node ./bin/tiangong.js flow apply-process-flow-repairs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --scan-findings ./flow-scan/scan-findings.json --out-dir ./flow-repair-apply --json
node ./bin/tiangong.js flow regen-product --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-regen --apply --json
node ./bin/tiangong.js process auto-build --input ./examples/process-auto-build.request.json --json
node ./bin/tiangong.js process resume-build --run-id <run-id> --json
node ./bin/tiangong.js process publish-build --run-id <run-id> --json
node ./bin/tiangong.js process batch-build --input ./examples/process-batch-build.request.json --json
node ./bin/tiangong.js lifecyclemodel auto-build --input ./examples/lifecyclemodel-auto-build.request.json --json
node ./bin/tiangong.js lifecyclemodel validate-build --run-dir ./artifacts/lifecyclemodel_auto_build/<run_id> --json
node ./bin/tiangong.js lifecyclemodel publish-build --run-dir ./artifacts/lifecyclemodel_auto_build/<run_id> --json
node ./bin/tiangong.js lifecyclemodel orchestrate plan --input ./lifecyclemodel-orchestrate.request.json --out-dir ./artifacts/lifecyclemodel_recursive/<run_id> --json
node ./bin/tiangong.js flow publish-version --input-file ./ready-flows.jsonl --out-dir ./flow-publish --dry-run --json
node ./bin/tiangong.js publish run --input ./examples/publish-run.request.json --dry-run --json
node ./bin/tiangong.js validation run --input-dir ./package --engine auto --json
node ./dist/src/main.js doctor --json
```

## Examples

Minimal example requests are available under `examples/`:

- `examples/process-auto-build.request.json`
- `examples/process-batch-build.request.json`
- `examples/lifecyclemodel-auto-build.request.json`
- `examples/publish-run.request.json`

## Workspace usage

`tiangong-lca-skills` should stay as thin Node `.mjs` wrappers over this CLI instead of keeping parallel runtimes. The current contract is:

- skills call `tiangong` as the stable entrypoint
- deleted Python, MCP, and OpenClaw runtimes are not supported compatibility paths
- new capability must land as a native `tiangong <noun> <verb>` command before a skill depends on it

## Docs

- Chinese setup guide: [DEV_CN.md](./DEV_CN.md)
- Detailed implementation guide: [docs/IMPLEMENTATION_GUIDE_CN.md](./docs/IMPLEMENTATION_GUIDE_CN.md)
- Skills migration checklist: [docs/SKILLS_TO_CLI_MIGRATION_CHECKLIST_CN.md](./docs/SKILLS_TO_CLI_MIGRATION_CHECKLIST_CN.md)
