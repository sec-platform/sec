---
schema: codex-development-work-package-v1
id: imports-common-hook-generation-v1
tracking: none
base: ebb78c6cf2c0e3f13d9fcdad7fa9cf684e2f9349
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: imports-common-hook-generation
    owner: a0
    ownedPaths:
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/imports-common-hook-generation-v1.md
      - scripts/install-git-hooks.ts
      - tests/unit/install-git-hooks.test.ts
forbiddenPaths:
  - .github/workflows/
  - .githooks/
  - docs/evidence/
  - package.json
  - platform/shared/project-runtime.ts
  - tests/e2e/
acceptance:
  - "Managed hooks are materialized as an index-identical, executable, content-addressed generation inside the repository-common Git directory before common core.hooksPath changes."
  - "A linked worktree created from an older checkout with no tracked .githooks still runs the managed post-checkout hook during its first checkout."
  - "Legacy relative .githooks, stale missing paths, and prior managed generations migrate; any real custom common, worktree, or default hook authority remains unchanged and fails closed."
  - "The common generation is only a deployment snapshot of the tracked hooks; deps:ensure remains the single manifest-bound dependency builder with no second bootstrap or request schema."
  - "Bun remains pinned to 1.3.14 and ambient auto-install stays disabled; the change adds no dependency, Playwright execution, browser automation, C, Rust, FFI, slow gate, or production sentinel."
tests:
  - "bun test tests/unit/install-git-hooks.test.ts tests/unit/worktree-dependency-bootstrap.test.ts tests/unit/dev-runner-dependency-bootstrap.test.ts --timeout 180000"
  - "bun test tests/integration/project-runtime.test.ts --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=0 bun run imports:check"
  - "bun run docs:doctor"
  - "git diff --check"
---

# Imports Common Hook Generation V1

真实仓库 canary 证明，仅把 `core.hooksPath=.githooks` 写入 common config 仍依赖发起 `git worktree add` 的 checkout。当发起方停留在较旧现场且没有当前 `.githooks/post-checkout` 时，Git 在新工作树获得自己的 hook authority 之前已经完成首次 hook 查找，dependency generation 因而没有运行。

本包把 tracked `.githooks` 作为唯一源码：installer 先验证每个 hook 的 tracked `100755` mode、工作树文件和 index blob identity，再按名称与原始字节计算 generation digest，在 Git common dir 中写入并验证完整 generation，最后才更新 repository-common `core.hooksPath`。Generation 不依赖任何可删除的 worktree，旧 checkout 发起的新 worktree 也能在首次 checkout 运行 `post-checkout`。

自定义 hook authority 继续 fail closed。已有 relative `.githooks` 是明确的 managed legacy setting，可无损迁移；缺失路径可以接管；common generation 不复制 dependency identity、安装锁、staging、发布或回滚逻辑，所有 hook 仍调用唯一 `platform/dev-runner.ts deps:ensure`。
