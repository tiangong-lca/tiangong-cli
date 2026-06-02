---
title: cli Architecture Notes
docType: guide
scope: repo
status: active
authoritative: false
owner: cli
language: en
whenToUse:
  - when you need a compact mental model of the CLI before editing command routing, helper modules, or release gates
  - when deciding which file family owns a behavior change
  - when launcher, session, review, publish, or artifact hotspots are mentioned without exact paths
whenToUpdate:
  - when major repo paths or command families change
  - when session or artifact architecture moves
  - when coverage or release gating becomes materially different
checkPaths:
  - docs/agents/repo-architecture.md
  - .docpact/config.yaml
  - package.json
  - bin/**
  - src/**
  - test/**
  - scripts/**
  - .githooks/pre-push
  - scripts/docpact
  - scripts/docpact-gate.sh
  - scripts/install-git-hooks.sh
lastReviewedAt: 2026-06-02
lastReviewedCommit: f9968a4f59ade568ddc97413501ceadade8bfb42
related:
  - ../../AGENTS.md
  - ../../.docpact/config.yaml
  - ./repo-validation.md
  - ../../README.md
  - ../../DEV_CN.md
---

## Repo Shape

This repo is organized around one stable launcher plus a library-style `src/lib/**` tree that implements command families and shared helpers.

## Stable Path Map

| Path group | Role |
| --- | --- |
| `bin/tiangong-lca.js` | stable launcher entrypoint exposed as the public `tiangong-lca` executable |
| `src/main.ts` | process entry, dotenv loading, stdout and stderr wiring |
| `src/cli.ts` | top-level command dispatch, parsing, and help routing |
| `src/lib/**` | command-family implementations plus shared auth, IO, artifact, and remote helpers |
| `test/**` | unit and launcher tests that back the coverage gate |
| `scripts/assert-full-coverage.ts` | strict coverage enforcement |
| `scripts/ci/**` | release-tag and package publication checks |

## Current Architectural Clusters

### Launcher and entry contract

The public `tiangong-lca` surface starts in:

- `bin/tiangong-lca.js`
- `src/main.ts`
- `src/cli.ts`

If a task changes help output, exit behavior, or how subcommands are registered, start here.

### Session and remote access layer

The CLI talks to remote services directly through helper modules such as:

- `src/lib/env.ts`
- `src/lib/dotenv.ts`
- `src/lib/user-api-key.ts`
- `src/lib/supabase-session.ts`
- `src/lib/supabase-client.ts`
- `src/lib/supabase-rest.ts`
- `src/lib/remote.ts`
- `src/lib/http.ts`

This is where the CLI-owned remote access contract lives.

### Workflow command families

The widest feature families currently live in:

- `src/lib/flow-*.ts`
- `src/lib/dataset-*.ts`
- `src/lib/*-qa.ts`
- `src/lib/process-*.ts`
- `src/lib/lifecyclemodel-*.ts`
- `src/lib/publish.ts`
- `src/lib/run.ts`

These files own the public CLI semantics for those workflows.

### Process maintenance and QA commands

Recent process maintenance commands extend the same native CLI layer instead of introducing a secondary orchestration surface:

- `src/lib/process-save-draft-run.ts`
- `src/lib/process-payload-validation.ts`
- `src/lib/process-scope-statistics.ts`
- `src/lib/process-dedup-review.ts`
- `src/lib/process-refresh-references.ts`
- `src/lib/process-verify-rows.ts`
- `src/lib/identity-preflight.ts`
- `src/lib/process-flow-build-plan.ts`
- `src/lib/process-qa.ts`
- `src/lib/runtime-rulesets.ts`

These modules share one contract:

- `src/cli.ts` owns subcommand registration, help, and exit semantics
- `process/flow identity-preflight` owns embedded/local candidate scan inputs, explicit hybrid-search remote candidate inputs, identity/fingerprint comparison, duplicate/manual-review decisions, and `identity-candidate-sources.json` provenance artifacts before any build-plan or generation step
- `process/flow build-plan` validates minimum authoring contracts and writes standard gate artifacts before downstream materialization or publish handoff; materialize now creates canonical `processDataSet` / `flowDataSet` wrappers from plan fields when no canonical payload is supplied
- `process save-draft` validates canonical payloads with `ProcessSchema` before remote writes
- `flow publish-version` and `process publish-build` validate canonical payloads with `FlowSchema` / `ProcessSchema` before publish planning or handoff artifacts proceed
- `publish run` writes a deterministic `verification-report.json` next to the final publish report so downstream automation can read blockers without parsing execution details
- `runtime-rulesets` maps CLI-local QA, dedup, and publish findings to stable methodology rule ids so Foundry and UI handoffs can consume one ruleset profile contract
- maintenance and QA commands still emit artifact-first local outputs and remain covered by the strict `src/**/*.ts` coverage gate

### Dataset and lifecyclemodel governance commands

Dataset-local governance now uses the same CLI-native command layer:

- `src/lib/dataset-validate.ts`
- `src/lib/dataset-references-rewrite.ts`
- `src/lib/dataset-local.ts`
- `src/lib/lifecyclemodel-save-draft-run.ts`
- `src/lib/lifecyclemodel-graph.ts`

These modules keep validation, reference rewrites, save-draft preparation, graph extraction, and local artifact reports inside the CLI instead of routing through skills or MCP transports.

### Artifact and filesystem behavior

Artifact materialization and local state handling cluster around:

- `src/lib/artifacts.ts`
- `src/lib/io.ts`
- `src/lib/state-lock.ts`

If a task changes output layout, locking, or local run roots, inspect these first.

### Repo-local validation and release gates

Repo-level maintenance gates are now split across:

- `.github/workflows/quality-gate.yml` for manual remote reproduction of the local gate
- `.github/workflows/ai-doc-lint.yml`
- `.github/workflows/tag-release-from-merge.yml`
- `.github/workflows/publish.yml`

Important constraints:

- `npm run prepush:gate` remains the authoritative local proof for code changes and runs from the local pre-push hook
- `ai-doc-lint` keeps the historical check identity, but its implementation should run `docpact`
- `docpact` enforces that command-surface and release-gate changes also refresh or review the governed source docs
- the merge-tag workflow is guarded so only the upstream repository can execute release tagging
- the publish workflow releases from `cli-v<package.json version>` and supports manual dispatch for existing-tag recovery/backfill

## Cross-Repo Boundaries

- `tiangong-lca-skills` wraps CLI commands but does not own the native command contract
- `tiangong-lca-mcp` owns MCP transports and tool exposure, not the CLI executable
- runtime API, schema, or product behavior still belong in their owning repos
- `lca-workspace` owns root delivery completion after a child PR merges

## Common Misreads

- a skill wrapper is not the source of truth for a missing command
- the CLI should not absorb MCP transport behavior
- a merged child PR does not finish workspace delivery

## Local Docpact Push Gate

This repository has a versioned local `pre-push` hook under `.githooks/pre-push` that delegates to `scripts/docpact-gate.sh` and then runs `npm run prepush:gate`. The gate resolves the CLI through `scripts/docpact`, so local agent shells do not need bare `docpact` on `PATH`. The hook is the local guard for docpact config validation, enforced doc-governance linting, and the CLI test gate; ordinary GitHub push tests are replaced by this local gate plus release-time gates.
