---
schema: codex-development-work-package-v1
id: dev-loop-speed-v1
tracking: none
base: 6059d0664416944fa3b31d1bc5cb31af0a7e4417
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: optimize-test-parallelism
    owner: test-parallelism-worker
    ownedPaths:
      - platform/dev-runner/fast-test-policy.ts
      - platform/dev-runner/test-runner.ts
      - platform/dev-runner/test-concurrency-policy.ts
      - platform/dev-runner/command-runner.ts
      - tests/unit/fast-test-concurrency.test.ts
      - tests/unit/test-runner.test.ts
  - id: parallelize-check-fast-gates
    owner: check-gate-worker
    ownedPaths:
      - platform/dev-runner.ts
      - platform/dev-runner/check-runner.ts
      - package.json
      - tests/contract/dev-runner-contract.test.ts
  - id: add-docs-doctor-incremental
    owner: docs-doctor-worker
    ownedPaths:
      - docs/scripts/docs-doctor.ts
      - docs/scripts/docs-doctor-ledgers.ts
      - platform/shared/ci-verification-plan.ts
      - tests/contract/docs-doctor.test.ts
  - id: optimize-ci-cache-and-runner
    owner: ci-cache-worker
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/architecture-tools.yml
      - platform/shared/ci-contract.ts
      - tests/contract/ci-contract.test.ts
  - id: optimize-preload-and-postinstall
    owner: preload-worker
    ownedPaths:
      - tests/setup/runtime-deps.setup.ts
      - scripts/install-git-hooks.ts
forbiddenPaths:
  - bun.lock
  - scripts/codex/work-package-contract.ts
  - scripts/codex/parallel-work-package-contract.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/sec-merge-bootstrap.ts
  - scripts/ci-verification.ts
  - scripts/ci-pr-risk.ts
  - platform/compiler/
  - platform/orchestrator/
  - platform/shared/contract-freeze-contract.ts
  - platform/shared/ci-verification-revision.ts
  - platform/shared/affected-test-inventory.ts
  - platform/shared/test-impact-contract.ts
  - platform/shared/heavy-verification-gate-lease.ts
  - docs/work/active-work-package.md
  - docs/work/current-state.yaml
  - docs/work/rolling-plan.md
  - docs/work-packages/ci-speed-optimization-v1.md
  - tests/e2e/
acceptance:
  - "platform/dev-runner/fast-test-policy.ts exports resolveFastTestConcurrency() that returns concurrency derived from os.availableParallelism() instead of hardcoded constants 2 and 4."
  - "FAST_TEST_PROCESS_RESOURCE_SCHEDULING maps shared-host-runtime and repository-worktree to bounded-parallel (concurrency 2) instead of exclusive, so the 22 previously-serial isolated files now run in 4 bounded-parallel queues instead of 1 serial queue."
  - "runFastTests skips cleanTestWorkspaces when no test workspaces were created during the run, tracked by a createdWorkspaces counter incremented in createWorkspaceWithDeferredCleanup."
  - "platform/dev-runner.ts owns a check:fast command that runs imports:prepare and docs:doctor in parallel, then typecheck, then test:fast, reducing total wall time by the docs:doctor duration."
  - "package.json scripts.check:fast is 'bun ./platform/dev-runner.ts check:fast' instead of the serial npm && chain, and dev-runner-contract.test.ts asserts the new script."
  - "docs/scripts/docs-doctor.ts accepts --since <git-ref> to scan only documents changed since the ref, using git diff --name-only; full scan remains the default when --since is absent."
  - "platform/shared/ci-verification-plan.ts buildCiFullGatePlan conditionally includes docs-doctor only when documentation lifecycle paths or docs/ files changed, instead of always including it."
  - ".github/workflows/compiler-pr-validation.yml and compiler-release-validation.yml tsc cache key uses hashFiles of source files (platform/**/*.ts, tests/**/*.ts, scripts/**/*.ts, tsconfig.json, bun.lock) instead of the immutable head SHA, so similar PRs share cache."
  - ".github/workflows/architecture-tools.yml runs-on ubuntu-latest instead of windows-latest, since depcruise/jscpd/discover are platform-independent static analysis."
  - "tests/setup/runtime-deps.setup.ts gates cleanStaleWorkspaces behind a marker file (.tmp/test-workspaces/.last-cleanup) with a 5-minute TTL, so concurrent bun test processes do not repeat the readdir+stat sweep."
  - "All focused contracts, typecheck, docs doctor, repository audit pass on one single-parent candidate."
tests:
  - tests/unit/fast-test-concurrency.test.ts
  - tests/unit/sec-merge-bootstrap.test.ts
  - tests/unit/codex-work-package-contract.test.ts
  - tests/unit/parallel-work-package-contract.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/dev-runner-contract.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/contract/sandbox-architecture-contract.test.ts
---

# Development Loop Speed v1

## 背景

`ci-speed-optimization-v1`（PR #201）解决了 CI 缓存和合并流程自动化的部分瓶颈，但全工程速度审计发现 6 大环节约 30 个瓶颈仍存在：测试执行串行化、check:fast 4 gate 串行、docs:doctor 全量扫描、tsc cache key 绑定 immutable SHA、architecture-tools 用 windows runner、preload 每进程重复清理。本 Work Package 系统性消除本地开发反馈循环和 CI 中剩余的高影响瓶颈。

## 实现

### Slice 1 — 测试执行并行化

1. `fast-test-policy.ts`：将 `DEFAULT_CONCURRENT_FAST_SHARD_CONCURRENCY` 和 `DEFAULT_ISOLATED_FAST_TEST_CONCURRENCY` 改为 `resolveFastTestConcurrency()`，基于 `os.availableParallelism()` 返回 `max(2, available - 1)` 和 `max(4, available - 1)`。
2. `fast-test-policy.ts`：将 `FAST_TEST_PROCESS_RESOURCE_SCHEDULING` 中 `shared-host-runtime` 和 `repository-worktree` 从 `exclusive` 改为 `bounded-parallel`（concurrency 2），拆分 `exclusive` 队列为按 resourceClass 分组的 bounded-parallel 队列。
3. `test-runner.ts`：在 `fastTestWorkspaceEnv()` 旁维护 `createdWorkspaces` 计数器，仅当 `createdWorkspaces > 0` 时执行 `cleanTestWorkspaces`。
4. `test-concurrency-policy.ts`：将 `DEFAULT_FAST_TEST_MAX_CONCURRENCY` 改为基于 `os.availableParallelism()` 的动态值。

### Slice 2 — check:fast gate 并行化

1. `dev-runner.ts`：新增 `check:fast` 子命令，路由到 `check-runner.ts` 的 `runFastCheck`。
2. `check-runner.ts`：新增 `runFastCheck`，按依赖分阶段执行：Phase 1 并行 `imports:prepare` + `docs:doctor`；Phase 2 `typecheck`（依赖 imports:prepare）；Phase 3 `test:fast`（依赖 typecheck）。
3. `package.json`：`check:fast` 脚本改为 `bun ./platform/dev-runner.ts check:fast`。
4. `dev-runner-contract.test.ts`：更新 `check:fast` 断言为新脚本。

### Slice 3 — docs:doctor 增量模式

1. `docs-doctor.ts`：新增 `--since <git-ref>` 参数，用 `git diff --name-only <ref>..HEAD -- docs/` 只扫描变更文档；无 `--since` 时保持全量扫描。
2. `docs-doctor-ledgers.ts`：在 `scanDocumentation` 入口一次读取 `package.json` + `bun.lock`，传入后续扫描函数，避免重复读取。
3. `ci-verification-plan.ts`：`buildCiFullGatePlan` 的 `docs-doctor` gate 改为条件触发——仅当 `docs/` 路径或 documentation lifecycle 路径变更时包含。

### Slice 4 — CI cache 与 runner 优化

1. `compiler-pr-validation.yml` + `compiler-release-validation.yml`：tsc cache key 从 `${{ runner.os }}-tsc-${{ steps.verification.outputs.head }}` 改为 `${{ runner.os }}-tsc-${{ hashFiles('platform/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts', 'tsconfig.json', 'bun.lock') }}`，`restore-keys` 保留 OS 前缀 fallback。
2. `architecture-tools.yml`：`runs-on` 从 `windows-latest` 改为 `ubuntu-latest`。
3. `ci-contract.ts`：同步 STEP_ORDER 常量（如有步骤名变更）；`ci-contract.test.ts` 同步断言。

### Slice 5 — preload 与 postinstall 优化

1. `runtime-deps.setup.ts`：`cleanStaleWorkspaces` 改为 marker-file 门控（`.tmp/test-workspaces/.last-cleanup`，5 分钟 TTL），避免每个 bun test 进程重复 `readdir` + `stat` 扫描。保留 `SEC_SKIP_RUNTIME_DEPS_SETUP` 和 `ensureTestDependencies` 契约字符串。
2. `install-git-hooks.ts`：`installGitHooks` 入口加 marker file（`.githooks/.last-install`），内容为 `managedGenerationDigest`；marker 匹配且 `core.hooksPath` 正确时直接返回，跳过重复的 hook 快照校验。

## 退出

single-parent current-main candidate；focused/typecheck/docs/audit/imports/affected、Review 与 Full Evidence 闭合；merge 后从新 `main` readback。
