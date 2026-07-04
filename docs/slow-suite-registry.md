---
title: Slow Suite Registry
status: active
last-reviewed: 2026-07-04
---

# Slow suite registry

Slow e2e tests are valuable release/full validation coverage. They are not PR quick lane defaults.

The slow lane uses a suite registry instead of ad hoc filename filtering. Every `tests/e2e/**/*.test.ts` and `tests/e2e/**/*.spec.ts` file is slow by default. Each suite has a stable id, owner, timeout budget, and file list derived from the discovered slow test files.

Suites are file-granular by default. This keeps PR risk gates narrow and lets the release/full CI matrix parallelize slow e2e files at the highest useful shard level. Group files into one suite only when they must share setup, ordering, or diagnostics.

## Commands

```text
bun run test:slow
  Run every slow e2e file.

bun run test:slow -- --suite <suite-id>
  Run one suite from the suite registry.

bun run test:slow -- --suite not-a-suite
  Fail fast and print available suite ids.
```

Unknown suite ids must never silently fall back to the full slow suite.

## Suite fact source

`platform/shared/test-budget-contract.ts` owns suite IDs, owners, timeout budgets, and file membership. Inspect the current materialized suite model with:

```text
bun run platform -- test budget --json --compact
```

Docs, workflow YAML, and tests must not copy the suite ID list. They should call `slowTestSuiteIds()`, `getSlowTestSuitesSync()`, or assert against the materialized test budget contract.

## Lane ownership

```text
PR quick lane:
  report affected slow files or suites as notices
  do not run slow e2e by default

PR risk lane:
  run impact-selected slow suites or directly changed slow files

Release/full lane:
  run slow suites for real
  shard by suite id through the CI matrix
```

## Full lane sharding

Full validation runs slow e2e by suite id. The suite ID list is derived from `platform/shared/test-budget-contract.ts` through `slowTestSuiteIds()` rather than copied into CI YAML or tests.

```text
bun run test:slow -- --suite <suite-id>
```

The release/full CI matrix parallelizes those suite IDs for wall-clock speed while preserving diagnosability and stable ownership.

## Failure policy

Slow failures should be classified as either a real implementation regression or a stale expectation after an intended behavior change. Do not delete slow tests to make CI green. Update the assertion only when the new observable behavior is the intended contract.

## Relationship to fast tests

Slow tests reuse the fast-lane ideas of discovery, ownership, logs, and explicit selection. They do not reuse fast-lane skip semantics. The slow lane is allowed to be slower, but it must be controllable, diagnosable, and shardable.
