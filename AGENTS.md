# AGENTS – TianGong CLI

Use this file as the local entry point for coding agents working in `tiangong-lca-cli`.

## Why This File Exists

- keep repo-specific rules close to the CLI implementation
- reduce agent drift across docs, testing, and delivery
- preserve the current low-entropy command-surface direction

## Runtime Baseline

- Node.js `>= 24 < 25` via `.nvmrc`
- TypeScript source, Node-native runtime first
- direct REST / Edge Function access only; no MCP inside the CLI
- do not add orchestration frameworks such as LangGraph unless a human explicitly approves it
- do not add npm dependencies unless a human explicitly approves it

## Core Commands

```bash
npm install
npm start -- --help
npm run dev -- --help
npm run lint
npm test
npm run test:coverage
npm run test:coverage:assert-full
npm run prepush:gate
npm run build
```

Notes:

- `npm run lint` is currently the required local syntax / type gate.
- `npm run test:coverage` enforces `100%` coverage for `src/**/*.ts`.
- `npm run test:coverage:assert-full` verifies the latest coverage artifact without rerunning coverage.
- `npm run prepush:gate` is the full local push gate: `lint + full coverage + strict 100% assertion`.

## Repo Landmarks

- `bin/tiangong.js`: thin launcher for the stable `tiangong` entrypoint
- `src/cli.ts`: command dispatch, argument parsing, help text, exit semantics
- `src/main.ts`: process entry, `.env` loading, stdout / stderr handling
- `src/lib/**`: reusable CLI helpers
- `test/**`: unit coverage plus launcher smoke tests
- `scripts/assert-full-coverage.ts`: hard coverage gate

## Delivery Contract

- Investigate first with `rg` and nearby files before editing.
- Keep the CLI low-entropy:
  - stable command nouns
  - file-first input
  - structured JSON output
  - no generic “do anything” command layer
- Every modification must be followed by at least `npm run lint`.
- If behavior changed, run the relevant tests in the same working session.
- Before push, the repo must pass `npm run prepush:gate`.
- Keep `src/**/*.ts` at `100%` statements / branches / functions / lines.
- Keep launcher smoke tests in the normal `npm test` suite; do not weaken them to make coverage easier.
- Keep diffs scoped; do not mix unrelated refactors into command-surface changes.

## Documentation Maintenance

- If commands, workflows, or quality gates change, update the docs in the same change.
- At minimum, keep these files aligned when relevant:
  - `README.md`
  - `DEV_CN.md`
  - `docs/IMPLEMENTATION_GUIDE_CN.md`
