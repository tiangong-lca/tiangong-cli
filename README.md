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
- `tiangong lifecyclemodel build-resulting-process`
- `tiangong publish run`
- `tiangong validation run`
- `tiangong admin embedding-run`

## Planned command surface

The `lifecyclemodel` namespace is now partially implemented. The remaining planned surface is:

- `tiangong lifecyclemodel publish-resulting-process`
- `tiangong lifecyclemodel auto-build`
- `tiangong lifecyclemodel validate-build`
- `tiangong lifecyclemodel publish-build`

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
npm start -- lifecyclemodel build-resulting-process --input ./request.json --json
npm start -- publish run --input ./publish-request.json --dry-run
npm start -- validation run --input-dir ./tidas-package --engine auto
npm start -- admin embedding-run --input ./jobs.json --dry-run
```

## Publish and validation

`tiangong publish run` is the CLI-side publish contract boundary. It normalizes publish requests, ingests upstream `publish-bundle.json` inputs, writes `normalized-request.json`, `collected-inputs.json`, `relation-manifest.json`, and `publish-report.json`, and keeps commit-mode execution behind explicit executors instead of reintroducing MCP-specific logic into the CLI.

`tiangong validation run` is the CLI-side validation boundary. It standardizes local TIDAS package validation through one JSON report shape, supports `--engine auto|sdk|tools|all`, prefers `tidas-sdk` parity validation when available, and falls back to `uv run tidas-validate --format json` when needed.

Run the built artifact directly:

```bash
node ./bin/tiangong.js doctor
node ./dist/src/main.js doctor --json
```

## Workspace usage

`tiangong-lca-skills` should converge on this CLI instead of keeping separate transport scripts. The current migration strategy is:

- thin remote wrappers move first
- heavier Python workflows stay in place temporarily
- future skill execution should call `tiangong` as the stable entrypoint

## Docs

- Chinese setup guide: [DEV_CN.md](./DEV_CN.md)
- Detailed implementation guide: [docs/IMPLEMENTATION_GUIDE_CN.md](./docs/IMPLEMENTATION_GUIDE_CN.md)
- Skills migration checklist: [docs/SKILLS_TO_CLI_MIGRATION_CHECKLIST_CN.md](./docs/SKILLS_TO_CLI_MIGRATION_CHECKLIST_CN.md)
