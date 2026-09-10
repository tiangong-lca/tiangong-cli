# Production OAuth Bundle Write Repair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore official Production OAuth owner-draft LifecycleModel writes and preserve actionable structured failures in CLI artifacts.

**Architecture:** Keep the existing least-privilege CLI → Edge → actor RPC data path. Repair the official client's runtime capability set atomically, and make the CLI save-draft report retain structured `CliError` fields without exposing raw non-JSON HTTP bodies.

**Tech Stack:** Node.js 24, TypeScript 7, Node test runner, Supabase OAuth/PostgREST, Docpact, workspace delivery controller.

---

### Task 1: Preserve structured LifecycleModel save failures

**Files:**

- Modify: `test/lifecyclemodel-save-draft-run.test.ts`
- Modify: `src/lib/lifecyclemodel-save-draft-run.ts`

1. Add a focused test that returns the Issue #304 JSON error from the mocked bundle endpoint and asserts the report plus `failures.jsonl` contain `message`, `code`, and `details`.
2. Add a companion assertion that an unstructured HTTP failure does not copy its raw response body into report details.
3. Run `node --import tsx --test test/lifecyclemodel-save-draft-run.test.ts`; verify RED because `code/details` are currently discarded.
4. Extend the report error type and `serializeError` so `CliError` retains `code` and structured application `details`, while the `REMOTE_REQUEST_FAILED` raw-text fallback remains message/code only.
5. Rerun the focused test and the existing bundle test; verify GREEN.
6. Commit the isolated CLI behavior change.

### Task 2: Add durable qualification guidance

**Files:**

- Modify: `docs/agents/live-case-testing.md`
- Modify: `docs/agents/repo-validation.md`
- Modify: `AGENTS.md`

1. Add a narrowly scoped maintainer qualification contract for owner-draft LifecycleModel bundle writes: explicit account authorization, disposable canonical fixture, create/read/update/read/cleanup, exact owner/state/payload checks, and fixed redacted evidence.
2. State that the official Production client must retain `CLI-RPC-01`, `DB-CORE-READ-01`, `DB-CORE-WRITE-01`, `NX-CORE-02`, and `EDGE-BUNDLE-01`, with environment identity and before/after evidence kept out of checked-in files.
3. Run Docpact lint on the worktree diff and correct any governed-document findings.
4. Commit the qualification contract.

### Task 3: Repair the Production client grant

**Files:**

- Implemented in the owning `database-engine` repository as an idempotent migration and upgrade regression; the CLI repository records only the cross-repository contract and validation evidence.

1. Revalidate the official client identity from `OFFICIAL_PRODUCTION_PROFILE` and the current capability evidence from CLI #266.
2. In the migration, acquire and verify the exact client row and current grants under a lock that serializes competing registry changes.
3. Fail closed unless the client kind, enabled state, and exact before-state match the durable evidence.
4. Have the migration call `api.svc_oauth_client_configure` with the complete before-state plus only `EDGE-BUNDLE-01`.
5. Merge the database PR so deployment applies the migration; do not run manual Production SQL.
6. Verify exact after-state and one audit delta; record only capability names, timestamp, fixed result, and redacted evidence location in Issue #304.

### Task 4: Run Production create/update smoke

**Files:**

- No public fixture files; use a private, user-authorized disposable case directory outside Git.

1. Use the existing official OAuth session boundary and a disposable canonical LifecycleModel fixture.
2. Prove create, exact owner/state/payload readback, update, and exact readback.
3. Perform authorized cleanup and verify exact absence; never retry an ambiguous mutation.
4. Record only redacted fixed outcomes in Issue #304.

### Task 5: Validate and submit

**Files:**

- Review the complete branch diff.

1. Run focused tests, `pnpm prepush:gate`, and strict Docpact lint.
2. Confirm the worktree is clean except intended commits and contains no private artifacts.
3. Update Issue #304 with validation and Production evidence through `scripts/workspace-ops task update`.
4. Push `feature/issue-304` and submit the PR to `main` through the controller.
5. Leave workspace integration pending until the child PR is reviewed, merged, and finished through the returned continuation.
