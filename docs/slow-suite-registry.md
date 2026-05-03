# Slow suite registry

Slow e2e tests are valuable full-validation coverage. They are not PR fast-lane defaults.

The slow lane uses a suite registry instead of ad hoc filename filtering. Each suite has a stable id, owner, timeout budget, and file list derived from the discovered slow test files.

## Commands

```text
bun run test:slow
  Run every slow e2e file.

bun run test:slow -- --suite upgrade
  Run only the upgrade slow suite.

bun run test:slow -- --suite runtime
  Run only the runtime slow suite.

bun run test:slow -- --suite not-a-suite
  Fail fast and print available suite ids.
```

Unknown suite ids must never silently fall back to the full slow suite.

## Current suite model

```text
upgrade:
  owner: platform/compiler/upgrade
  examples: upgrade, dry-run-plan

runtime:
  owner: platform/shared/runtime-dependencies
  examples: runtime-host, verification

pipeline:
  owner: platform/compiler/pipeline
  examples: pipeline, end-to-end, expanded-blocks

repair:
  owner: platform/compiler/repair
  examples: repair

registry:
  owner: platform/registry
  examples: registry, private-registry

explain:
  owner: platform/compiler/explain
  examples: explain, provenance

other:
  owner: unmapped-slow-e2e
  purpose: safety bucket for newly added slow files that do not yet match a named suite
```

## Lane ownership

```text
PR fast lane:
  report affected slow files or suites as notices
  do not run slow e2e by default

Full/manual/scheduled lane:
  run slow suites for real
  may shard by suite id later
```

## Failure policy

Slow failures should be classified as either a real implementation regression or a stale expectation after an intended behavior change. Do not delete slow tests to make CI green. Update the assertion only when the new observable behavior is the intended contract.

## Relationship to fast tests

Slow tests reuse the fast-lane ideas of discovery, ownership, logs, and explicit selection. They do not reuse fast-lane skip semantics. The slow lane is allowed to be slower, but it must be controllable, diagnosable, and shardable.
