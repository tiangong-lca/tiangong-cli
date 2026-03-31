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
- `tiangong lifecyclemodel build-resulting-process`
- `tiangong lifecyclemodel publish-resulting-process`
- `tiangong review process`
- `tiangong review flow`
- `tiangong flow get`
- `tiangong flow list`
- `tiangong flow remediate`
- `tiangong flow publish-version`
- `tiangong publish run`
- `tiangong validation run`
- `tiangong admin embedding-run`

## Planned command surface

The `lifecyclemodel` and `process` namespaces are now partially implemented. The remaining workflow migration surface is:

- `tiangong lifecyclemodel auto-build`
- `tiangong lifecyclemodel validate-build`
- `tiangong lifecyclemodel publish-build`
- `tiangong review lifecyclemodel`
- `tiangong flow regen-product`

These remaining commands are intentionally not executable yet. They print an explicit `not implemented yet` message and exit with code `2` until the corresponding workflows are migrated into TypeScript.

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
| `lifecyclemodel build-resulting-process` | none for local-only runs; `TIANGONG_LCA_API_BASE_URL` and `TIANGONG_LCA_API_KEY` when `process_sources.allow_remote_lookup=true` |
| `lifecyclemodel publish-resulting-process` | none |
| `review process` | none for rule-only review; optional `TIANGONG_LCA_LLM_BASE_URL`, `TIANGONG_LCA_LLM_API_KEY`, and `TIANGONG_LCA_LLM_MODEL` when `--enable-llm` is set |
| `review flow` | none for rule-only review; optional `TIANGONG_LCA_LLM_BASE_URL`, `TIANGONG_LCA_LLM_API_KEY`, and `TIANGONG_LCA_LLM_MODEL` when `--enable-llm` is set |
| `flow get` | `TIANGONG_LCA_API_BASE_URL`, `TIANGONG_LCA_API_KEY` |
| `flow list` | `TIANGONG_LCA_API_BASE_URL`, `TIANGONG_LCA_API_KEY` |
| `flow remediate` | none |
| `flow publish-version` | `TIANGONG_LCA_API_BASE_URL`, `TIANGONG_LCA_API_KEY` |
| `publish run` | none |
| `validation run` | none |

This CLI does not currently require KB, TianGong unstructured service, MCP, or `OPENAI_*` env keys. Optional semantic review now goes through the canonical `TIANGONG_LCA_LLM_*` keys instead of legacy provider-specific names.

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
npm start -- lifecyclemodel build-resulting-process --input ./request.json --json
npm start -- lifecyclemodel publish-resulting-process --run-dir ./runs/example --publish-processes --publish-relations --json
npm start -- review process --run-root ./artifacts/process_from_flow/<run_id> --run-id <run_id> --out-dir ./review --json
npm start -- review flow --rows-file ./flows.json --out-dir ./flow-review --json
npm start -- flow get --id <flow-id> --version <version> --json
npm start -- flow list --id <flow-id> --state-code 100 --limit 20 --json
npm start -- flow remediate --input-file ./invalid-flows.jsonl --out-dir ./flow-remediation --json
npm start -- flow publish-version --input-file ./ready-flows.jsonl --out-dir ./flow-publish --dry-run --json
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

`tiangong lifecyclemodel build-resulting-process` remains local-first, but it no longer hard-fails when a request explicitly enables `process_sources.allow_remote_lookup`. In that mode the CLI derives a deterministic Supabase REST read path from `TIANGONG_LCA_API_BASE_URL`, resolves missing process datasets by exact `id/version` with a latest-version fallback, and keeps the same local artifact contract instead of routing through MCP or semantic search.

`tiangong review process` is the first migrated review slice. It reopens one local `process_from_flow` run under `exports/processes/`, replays the existing artifact-first review contract, writes bilingual markdown findings plus structured JSON reports, and keeps optional semantic review behind the CLI-owned `TIANGONG_LCA_LLM_*` abstraction instead of direct `OPENAI_*` calls in a skill script.

`tiangong review flow` is the flow-side local governance review slice. It accepts exactly one of `--rows-file`, `--flows-dir`, or `--run-root`, materializes explicit local flow snapshots when needed, writes `rule_findings.jsonl`, `llm_findings.jsonl`, `findings.jsonl`, `flow_summaries.jsonl`, `similarity_pairs.jsonl`, `flow_review_summary.json`, `flow_review_zh.md`, `flow_review_en.md`, `flow_review_timing.md`, and `flow_review_report.json`, and keeps optional semantic review behind the same CLI-owned `TIANGONG_LCA_LLM_*` abstraction. The current CLI slice is intentionally local-first and does not implement `--with-reference-context` or local registry enrichment yet.

`tiangong flow get` is the CLI-owned read-only flow detail surface. It derives a deterministic Supabase REST read path from `TIANGONG_LCA_API_BASE_URL`, resolves one visible flow row by `id` plus optional `version` / `user_id` / `state_code`, falls back to the latest visible version when an exact version lookup misses, and rejects ambiguous visible matches instead of guessing.

`tiangong flow list` is the CLI-owned deterministic flow enumeration surface. It reads `/rest/v1/flows` directly, supports stable filters such as repeated `--id`, `--state-code`, and `--type-of-dataset`, defaults to `order=id.asc,version.asc`, and can fetch all matching rows through explicit offset pagination via `--all --page-size <n>` without reintroducing MCP or skill-local transport code.

`tiangong flow remediate` is the first CLI-owned remediation slice for flow governance. It reads one invalid-flow JSON or JSONL input, applies deterministic round1 local remediation, and writes the historical remediation artifacts under one output directory without reintroducing Python or MCP.

`tiangong flow publish-version` is the first CLI-owned remote write slice for flow governance. It reads one ready-for-publish JSON or JSONL input, derives a deterministic Supabase REST path from `TIANGONG_LCA_API_BASE_URL`, performs dry-run or commit mode against `/rest/v1/flows`, and preserves the historical success-list, remote-failure, and sync-report artifact names for downstream follow-up. It does not implement round2 retry or `flow regen-product` yet.

## Publish and validation

`tiangong process publish-build` is the process-side local publish handoff command. It prepares the local bundle/request/intent artifacts expected by `tiangong publish run` without reintroducing Python, MCP, or legacy remote writers into the CLI.

`tiangong process batch-build` is the process-side local batch orchestration command. It keeps batch execution file-first and JSON-first, reuses the single-run `process auto-build` contract for each item, and emits one batch report instead of pushing shell loops or Python coordinators back onto the caller.

`tiangong lifecyclemodel publish-resulting-process` is the lifecyclemodel-side local publish handoff command. It reads a prior resulting-process run, writes `publish-bundle.json` and `publish-intent.json`, and preserves the old builder's artifact contract without reintroducing Python or MCP into the CLI.

`tiangong publish run` is the CLI-side publish contract boundary. It normalizes publish requests, ingests upstream `publish-bundle.json` inputs, writes `normalized-request.json`, `collected-inputs.json`, `relation-manifest.json`, and `publish-report.json`, and keeps commit-mode execution behind explicit executors instead of reintroducing MCP-specific logic into the CLI.

`tiangong validation run` is the CLI-side validation boundary. It standardizes local TIDAS package validation through one JSON report shape, supports `--engine auto|sdk|tools|all`, prefers `tidas-sdk` parity validation when available, and falls back to `uv run tidas-validate --format json` when needed.

Run the built artifact directly:

```bash
node ./bin/tiangong.js doctor
node ./bin/tiangong.js process get --id <process-id> --json
node ./bin/tiangong.js flow get --id <flow-id> --json
node ./bin/tiangong.js flow list --state-code 100 --limit 20 --json
node ./bin/tiangong.js process auto-build --input ./examples/process-auto-build.request.json --json
node ./bin/tiangong.js process resume-build --run-id <run-id> --json
node ./bin/tiangong.js process publish-build --run-id <run-id> --json
node ./bin/tiangong.js process batch-build --input ./examples/process-batch-build.request.json --json
node ./bin/tiangong.js flow publish-version --input-file ./ready-flows.jsonl --out-dir ./flow-publish --dry-run --json
node ./dist/src/main.js doctor --json
```

## Examples

Minimal example requests are available under `examples/`:

- `examples/process-auto-build.request.json`
- `examples/process-batch-build.request.json`
- `examples/publish-run.request.json`

## Workspace usage

`tiangong-lca-skills` should converge on this CLI instead of keeping separate transport scripts. The current migration strategy is:

- thin remote wrappers move first
- local artifact-first workflow slices move into the CLI incrementally
- remaining heavier workflow stages stay in place temporarily until the matching CLI subcommands exist
- future skill execution should call `tiangong` as the stable entrypoint

## Docs

- Chinese setup guide: [DEV_CN.md](./DEV_CN.md)
- Detailed implementation guide: [docs/IMPLEMENTATION_GUIDE_CN.md](./docs/IMPLEMENTATION_GUIDE_CN.md)
- Skills migration checklist: [docs/SKILLS_TO_CLI_MIGRATION_CHECKLIST_CN.md](./docs/SKILLS_TO_CLI_MIGRATION_CHECKLIST_CN.md)
