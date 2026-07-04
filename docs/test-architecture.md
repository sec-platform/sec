---
title: 测试架构
status: active
last-reviewed: 2026-07-04
---

# Test architecture

This repository uses a minimal test architecture optimized for one source of truth, clear CI signal, and low long-term maintenance cost.

## Final model

The stable shape is:

- 4 entry flows: affected, fast, slow, full.
- 4 test layers: unit, contract, integration, e2e slow.
- 5 fact sources: test budget, test impact, CI contract, runtime dependencies, public schema near contract builders.
- 3 thin testkit primitives: `tests/testkit/contracts.ts`, `tests/testkit/cli.ts`, `tests/testkit/workspace.ts`.
- 0 new test libraries.

Tests should read like specifications. Test files write business invariants; execution details and repeated contract checks live in the thin testkit primitives; source-of-truth lists and public shapes live under `platform/shared`.

## Entry flows

Do not add near-synonym package scripts for new behavior. Put orchestration in the runner or CI layer.

| Flow | Command | Purpose | Slow | Playwright |
| --- | --- | --- | --- | --- |
| affected | `bun run check:affected` | Daily changed + affected fast feedback | No | No |
| fast | `bun run check:fast` | Pre-commit full fast tests | No | No |
| slow | `bun run test:slow -- --suite <id>` | Targeted file-granular slow suite | Yes | Suite-dependent |
| full | `bun run check:full` | Release/scheduled full regression | Yes | Yes |

Do not reintroduce `test:changed`, `test:all`, `test:quick`, `test:ci`, `test:smoke`, `check:lite`, `check:pr`, `test:runtime-full`, or `test:workspace`.

## Test layers

| Layer | Responsibility | Allowed | Forbidden |
| --- | --- | --- | --- |
| `tests/unit` | Pure logic, selectors, formatters, registries, path/security boundaries | No I/O or light mocks | Workspace pipeline, CLI/browser execution |
| `tests/contract` | Public CLI/JSON/package/CI/error/runtime manifest protocol | Shape parsing and business invariants | Full command arrays, full script objects, slow suite list copies |
| `tests/integration` | Workspace pipeline, runtime service, orchestrator, artifact flow | Real temp/cached workspace behavior | Large UI/browser matrices |
| `tests/e2e` | Slow product paths and the single browser smoke boundary | Explicit slow suites | Becoming the business test matrix |

## Fact sources

1. `platform/shared/test-budget-contract.ts` owns test globs, fast/slow classification, file-granular slow suite definitions, suite IDs, test budget contract, and formatter.
2. `platform/shared/test-impact-contract.ts` owns changed-source to affected-fast and affected-slow selection. Prefer auto-reference import graph coverage; semantic rules are only for cross-domain product risk.
3. `platform/shared/ci-contract.ts` owns CI lane shape. Tests assert lane boundaries and coverage invariants, not copied workflow command lists.
4. `platform/shared/runtime-dependency-spec.ts` owns generated runtime dependencies and devDependencies, including whether Playwright belongs to runtime full validation.
5. Public schema belongs next to production contract builders, for example `platform/shared/*-schema.ts`. Use zod only at public JSON/CLI/artifact boundaries, not for every internal TypeScript object.

Rules:

- Tests must not copy slow suite IDs, slow test globs, slow suite counts, complete CI command arrays, complete package script objects, or public contract shapes.
- Use `slowTestSuiteIds()` / `getSlowTestSuitesSync()` rather than hand-written suite lists.
- Keep slow suites file-granular unless files need shared setup, ordering, or diagnostics.
- Import-graph-expressible impact should not be duplicated as semantic owner rules.
- Contract tests verify parseability/serializability and business boundaries: count equals list length, lists are sorted unique, fast lanes exclude slow/full work, full lanes cover correctness backstops.

## Testkit primitives

Start and stay with these three files unless a fourth primitive clearly replaces at least three duplicated call sites, deletes more test code than it adds, or collapses one public contract rule into a single reusable invariant.

### `tests/testkit/contracts.ts`

Contract invariant helpers only.

Allowed examples:

- `expectListCount(contract, 'slowTestFileCount', 'slowTestFiles')`
- `expectSortedUnique(contract.slowTestFiles)`
- `expectTestBudgetSelfConsistent(contract)`
- `expectPrFastLaneBoundary(contract)`
- `expectFullLaneCoversSlowSuites(contract, slowTestSuiteIds())`
- `expectPackageSurfaceMinimal(packageJson)`

Forbidden: spawning CLI, creating workspaces, Playwright, filesystem-heavy flows, and business fixtures.

### `tests/testkit/cli.ts`

CLI text / JSON / compact JSON behavior only. CLI launch, stderr normalization, compact JSON parsing, exit code, and workspace cwd should be defined once here.

### `tests/testkit/workspace.ts`

Workspace scenario behavior only. Workspace creation, cleanup, template cache, resolve/compose/adapt/verify, artifact paths, and report parsing should be defined once here.

## Playwright boundary

Keep Playwright, but only as the generated runtime full browser smoke. It must not enter affected or fast lanes, and it must not become a broad business E2E matrix.

The browser smoke proves:

- the generated Next app starts,
- the login path works,
- one key page opens,
- one tenant-isolation path can be exercised through the browser.

Business logic belongs in unit, contract, integration, or API tests.

## Dependency policy

The test stack is fixed unless there is a new explicit architectural decision:

- Runner: Bun test.
- Mocking: `bun:test` / `mock.module`.
- Schema: zod only for public boundaries.
- Import graph: ts-morph.
- Browser smoke: Playwright single smoke.
- Snapshots: Bun built-in only for stable protocol JSON.

Do not add Vitest, Jest, Sinon, fast-check, Testing Library, happy-dom, execa, mock-fs, memfs, or extra golden/snapshot libraries to solve structure problems.

## Migration order

1. Add `tests/testkit/contracts.ts`; migrate `ci-lanes` and `benchmark-budget` contract tests to invariant helpers without changing production behavior, CI, or package scripts.
2. Split any remaining god contract tests into small contract-family files with 2-5 semantic tests each.
3. Add `tests/testkit/cli.ts`; migrate repeated text/JSON/compact JSON CLI assertions.
4. Add `tests/testkit/workspace.ts`; migrate repeated workspace scenario setup and pipeline assertions.
5. Slim `test-impact-contract.ts` by proving auto-reference coverage before deleting duplicate semantic owner rules.
6. Freeze Playwright as one runtime browser smoke and prevent expansion into fast/affected lanes.

## Acceptance checks

The target state is satisfied when:

1. No old `test:changed` / `test:all` / `check:changed` aliases remain.
2. No god `contracts.test.ts` remains.
3. `tests/testkit` starts with only `contracts.ts`, `cli.ts`, and `workspace.ts`.
4. Tests do not copy slow suite IDs or complete slow suite lists.
5. Contract tests do not copy complete CI command arrays or complete package script objects.
6. Contract tests assert public shape plus invariants.
7. Workspace tests write scenarios rather than repeated pipelines.
8. CLI tests do not reimplement text/JSON/compact JSON runners.
9. Playwright is only runtime browser smoke.
10. zod schemas only guard public JSON/CLI/artifact boundaries.
11. Affected selection prefers auto-reference, with semantic rules only for cross-domain risk.
12. New tests reuse contract builders, registries, selectors, or testkit primitives.
13. Changing one fact source does not require synchronizing three copied expectations.
