---
title: CLI Runtime Distribution Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-cli
language: en
whenToUse:
  - when describing an installed CLI or implementing the component manager and bootstrap
whenToUpdate:
  - when runtime descriptors, manifests, host admission, cache or bootstrap contracts change
checkPaths:
  - src/runtime.ts
  - src/lib/runtime/**
  - src/main.ts
  - assets/runtime/**
  - scripts/bootstrap/**
  - test/runtime-*.test.ts
  - package.json
lastReviewedAt: 2026-09-05
lastReviewedCommit: c99a6dcee1ccf8cd2fc78129d16ee719e19d7512
lastReviewedNote: 'Introduced for #274; describes implemented package inspection and the remaining manager/bootstrap release gates.'
related:
  - docs/agents/repo-architecture.md
  - docs/agents/repo-validation.md
  - docs/release-runbook.md
---

# Runtime distribution

The CLI owns generic component installation and runtime identity for workspace #980/W07. Foundry owns its task state, profiles and product compatibility manifest. Skills carry the CLI-owned minimal bootstrap and a product-selected immutable lock. The CLI package has no static Foundry dependency, and installation never grants data permissions.

## Current public inspection surface

`tiangong-lca runtime describe --json` and `@tiangong-lca/cli/runtime` describe the current built CLI package through the same implementation. The public library exports `describeCliRuntime`, `assertCliRuntimeMatches`, schema identifiers, supported platform tuples and types. The package root and private runtime subpaths remain closed. This API is introduced by #274 and requires its later C1 publication; released CLI 0.1.9 does not provide it.

Inspection creates no files, authenticates nowhere and makes no network request. Runtime commands bypass CWD `.env` loading. The CLI launcher rejects retired/unsupported OS/architecture tuples before loading user configuration. Source development describes its built distribution; installed execution needs no source tree or Git.

The descriptor schema is `tiangong-lca.cli-runtime-descriptor.v1`, published in `assets/runtime/cli-runtime-descriptor.schema.json`. It includes:

- exact package name/version, canonical root and package-manifest SHA-256;
- current Node version, canonical executable path, byte count and SHA-256;
- the OS/architecture tuple and shell-free executable plus launcher argv;
- the TIDAS schema root and asset inventory fingerprint;
- a sorted portable-path/size/SHA-256 inventory of `package.json`, `bin/**`, `dist/src/**` and `assets/**`, and its SHA-256.

Inventory identities hash compact UTF-8 `JSON.stringify` bytes in the declared field order. Paths in the inventory are package-relative and use `/`; machine-local roots and invocation paths are deliberately outside the content hash. Each file uses an open descriptor, bounded incremental hashing and before/after identity/size/modification checks. Descendant symlinks and non-regular files are rejected; a normal package-manager symlink at the package root is resolved once to its physical root. The inventory is bounded to 50,000 files and 2 GiB, with 512 MiB per file. Changed or incomplete observations fail instead of silently accepting cached metadata.

`assertCliRuntimeMatches` accepts a strict `tiangong-lca.cli-runtime-expectation.v1` from an **independent trusted release manifest**, then re-inspects the current installation and compares exact package version, platform, CLI content, Node version and Node content. Invalid expectations fail before package inspection. The returned observation is deeply immutable. Copying hashes out of the same untrusted observation does not establish release trust.

The descriptor's scope is `cli-package`. It does not attest transitive dependencies, a registry signature or the complete software component. The release-built component manifest must separately bind its frozen production dependency graph and every deployed file. The descriptor does not claim task authorization, data completion, OS minimum/ABI readiness or download qualification; the manager's host/manifest checks own those additional gates. Explicit Node 24.19+ within the stable Node 24 line and the four architecture tuples are the current package inspection admission boundaries.

## Manager and bootstrap gates still required by #274

`runtime ensure/status`, immutable manifest validation, bounded downloads/archive handling, installation locks, atomic publication, verified warm/offline cache reuse, leases and owned-cache-only prune are required before W07 is complete. This inspection API alone is not a runtime manager or a zero-setup installer.

The compatibility manifest must bind exact component versions, archive/content digests, frozen production-lock identity, asset/protocol fingerprints and distinct workspace read/write schema-feature support. Unsupported host/ABI, unknown schemas, untrusted alternate sources, unsafe archive paths/links and mutable versions fail before installation. Existing task attempts and workspaces are never rewritten or reset by runtime operations.

POSIX/PowerShell bootstrap scripts are generic C1 release assets and require no Node/pnpm. Their adjacent skill-delivered `bootstrap-lock.json` separately binds script bytes, bootstrap protocol and the already published product manifest URL/digest. C1 scripts must not embed an unpublished F1 digest. Neither task input nor an environment variable can replace the trust anchor. Rosetta selection requires actual Apple Silicon hardware proof and must select native arm64; Intel Mac, Windows arm64 and Linux musl do not receive a fallback.

Full release qualification requires all four supported CI hosts, no-global-Node/pnpm copied bootstrap cases, interruption/concurrency/corruption tests, exact 100% source coverage and an independently verified public C1 package. Foundry F1/component/cold-start qualification follows in its owning repository and the workspace integration task. No local routine registry publish or new credential fallback is introduced.
