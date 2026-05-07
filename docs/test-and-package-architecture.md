# Test and package architecture

This document is the durable design record for the test architecture refactor and the package script surface. It captures the current production policy, the transitional decisions made in the test-speed PR, and the target steady state.

## Goals

The project optimizes for four engineering properties:

1. **Fast vibecoding feedback**: source edits should usually validate through affected fast tests, not full runtime e2e.
2. **Stable CI gates**: PR CI should block real regressions, not historical formatting debt or slow release-only tests.
3. **Explicit contracts**: external CLI/JSON/error/CI behavior is frozen through contract-derived invariants.
4. **Small public command surface**: `package.json` should expose daily commands only; internal maintenance commands belong in `platform` or `dev-runner`.

## Test architecture: final 4/4/5/3 design

`docs/test-architecture.md` is the authoritative compact model: 4 entry flows, 4 test layers, 5 fact sources, 3 thin testkit primitives, and 0 new test libraries. This document keeps the package-script policy and detailed migration context aligned to that model.

### 1. Contract-derived standards

Contract tests must not mirror the full output of the contract they test. They should derive expectations from the contract object and verify invariants.

Correct pattern:

```ts
const contract = buildContractFreezeContract();

expect(contract.targetFileCount).toBe(contract.targetFiles.length);
expect(contract.targetCount).toBe(contract.targets.length);
expect(contract.targetFiles).toEqual([...contract.targetFiles].sort((left, right) => left.localeCompare(right)));
expect(contract.targetFiles.some((file) => file.startsWith('tests/e2e/'))).toBe(false);
```

Avoid this pattern:

```ts
expect(contract.targetFileCount).toBe(7);
expect(contract.targetFiles).toEqual([
  'tests/contract/benchmark-budget.test.ts',
  // repeated source-of-truth list
]);
```

Exact numbers are allowed only for intentionally stable protocol values, for example:

- contract format versions
- fixed CLI command names
- fixed error code examples
- intentionally fixed artifact IDs

### 2. Affected test graph

`test:affected` should select tests through `platform/shared/test-impact-contract.ts` instead of falling back to the whole fast suite for every source edit.

The impact graph maps source ownership to fast and slow coverage:

```ts
{
  owner: 'upgrade',
  sourcePattern: /^platform\/compiler\/upgrade\//,
  fast: [
    'tests/unit/upgrade-summary.test.ts',
    'tests/integration/migration-files.test.ts'
  ],
  slow: [
    'tests/e2e/upgrade.slow.test.ts'
  ]
}
```

Rules:

- changed fast test files run directly
- changed slow test files produce a quick-lane notice and are selected by PR risk or release/full validation
- source changes run affected fast/integration tests
- affected slow tests are reported as PR risk or release/full follow-up, not silently pulled into PR quick feedback

### 3. Slow runner isolation

Slow e2e tests are not regular fast tests. They are isolated behind explicit commands:

```bash
bun run test:slow
bun run test:slow -- --suite upgrade
bun run test:slow -- --suite runtime
```

Slow tests are any tests under:

```text
tests/e2e/*.slow.test.ts
```

Slow tests may depend on:

- runtime dependency setup
- Next build
- Playwright
- large filesystem workspaces
- pipeline end-to-end state

They must not be included in `contract-freeze`.

### 4. Fixture and workspace cache policy

Test setup should use the lightest possible fixture level:

| Test type | Workspace policy |
|---|---|
| unit | no workspace |
| contract | temp workspace only when CLI output requires it |
| integration | cached/default workspace fixture when possible |
| slow e2e | real pipeline workspace |

Existing workspace template caching should remain an implementation detail behind helper APIs. Tests should prefer the three thin testkit primitives, for example `withTempWorkspace`, `prepareResolvedWorkspace`, `prepareComposedWorkspace`, or `prepareAdaptedWorkspace`, instead of manually recreating full pipelines.

### 5. Golden snapshot foundation

Golden snapshots are appropriate only for stable protocol JSON, not for runtime logs or volatile data.

Allowed golden targets:

- CI contract JSON
- error protocol JSON
- test budget JSON
- contract-freeze JSON
- artifact manifest JSON

Disallowed golden content:

- timestamps
- absolute paths
- random temp directories
- durations
- raw stdout with spinner/progress noise
- unsorted file lists

Golden helpers should normalize JSON recursively before comparison.

### 6. Workspace setup and semantic matchers

Tests should not repeatedly reimplement setup and object assertions. Prefer explicit testkit primitives:

```ts
const workspaceRoot = await prepareAdaptedWorkspace({ prefix: 'upgrade-' });
```

Semantic assertion helpers should replace brittle object mirroring:

```ts
expectNonEmptyArray(upgradePlan.impacts, 'upgrade impacts');
expectSortedUnique(contract.targetFiles);
expectNoPathPrefix(contract.targetFiles, 'tests/e2e/');
```

The goal is to reduce test code volume by moving repeated contract, CLI, and workspace execution patterns into the three thin `tests/testkit/*` primitives instead of growing a broad helper framework.

### 7. CI lanes

CI is split by purpose:

| Lane | Trigger | Purpose |
|---|---|---|
| PR quick | pull_request / push | typecheck plus affected fast feedback |
| PR risk | pull_request / push | contract-freeze, impact-selected slow coverage, and workspace fast verification |
| release/full | workflow_dispatch / schedule / `run-full` label | slow e2e matrix, full runtime, release confidence |
| maintenance | manual / bot | import organization and dependency hygiene |

PR quick gate should cover:

```text
install
changed-only remote import organization
typecheck
test:affected
```

PR risk gate should cover:

```text
contract-freeze
impact-selected test:slow suite or file
workspace-fast: resolve / compose / adapt / verify fast lane
```

Release/full gate should cover:

```text
preflight: imports organize, typecheck, test budget, contract-freeze
slow-suite matrix: derive suite IDs from the slow-suite registry
workspace: benchmark contract, verify --lane all, lock, explain, reference check
```

### 8. Flaky and timing governance

Slow/flaky candidates include tests that use:

- Next build
- Playwright
- shared dependency install
- large filesystem copy
- spinner stdout/stderr assertions
- concurrency locks
- runtime host verification

Timing policy:

| Lane | Target |
|---|---:|
| fast | under 5 seconds per test file |
| integration | under 30 seconds per test file |
| slow | explicit timeout, usually up to 180 seconds |

Slow e2e tests must use explicit timeouts so Bun's default timeout does not create false failures.

### 9. Hard standards for imports, lockfile, and workspace cleanliness

The target steady state is:

```text
bun install --frozen-lockfile
imports:check is non-mutating
imports:organize is the only command allowed to rewrite imports
CI can use git diff --exit-code after static checks once the formatting baseline is committed
```

During the transition, PR CI may run remote `imports:organize` and commit formatting changes back to the PR branch. That prevents historical import debt from blocking unrelated test architecture work.

### 10. Test code volume reduction

Repeated test boilerplate should be collapsed into the three testkit primitives:

- `tests/testkit/contracts.ts` for contract invariant checks
- `tests/testkit/cli.ts` for CLI text / JSON / compact JSON variants
- `tests/testkit/workspace.ts` for workspace scenario setup, artifact paths, and report parsing

A healthy target is that most contract/integration tests read as:

```ts
await expectCliContract(workspaceRoot, {
  command: ['repair', '--dry-run'],
  textIncludes: [...],
  jsonShape: {...},
  compactEqualsFull: true
});
```

instead of duplicating dozens of setup and assertion lines.

### 11. Package script surface cleanup

`package.json` is not the place for every internal workflow. It should expose a small public command surface. Internal contract, benchmark, architecture, dogfood, and diagnostic commands should live behind `platform` or `dev-runner`.

## Current package script state

The package surface exposes daily developer commands plus a small set of contract/demo/reference entry points that are exercised by docs or CI:

- `platform`
- `dev`
- `typecheck`
- `test`, `test:affected`, `test:fast`, `test:slow`, `test:full`
- `check`, `check:affected`, `check:fast`, `check:full`
- `demo:*`, `dogfood:*`, `reference:*`
- `test:budget`, `test:contract-freeze`, `test:benchmark-contract`, `reference:check`
- `imports:*`, `clean:test-workspaces`

Deprecated script aliases should be deleted rather than preserved unless they are external user-facing API.

## Target package script surface

The target public scripts are:

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
  "check:full": "bun run typecheck && bun run test:full"
}
```

Everything else should be called through explicit platform/dev-runner commands:

```bash
bun run platform -- test budget --json --compact
bun run platform -- benchmark suite --json --compact
bun run platform -- reference check --json --compact
bun ./platform/dev-runner.ts contract-freeze
bun ./platform/dev-runner.ts imports:check
bun ./platform/dev-runner.ts clean-test-workspaces
```

## Package script testing policy

Tests should not hardcode every package script string. They should verify only the public surface and critical commands.

Preferred pattern:

```ts
expect(Object.keys(scripts)).toEqual(expect.arrayContaining([
  'platform',
  'dev',
  'typecheck',
  'test',
  'test:affected',
  'test:fast',
  'test:slow',
  'test:full',
  'check',
  'check:affected',
  'check:fast',
  'check:full'
]));
```

Avoid this pattern:

```ts
expect(scripts['test:budget']).toBe('bun run platform -- test budget --json');
expect(scripts['test:benchmark-contract']).toBe('bun run platform -- benchmark suite --json');
```

Those are internal implementation details and should be validated by CLI/platform contract tests, not by package script tests.

## Remote import automation

PR CI currently performs remote import organization:

1. checkout the PR branch
2. run `bun run imports:organize`
3. if `git diff` is non-empty, commit as `github-actions[bot]`
4. push back to the PR branch
5. skip the rest of that stale run
6. let the new bot commit trigger a fresh validation run

This provides remote automatic formatting while avoiding repeated local manual formatting work.

When the repository has a clean import baseline, CI can be tightened back to:

```bash
bun run imports:check
git diff --exit-code
```

## Migration plan for package cleanup

1. Keep current scripts until the test architecture PR is stable and green.
2. Open a focused `package-scripts-cleanup` change.
3. Add `dev` and `format` aliases.
4. Move demo/dogfood/reference/architecture commands behind `platform` or `dev-runner`.
5. Rewrite package script tests to assert public surface only.
6. Update README command examples.
7. Remove transitional internal aliases from `package.json`.
8. Re-enable strict non-mutating imports check after the remote organizer has committed a clean baseline.
