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
  - scripts/docpact-gate.sh
  - scripts/install-git-hooks.sh
lastReviewedAt: 2026-05-10
lastReviewedCommit: ea4e5b546ffdd4d5b57d266a58a3d3d5d83c8e5b
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
docpact validate-config --root . --strict
docpact lint --root . --base <base> --head <head> --mode enforce
```

## Validation Matrix

| Change type | Minimum local proof | Additional proof when risk is higher | Notes |
| --- | --- | --- | --- |
| `bin/**`, `src/main.ts`, or `src/cli.ts` | `npm run lint`; `npm test`; `npm run build` | run the relevant `tiangong-lca --help` or subcommand help path after build | Launcher and dispatch changes affect the public command surface directly. |
| session, auth, env, or remote adapter helpers under `src/lib/{dotenv,env,user-api-key,supabase-*,remote,http}*` | `npm run lint`; `npm test`; `npm run build` | run focused tests for the touched helper plus one command that exercises the changed path | Record any required live env assumptions in the PR note. |
| flow, process, lifecyclemodel, review, publish, or run command families | `npm run lint`; `npm test`; `npm run build` | run focused tests for the touched command family; run `npm run test:coverage:assert-full` if the change touched uncovered branches; prefer `npm run prepush:gate` when the change adds new command paths | Preserve the low-entropy command contract and structured artifact outputs. |
| artifact, IO, or state-lock behavior | `npm run lint`; `npm test`; `npm run build` | run one representative command path that writes the changed artifact layout, if safe | Path and file layout regressions matter for downstream automation. |
| `test/**` or coverage gate scripts | `npm run lint`; `npm test`; `npm run test:coverage`; `npm run test:coverage:assert-full` | run `npm run prepush:gate` when the change affects the protected-branch gate directly | Coverage for `src/**/*.ts` is expected to remain at `100%`. |
| `package.json`, `.nvmrc`, `scripts/ci/**`, or `.github/workflows/**` | `npm run lint`; `npm test`; `npm run build` | run `npm run prepush:gate`; run `docpact lint` when the change affects release or documentation gates | Release-tag checks, workflow guards, and dependency baselines change the repo contract. |
| governed docs only | `docpact validate-config --root . --strict`; `docpact lint --root . --staged --mode enforce` | run one focused route check, such as `command-surface`, `remote-session`, or `validation-release`, when the change touches routing or release docs | Refresh review metadata even when prose-only docs change. |

## Coverage Notes

Facts that matter:

- `npm run test:coverage` is the full coverage proof
- `npm run test:coverage:assert-full` verifies the latest coverage artifact without rerunning coverage
- `npm run prepush:gate` is the exact protected-branch gate
- `process save-draft` and the newer process maintenance commands are expected to preserve `100%` coverage even when they add schema-validation or fallback branches
- release-tag and docpact lint workflow changes should be described in the PR note when they alter the local or protected-branch proof

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

The `pre-push` hook runs `scripts/docpact-gate.sh`, which performs strict config validation and `docpact lint --mode enforce` before the push leaves the machine. The default comparison base is `origin/main`. Override it for unusual stacks with `DOCPACT_BASE_REF=<ref>` or `scripts/docpact-gate.sh --base <ref>`. The gate writes its detailed report to a temporary file so normal pushes do not create `.docpact/runs/` artifacts.
