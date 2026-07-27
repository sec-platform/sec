---
schema: codex-development-work-package-v1
id: imports-worktree-bootstrap-v1
tracking: none
base: 24123eedc8dc6b3e5a03b41813f899fee8ba3146
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: imports-worktree-bootstrap
    owner: a0
    ownedPaths:
      - docs/work-packages/imports-worktree-bootstrap-v1.md
      - scripts/install-git-hooks.ts
      - tests/unit/install-git-hooks.test.ts
      - tests/unit/worktree-dependency-bootstrap.test.ts
forbiddenPaths:
  - .github/workflows/
  - docs/evidence/
  - tests/e2e/
acceptance:
  - "Repository-common core.hooksPath makes tracked lifecycle hooks available before a new linked worktree finishes its first checkout."
  - "The first-checkout dependency bootstrap has no static runtime dependency on a preinstalled third-party package."
  - "The existing lifecycle bootstrap command reuses the single manifest-bound compiler dependency generation owner, including its install lock, validation, atomic publish, and rollback behavior."
  - "Missing or stale common/worktree hook settings migrate to the managed authority, while an existing custom hook authority remains unchanged and fails closed."
  - "Bun ambient auto-install remains disabled; the change adds no dependency, Playwright execution, browser automation, C, Rust, FFI, product capability, Full, slow, or production sentinel run."
tests:
  - "bun test tests/unit/install-git-hooks.test.ts tests/unit/worktree-dependency-bootstrap.test.ts tests/unit/dev-runner-dependency-bootstrap.test.ts --timeout 180000"
  - "bun test tests/integration/project-runtime.test.ts --timeout 180000"
  - "bun ./platform/dev-runner.ts deps:ensure"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=0 bun run imports:check"
  - "bun run docs:doctor"
  - "git diff --check"
---

# Imports Worktree Bootstrap V1

新 linked worktree 原先只能在首次命令执行后获得 worktree-local `core.hooksPath`，因此第一次 checkout 没有机会运行 dependency hook。与此同时，`bun test` 会先解析测试模块的静态 import，再执行 test preload；缺失依赖会在 preload 自愈前直接终止测试加载。

本包把 managed hook authority 写入 repository-common Git config，使后续 linked worktree 在首次 checkout 时继承 `.githooks`。既有 checkout、merge 与 rewrite hook 继续调用 `platform/dev-runner.ts deps:ensure`；新增静态闭包合同证明该入口在 dependency generation 完成前只加载 Bun/Node 内建模块，并继续委托唯一 `ensureCompilerDepsReady` generation owner，不复制安装、identity、锁、发布或回滚算法。

配置迁移只接管 unset、missing 或已 managed 的 authority。任何实际存在的自定义配置目录、worktree override 或默认非 sample hook 都保持原状并 fail closed。Bun 继续使用 `auto = "disable"`，因此不会把 import 失败退化为 ambient 自动安装。
