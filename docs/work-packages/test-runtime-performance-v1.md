---
schema: codex-development-work-package-v1
id: test-runtime-performance-v1
tracking: none
base: 95baca1c622b8c6bd53b033ec004a5834013c88d
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: optimize-template-clone-concurrency
    owner: test-runtime-worker
    ownedPaths:
      - tests/testkit/workspace.ts
  - id: fix-shared-deps-lockfile-leak
    owner: runtime-deps-worker
    ownedPaths:
      - platform/shared/project-runtime.ts
forbiddenPaths:
  - bun.lock
  - package.json
  - platform/compiler/
  - platform/orchestrator/
  - platform/shared/ci-contract.ts
  - platform/shared/contract-freeze-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/ci-verification-revision.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/merge-gate.ts
  - tests/e2e/
acceptance:
  - "cloneWorkspaceTemplate no longer holds the template creation lock during copy; concurrent clones of the same kind proceed in parallel because the template is immutable after ensureTemplate returns."
  - "afterAll deferred cleanup runs with bounded concurrency (4) instead of serial loop, preventing 120s timeout when many workspaces are created in one test file."
  - "Shared dependency materialization in .shared-deps/ does not create a bun.lock file, eliminating the sandbox-architecture contract violation."
  - "All focused contracts, typecheck, docs doctor, repository audit, imports and required hosted evidence pass on one single-parent candidate."
tests:
  - tests/integration/upgrade-pipeline-kernel.test.ts
  - tests/integration/workspace-engineering-ir.test.ts
  - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
  - tests/integration/pipeline-kernel.test.ts
  - tests/integration/ticket-pipeline.test.ts
  - tests/contract/ci-lanes.test.ts
  - tests/contract/sandbox-architecture-contract.test.ts
  - tests/contract/repository-audit.test.ts
---

# Test Runtime Performance v1

## 背景

PR #196 合并后，fast test suite 存在两个性能/合同问题：

1. **Template lock 串行化**：`cloneWorkspaceTemplate` 在 `copyWorkspaceFixture` 期间持有 template creation lock，导致所有同 kind 的 clone 操作串行化，使 `--concurrent --max-concurrency 4` 退化为串行。这是 fast tests 的最大性能瓶颈。

2. **Shared deps lockfile 泄漏**：`ensureSharedDepsReady` 在 `.shared-deps/` 运行 `bun install` 时未传 `--no-lockfile`，导致创建 `.shared-deps/bun.lock`，违反 sandbox-architecture 合同。

## 根因分析

### Template lock 串行化

`ensureTemplate` 使用 double-check + lock 正确保护模板创建。但 `cloneWorkspaceTemplate` 额外持有同一锁进行复制，这是不必要的：

- `templateCacheVersion` 是 hardcoded 常量，单次运行中 marker 一旦 ready 永不失效
- `createTemplate` 使用 staging + atomic rename，模板要么完整要么不存在
- `runtime-deps.setup.ts` 的清理逻辑显式跳过 `.templates` 目录
- 多进程并发 `fs.cp` 同一只读源到不同目标完全安全

### Shared deps lockfile 泄漏

`runBunInstall(sharedDepsRoot, options, ['install'], sharedCacheDir)` 调用 `bun install` 时，bun 默认创建 `bun.lock`。由于 `.shared-deps/` 是生成的、gitignored 的目录，lockfile 没有用途且违反合同。

## 修复

1. 移除 `cloneWorkspaceTemplate` 中的 `withTemplateLock` 包装，改为直接 `copyWorkspaceFixture`
2. `afterAll` 清理从串行循环改为 `Promise.all` + `createConcurrencyLimit(4)` 并行
3. `ensureSharedDepsReady` 的 `bun install` 添加 `--no-lockfile` 参数

## 退出

single-parent current-main candidate；focused/typecheck/docs/audit/imports/affected、Review 与 Full Evidence 闭合；merge 后从新 `main` readback 并归档本 manifest。
