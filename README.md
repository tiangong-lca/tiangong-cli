# TianGong LCA CLI

`tiangong-lca-cli` is the unified TianGong command-line entrypoint.

Current implementation choices:

- TypeScript on Node 24
- ship built JavaScript artifacts from `dist/`
- direct REST / Edge Function calls instead of MCP
- file-first input and JSON-first output
- one stable command surface for humans, agents, CI, and skills
- zero npm production runtime dependencies

## Implemented commands

- `tiangong doctor`
- `tiangong search flow`
- `tiangong search process`
- `tiangong search lifecyclemodel`
- `tiangong process auto-build`
- `tiangong process resume-build`
- `tiangong process publish-build`
- `tiangong process batch-build`
- `tiangong lifecyclemodel build-resulting-process`
- `tiangong lifecyclemodel publish-resulting-process`
- `tiangong publish run`
- `tiangong validation run`
- `tiangong admin embedding-run`

## Planned command surface

The `lifecyclemodel` and `process` namespaces are now partially implemented. The remaining workflow migration surface is:

- `tiangong lifecyclemodel auto-build`
- `tiangong lifecyclemodel validate-build`
- `tiangong lifecyclemodel publish-build`
- `tiangong process get`

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

This CLI does not currently require KB, MinerU, MCP, or OpenAI env keys. Those remain skill- or workflow-specific until the corresponding subcommands are actually implemented here.

Run the CLI:

```bash
npm start -- --help
npm start -- doctor
npm start -- doctor --json
npm start -- search flow --input ./request.json --dry-run
npm start -- process auto-build --input ./pff-request.json --json
npm start -- process resume-build --run-id <run-id> --json
npm start -- process publish-build --run-id <run-id> --json
npm start -- process batch-build --input ./batch-request.json --json
npm start -- lifecyclemodel build-resulting-process --input ./request.json --json
npm start -- lifecyclemodel publish-resulting-process --run-dir ./runs/example --publish-processes --publish-relations --json
npm start -- publish run --input ./publish-request.json --dry-run
npm start -- validation run --input-dir ./tidas-package --engine auto
npm start -- admin embedding-run --input ./jobs.json --dry-run
```

## Process build scaffold

`tiangong process auto-build` is the first migrated `process_from_flow` slice. It reads one request JSON from `--input`, loads the referenced ILCD flow dataset from `flow_file`, preserves the old run id contract (`pfw_<flow_code>_<flow_uuid8>_<operation>_<UTC_TIMESTAMP>`), and writes a local run scaffold under `artifacts/process_from_flow/<run_id>/` or `--out-dir`.

The command keeps the legacy per-run layout that later stages still expect, including `input/`, `exports/processes/`, `exports/sources/`, `cache/process_from_flow_state.json`, and `cache/agent_handoff_summary.json`. It also adds CLI-owned manifests such as the normalized request snapshot, flow summary, assembly plan, lineage manifest, invocation index, run manifest, and a compact report artifact.

`tiangong process resume-build` is the second migrated `process_from_flow` slice. It reopens one existing local run by `--run-id` or `--run-dir`, validates the required run artifacts, takes the local state lock, clears any persisted `stop_after` checkpoint, records `resume-metadata.json` and `resume-history.jsonl`, updates `invocation-index.json`, rewrites `agent_handoff_summary.json`, and emits `process-resume-build-report.json`.

`tiangong process publish-build` is the third migrated `process_from_flow` slice. It reopens one existing local run by `--run-id` or `--run-dir`, validates `process_from_flow_state.json`, `agent_handoff_summary.json`, `run-manifest.json`, and `invocation-index.json`, collects canonical process/source datasets from `exports/` or state fallbacks, writes `stage_outputs/10_publish/publish-bundle.json`, `publish-request.json`, `publish-intent.json`, rewrites `agent_handoff_summary.json`, updates the run state and invocation index, and emits `process-publish-build-report.json`.

`tiangong process batch-build` is the fourth migrated `process_from_flow` slice. It reads one batch manifest, prepares a self-contained batch root, fans out multiple local `process auto-build` runs through the CLI-owned contract, writes a structured per-item aggregate report, and preserves deterministic item-level artifact paths for downstream `resume-build` or `publish-build` steps.

`resume-build`, `publish-build`, and `batch-build` all still stop at local handoff boundaries. They do not execute remote publish CRUD or commit mode themselves; that boundary remains in `tiangong publish run`.

## Publish and validation

`tiangong process publish-build` is the process-side local publish handoff command. It prepares the local bundle/request/intent artifacts expected by `tiangong publish run` without reintroducing Python, MCP, or legacy remote writers into the CLI.

`tiangong process batch-build` is the process-side local batch orchestration command. It keeps batch execution file-first and JSON-first, reuses the single-run `process auto-build` contract for each item, and emits one batch report instead of pushing shell loops or Python coordinators back onto the caller.

`tiangong lifecyclemodel publish-resulting-process` is the lifecyclemodel-side local publish handoff command. It reads a prior resulting-process run, writes `publish-bundle.json` and `publish-intent.json`, and preserves the old builder's artifact contract without reintroducing Python or MCP into the CLI.

`tiangong publish run` is the CLI-side publish contract boundary. It normalizes publish requests, ingests upstream `publish-bundle.json` inputs, writes `normalized-request.json`, `collected-inputs.json`, `relation-manifest.json`, and `publish-report.json`, and keeps commit-mode execution behind explicit executors instead of reintroducing MCP-specific logic into the CLI.

`tiangong validation run` is the CLI-side validation boundary. It standardizes local TIDAS package validation through one JSON report shape, supports `--engine auto|sdk|tools|all`, prefers `tidas-sdk` parity validation when available, and falls back to `uv run tidas-validate --format json` when needed.

Run the built artifact directly:

```bash
node ./bin/tiangong.js doctor
node ./bin/tiangong.js process auto-build --input ./pff-request.json --json
node ./bin/tiangong.js process resume-build --run-id <run-id> --json
node ./bin/tiangong.js process publish-build --run-id <run-id> --json
node ./bin/tiangong.js process batch-build --input ./batch-request.json --json
node ./dist/src/main.js doctor --json
```

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
