# Test feedback and CI lane principles

This document is the source of truth for local test feedback, PR quick validation, PR risk validation, release/full validation, package script boundaries, and test contract ownership.

## Goals

Local development should give fast feedback after a small edit without requiring developers to understand every package script or internal runner command. Pull requests should report useful failures quickly, avoid unrelated slow coverage in the first response, and keep logs mapped to a specific gate. Release/full validation should remain complete and preserve final correctness.

The target model is:

```text
local development:
  edit code -> fast feedback
  affected tests selected automatically
  imports organized without manual cleanup

PR / GitHub Actions:
  small changes receive quick feedback
  stale runs yield to newer commits
  import organization is automatic
  slow e2e and unrelated full contracts do not block the quick lane
  risk-selected gates run after the quick lane
  failures identify the responsible gate

release/full validation:
  manual or scheduled lane runs Linux preflight, slow-suite matrix,
  full verify, reference drift, and benchmark contracts
```

## Lane model

### Local lane

Use local commands for tight feedback:

```text
bun run check:affected
bun run test:affected
bun run imports:organize
```

`test:affected` uses an affected-tests base. In CI this defaults to `HEAD^1`; locally it may fall back to the provided diff base. It must not require developers to manually enumerate test files. Local affected/fast validation does not require `imports:check` as a prerequisite; PR quick organizes changed imports remotely before running tests.

### PR quick lane

The PR quick lane is optimized for signal speed, not exhaustive coverage:

```text
PR quick lane:
  Ubuntu runner
  bun install --frozen-lockfile
  changed-only import organizer
  bun scripts/ci-pr-quick.ts
    typecheck
    test:affected
  latest-commit affected-tests selector
```

The PR quick lane must not run slow e2e by default. If a changed source maps only to slow coverage, the lane emits a notice and release/full validation owns the slow run.

The PR quick lane must not use broad fast-suite fallback unless explicitly requested with:

```text
PJC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1
```

Unmapped source changes should produce a clear notice instead of expanding into unrelated slow or broad validation.

### PR risk lane

The PR risk lane runs after the quick lane and owns broader PR-impact checks without becoming release/full validation:

```text
PR risk lane:
  Ubuntu runner
  bun install --frozen-lockfile
  bun scripts/ci-pr-risk.ts
    contract-freeze
    impact-selected slow suite or slow test files
    workspace-fast
```

The PR risk lane uses the PR-wide diff base for contract/workspace risk. It must not unconditionally run every slow suite or `verify --lane all`.

### Release/full lane

The release/full lane is the correctness backstop:

```text
release/full lane:
  Ubuntu runner
  preflight: imports organize, typecheck, test budget, contract-freeze
  slow-suite matrix: derive suite IDs from the slow-suite registry
  workspace: benchmark contract, deps warmup, resolve, compose, adapt,
             verify --lane all, lock, explain, reference check
  summary: fail if any preflight, slow-suite, or workspace job failed
```

Release/full validation runs through `workflow_dispatch`, schedule, or the PR `run-full` label. Slow suites run in a matrix for wall-clock speed while keeping stable suite ownership. See [slow-suite-registry.md](slow-suite-registry.md) for suite IDs and release/full lane sharding details.

## Diff base rules

Use separate diff bases for separate responsibilities:

```text
PJC_CHANGED_BASE:
  PR-wide base for contract-freeze and workspace risk selectors.
  This prevents early contract-impact commits from being lost.

PJC_AFFECTED_TESTS_BASE:
  latest-commit base for affected-tests feedback.
  This prevents a large PR diff from expanding every small follow-up commit into many unrelated tests.
```

Never use only `HEAD^1..HEAD` for contract/workspace risk. Never use the entire PR diff as the default affected-tests base.

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

Release/full lane behavior:

```text
always run full contract-freeze
```

When a new contract test file is added, it must also be added to the contract-freeze target list. The target count and target file list are intentional contract assertions.

## Test impact selection

`test-impact-contract.ts` selects affected tests in three layers. This avoids a central table that must hard-code every source file while still preserving explicit semantic ownership for cross-cutting features.

```text
1. Changed test files:
   run changed fast test files directly;
   changed slow tests produce a PR notice and are covered by release/full lanes.

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

Rules should be product contracts, not incidental implementation details. A missing mapping must not expand PR quick lane into unrelated broad or slow coverage. It should produce a notice and rely on release/full validation.

## Slow e2e rules

Slow e2e tests are valuable. They are not PR quick lane defaults.

Slow e2e failures should be triaged as either:

```text
real implementation regression -> fix implementation
stale expectation after intended behavior change -> update assertion to the new observable contract
```

Do not delete slow tests merely to make CI green. Do not move slow e2e into PR quick lane.

## Package script boundary

Package scripts are human entry points. They should stay small and memorable.

Recommended package script shape:

```json
{
  "platform": "bun ./platform/cli/index.ts",
  "dev": "bun ./platform/dev-runner.ts",
  "typecheck": "bun ./platform/dev-runner.ts typecheck",
  "test": "bun run test:fast",
  "test:affected": "bun ./platform/dev-runner.ts test:affected",
  "test:fast": "bun ./platform/dev-runner.ts test:fast",
  "test:slow": "bun ./platform/dev-runner.ts test:slow",
  "test:full": "bun ./platform/dev-runner.ts test",
  "check": "bun run check:fast",
  "check:affected": "bun run typecheck && bun run test:affected",
  "check:fast": "bun run typecheck && bun run test:fast",
  "check:full": "bun run typecheck && bun run test:full",
  "imports:organize": "bun ./platform/dev-runner.ts imports:organize",
  "imports:check": "bun ./platform/dev-runner.ts imports:check"
}
```

Avoid exposing every internal runner command in `package.json`. Complex orchestration belongs in `platform/dev-runner`, CI workflows, and docs.

## CI logging rules

Every gate must identify itself before running and report its duration:

```text
CI PR quick: typecheck started
CI PR quick: typecheck finished with exit code 0 in 1.23s
CI PR quick: affected-tests started
CI PR quick: affected-tests finished with exit code 0 in 0.78s
CI PR risk: contract-freeze started
CI PR risk: contract-freeze finished with exit code 0 in 4.56s
CI PR risk: workspace-fast started
CI PR risk: workspace-fast finished with exit code 0 in 2.34s
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

Recommended verification for CI/test lane work is remote-first:

```text
1. push the PR branch
2. inspect GitHub `compiler-validation` / PR checks
3. read failed remote logs before changing code
4. run local targeted repro only when remote logs are insufficient for root cause
```

Do not keep documentation pointers to deleted contract files; contract freeze targets are listed by `platform/shared/contract-freeze-contract.ts`.
