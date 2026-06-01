---
title: cli AI Working Guide
docType: contract
scope: repo
status: active
authoritative: true
owner: cli
language: en
whenToUse:
  - when a task may change the public `tiangong-lca` command surface, CLI runtime behavior, session handling, or release gating
  - when routing work from the workspace root into tiangong-lca-cli
  - when deciding whether a change belongs here, in tiangong-lca-skills, in tiangong-lca-mcp, or in a remote runtime repo
whenToUpdate:
  - when command ownership or repo boundaries change
  - when validation, packaging, or coverage rules change
  - when docpact routing, retained source docs, or repo-local governance rules change
checkPaths:
  - AGENTS.md
  - README.md
  - DEV_CN.md
  - docs/IMPLEMENTATION_GUIDE_CN.md
  - .docpact/config.yaml
  - docs/agents/**
  - package.json
  - .nvmrc
  - bin/**
  - src/**
  - test/**
  - scripts/**
  - .github/workflows/**
  - .githooks/**
  - scripts/docpact
  - scripts/docpact-gate.sh
  - scripts/install-git-hooks.sh
lastReviewedAt: 2026-06-01
lastReviewedCommit: 24f96578290267865df3ee1244a96723129bc376
related:
  - .docpact/config.yaml
  - docs/agents/repo-validation.md
  - docs/agents/repo-architecture.md
  - README.md
  - DEV_CN.md
  - docs/IMPLEMENTATION_GUIDE_CN.md
  - docs/release-runbook.md
  - docs/release-setup.md
---

## Repo Contract

`tiangong-lca-cli` owns the checked-in public `tiangong-lca` CLI contract: command nouns and verbs, launcher behavior, local artifact workflow, remote session/auth handling, and the repo-level release gate. Start here when the task may change what the CLI does or how it is validated.

## Bootstrap Order

Load docs in this order:

1. `AGENTS.md`
2. `.docpact/config.yaml`
3. `scripts/docpact route --root . --intent <intent>` when you need path-specific routing
4. `docs/agents/repo-validation.md` when proof, coverage, CI, or release gating matters
5. `docs/agents/repo-architecture.md` when command ownership, session/runtime layers, or artifact families are unclear
6. `README.md` only for user-facing invocation examples
7. `DEV_CN.md`, `docs/IMPLEMENTATION_GUIDE_CN.md`, `docs/release-runbook.md`, or `docs/release-setup.md` only when that retained source doc matches the task

Do not start with scattered subcommands or tests before you know which command family owns the task.

Preferred docpact commands:

- `scripts/docpact route --root . --intent command-surface`
- `scripts/docpact route --root . --intent remote-session`
- `scripts/docpact route --root . --intent workflow-commands`
- `scripts/docpact route --root . --intent validation-release`
- `scripts/docpact route --root . --intent repo-docs`

## Repo Ownership

This repo owns:

- `bin/tiangong-lca.js` as the stable launcher entrypoint
- `src/cli.ts` and `src/main.ts` for command dispatch, process entry, help, and exit behavior
- `src/lib/**` for reusable CLI command logic, session handling, artifacts, and remote adapters
- `test/**` and `scripts/assert-full-coverage.ts` for the hard validation gate
- package metadata, build output contract, and tag/release checks in `package.json` and `scripts/ci/**`

This repo does not own:

- skill packaging and skill wrapper metadata
- MCP transport or inspector surfaces
- remote product or Edge Function business logic
- workspace integration state after merge

Route those tasks to:

- `tiangong-lca-skills` for skill wrappers and `SKILL.md` packages
- `tiangong-lca-mcp` for MCP transports and tool registration
- the owning runtime repo for API, schema, or product behavior
- `lca-workspace` for root integration after merge

## Runtime Facts

- Repo-local documentation governance is encoded in `.docpact/config.yaml` and enforced locally by the pre-push docpact gate; `.github/workflows/ai-doc-lint.yml` is manual-dispatch fallback.
- Package manager: `npm`
- Node baseline: `>=24 <25`
- Runtime style: TypeScript source, Node-native CLI, direct REST and Edge Function access only
- Newly added process-maintenance commands such as `process identity-preflight`, `process build-plan`, `process scope-statistics`, `process dedup-review`, `process refresh-references`, and `process verify-rows` still belong to the native CLI command surface in `src/cli.ts` and `src/lib/process-*.ts` / shared CLI-native helpers.
- `process save-draft` now has a local `ProcessSchema` validation gate before any commit path writes remote state.
- Dataset-level local governance commands such as `dataset validate` and `dataset references rewrite` belong to the same native CLI command surface in `src/cli.ts` and `src/lib/dataset-*.ts`.
- `lifecyclemodel save-draft` validates canonical lifecyclemodel payloads with `LifeCycleModelSchema` before any commit path writes remote state; `lifecyclemodel graph` remains a local artifact command.
- `flow publish-version` validates canonical flow payloads with `FlowSchema` before remote visibility planning or writes, and emits `flow-publish-version-gate-report.json` as the blocking ruleset artifact.
- `process publish-build` validates canonical process payloads with `ProcessSchema` before publish handoff artifacts are written, and emits `reports/process-publish-schema-gate.json`.
- `publish run` emits `verification-report.json` next to `publish-report.json`; this is the deterministic publish ruleset summary for failed/deferred/executed outcomes.
- `src/lib/runtime-rulesets.ts` is the CLI-local runtime activation layer for stable ruleset ids, methodology rule ids, severity, and blocker semantics used by review, dedup, and publish gate artifacts.
- The canonical minimum validation command is `npm run lint`
- The authoritative full gate is `npm run prepush:gate`; the local pre-push hook runs it after docpact.
- Release tagging is guarded in `.github/workflows/tag-release-from-merge.yml` so only the upstream repository can execute the merge-tag flow, and it runs the release gate only when a package version change will create a tag.
- Coverage for `src/**/*.ts` is expected to stay at `100%` statements, branches, functions, and lines

## Hard Boundaries

- Do not add orchestration frameworks or new npm dependencies without explicit approval
- Do not move business logic into skill wrappers when the native `tiangong-lca` CLI should own it
- Do not weaken the coverage gate with ignore pragmas; cover the branch or remove dead code
- Do not treat governed docs as optional when command-surface, validation, or release-gate behavior changes; `docpact` should either require a matching source-doc update or record explicit review evidence.
- Do not treat a merged repo PR here as workspace-delivery complete if the root repo still needs a submodule bump

## Workspace Integration

A merged PR in `tiangong-lca-cli` is repo-complete, not delivery-complete.

If the change must ship through the workspace:

1. merge the child PR into `tiangong-lca-cli`
2. update the `lca-workspace` submodule pointer deliberately
3. complete any later workspace-level validation that depends on the updated CLI snapshot

## Local Docpact Push Gate

Install the versioned local hook once per checkout:

```bash
./scripts/install-git-hooks.sh
```

The `pre-push` hook runs `scripts/docpact-gate.sh`, which delegates CLI lookup to `scripts/docpact` and performs strict config validation plus enforced lint before the push leaves the machine. It then runs `npm run prepush:gate` as the local test gate. The wrapper checks `DOCPACT_BIN`, Cargo install locations, Homebrew install locations, and then `PATH`, so local agent shells should not fail only because bare `docpact` is unavailable. The default comparison base is `origin/main`. Override it for unusual stacks with `DOCPACT_BASE_REF=<ref>` or `scripts/docpact-gate.sh --base <ref>`. The gate writes its detailed report to a temporary file so normal pushes do not create `.docpact/runs/` artifacts. The GitHub `quality-gate` workflow is manual-dispatch only; publish and tag workflows still run release gates before release actions.
