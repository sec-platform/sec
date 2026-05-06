# Test feedback and CI lane principles

This document is the source of truth for local test feedback, PR fast validation, full validation, package script boundaries, and test contract ownership.

## Goals

Local development should give fast feedback after a small edit without requiring developers to understand every package script or internal runner command. Pull requests should report useful failures quickly, avoid unrelated slow coverage, and keep logs mapped to a specific gate. Full validation should remain complete and preserve final correctness.

The target model is:

```text
local development:
  edit code -> fast feedback
  changed tests and affected tests selected automatically
  imports organized without manual cleanup

PR / GitHub Actions:
  small changes receive fast feedback
  stale runs yield to newer commits
  import organization is automatic
  slow e2e and unrelated full contracts do not block the fast lane
  failures identify the responsible gate

full validation:
  manual or scheduled lane keeps Windows, slow e2e, full contract-freeze,
  full verify, reference drift, and benchmark contracts
```

## Lane model

### Local lane

Use local commands for tight feedback:

```text
bun run check:changed
bun run test:changed
bun run imports:organize
bun run imports:check
```

`test:changed` uses a changed-tests base. In CI this defaults to `HEAD^1`; locally it may fall back to the provided changed base. It must not require developers to manually enumerate test files.

### PR fast lane

The PR fast lane is optimized for signal speed, not exhaustive coverage:

```text
PR fast lane:
  Ubuntu runner
  bun install --frozen-lockfile
  changed-only import organizer
  PR fast gate
  PR-wide contract/workspace selectors
  latest-commit changed-tests selector
```

The PR fast lane must not run slow e2e by default. If a changed source maps only to slow coverage, the lane emits a notice and full/manual/scheduled validation owns the slow run.

The PR fast lane must not use broad fast-suite fallback unless explicitly requested with:

```text
PJC_CHANGED_TESTS_FULL_FAST_FALLBACK=1
```

Unmapped source changes should produce a clear notice instead of expanding into unrelated slow or broad validation.

### Full lane

The full lane is the correctness backstop:

```text
Full lane:
  Windows runner
  full typecheck
  full contract-freeze
  slow e2e by suite (upgrade, runtime, pipeline, repair, registry, explain, other)
  benchmark contract
  runtime dependency warmup when needed
  resolve / compose / adapt
  verify --lane all
  lock / explain
  reference check
```

Full lane runs through `workflow_dispatch` and schedule. Each slow suite runs as a separate step for diagnosability and stable ownership. See [slow-suite-registry.md](slow-suite-registry.md) for suite ids and full lane sharding details.

## Diff base rules

Use separate diff bases for separate responsibilities:

```text
PJC_CHANGED_BASE:
  PR-wide base for contract-freeze and workspace risk selectors.
  This prevents early contract-impact commits from being lost.

PJC_CHANGED_TESTS_BASE:
  latest-commit base for changed-tests feedback.
  This prevents a large PR diff from expanding every small follow-up commit into many unrelated tests.
```

Never use only `HEAD^1..HEAD` for contract/workspace risk. Never use the entire PR diff as the default changed-tests base.

## Contract-freeze rules

Contract-freeze protects external developer and automation contracts, not slow runtime behavior.

Examples of contract-impact surfaces:

```text
CLI command surface
package scripts
workflow command contract
README/docs developer protocols
error protocol
benchmark and test-budget contracts
contract-freeze target list
```

PR lane behavior:

```text
changed broad contract files -> full contract-freeze
changed narrow contract test -> targeted contract-freeze
no contract-impact files -> skip contract-freeze
```

Full lane behavior:

```text
always run full contract-freeze
```

When a new contract test file is added, it must also be added to the contract-freeze target list. The target count and target file list are intentional contract assertions.

## Test impact selection

`test-impact-contract.ts` selects affected tests in three layers. This avoids a central table that must hard-code every source file while still preserving explicit semantic ownership for cross-cutting features.

```text
1. Changed test files:
   run the changed fast test files directly;
   changed slow tests produce a PR notice and are covered by full/manual/scheduled lanes.

2. Automatic source references:
   scan test files for relative imports and literal repository paths that point at changed source files;
   run matching fast tests and report matching slow tests as notices.

3. Semantic impact rules:
   keep a small set of explicit rules only for cross-domain relationships that imports cannot express.
```

Good semantic rules:

```text
platform/shared/ci-contract.ts -> CI contract tests
platform/dev-runner/test-runner.ts -> project-runtime and test budget contracts
platform/compiler/upgrade/** -> upgrade integration tests plus slow upgrade notices
platform/compiler/verify/** -> verification unit/integration tests plus slow verification notices
```

Rules should be product contracts, not incidental implementation details. A missing mapping must not expand PR fast lane into unrelated broad or slow coverage. It should produce a notice and rely on full validation.

## Slow e2e rules

Slow e2e tests are valuable. They are not PR fast lane defaults.

Slow e2e failures should be triaged as either:

```text
real implementation regression -> fix implementation
stale expectation after intended behavior change -> update assertion to the new observable contract
```

Do not delete slow tests merely to make CI green. Do not move slow e2e into PR fast lane.

## Package script boundary

Package scripts are human entry points. They should stay small and memorable.

Recommended package script shape:

```json
{
  "platform": "bun ./platform/cli/index.ts",
  "dev": "bun ./platform/dev-runner.ts",
  "typecheck": "bun ./platform/dev-runner.ts typecheck",
  "test": "bun ./platform/dev-runner.ts test:fast",
  "test:changed": "bun ./platform/dev-runner.ts test:changed",
  "test:slow": "bun ./platform/dev-runner.ts test:slow",
  "test:all": "bun ./platform/dev-runner.ts test",
  "test:watch": "bun ./platform/dev-runner.ts test:fast --watch",
  "test:coverage": "bun ./platform/dev-runner.ts test --coverage",
  "check": "bun run check:fast",
  "check:fast": "bun run typecheck && bun run test",
  "check:changed": "bun run typecheck && bun run test:changed",
  "check:full": "bun run typecheck && bun run test:all",
  "imports:organize": "bun ./platform/dev-runner.ts imports:organize",
  "imports:check": "bun ./platform/dev-runner.ts imports:check"
}
```

Avoid exposing every internal runner command in `package.json`. Complex orchestration belongs in `platform/dev-runner`, CI workflows, and docs.

## CI logging rules

Every gate must identify itself before running and report its duration:

```text
CI PR gate: typecheck started
CI PR gate: typecheck finished with exit code 0 in 1.23s
CI PR gate: contract-freeze started
CI PR gate: contract-freeze finished with exit code 0 in 4.56s
CI PR gate: test:changed started
CI PR gate: test:changed finished with exit code 0 in 0.78s
CI PR gate: fast-workspace-gate started
CI PR gate: fast-workspace-gate finished with exit code 0 in 2.34s
```

GitHub Actions logs should group each gate with `::group::` / `::endgroup::`, so failures can be opened directly at the responsible gate. Failures should include gate id, exit code, duration, and selector reason when available.

## Large-change operating mode

For large file rewrites, prefer local patches instead of remote whole-file replacement through automation. The safe workflow is:

```text
1. generate a precise patch or replacement block
2. apply locally
3. run targeted local checks
4. push once
5. inspect CI logs
```

Recommended local checks for CI/test lane work:

```text
bun run typecheck
bun test tests/contract/contracts.test.ts --test-name-pattern "CLI exposes contract freeze target list as text and JSON contracts"
bun test tests/contract/ci-lanes.test.ts
bun test tests/integration/project-runtime.test.ts --test-name-pattern "fast test runner excludes slow files and skips runtime deps setup"
bun scripts/ci-pr-gate.ts
```
