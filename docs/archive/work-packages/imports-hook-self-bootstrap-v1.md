---
schema: codex-development-work-package-v1
id: imports-hook-self-bootstrap-v1
tracking: none
base: cf2b5f2f5ab1e369a954f8d30360b6ea0c4eae01
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: imports-hook-self-bootstrap
    owner: a0
    ownedPaths:
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/imports-hook-self-bootstrap-v1.md
      - scripts/install-git-hooks.ts
      - tests/unit/install-git-hooks.test.ts
forbiddenPaths:
  - .github/workflows/
  - docs/evidence/
  - package.json
  - platform/dev-runner.ts
  - platform/shared/project-runtime.ts
  - tests/e2e/
acceptance:
  - "The common generation projects the single compiler dependency generation immediately before the unique imports:freeze command in pre-commit and pre-push."
  - "The existing static bootstrap closure remains limited to Bun/Node built-ins and delegates to the sole manifest-bound dependency builder."
  - "Tracked hook blobs remain unchanged and index-identical; lifecycle hooks deploy byte-for-byte, candidate projection is content-addressed and validates exactly one canonical freeze command."
  - "The v2 generation recognizes and migrates v1 authority without changing any custom common, worktree, or default hook authority."
  - "Projection copies no dependency identity, install locking, staging, publication, rollback, import selection, or index transaction logic."
  - "Bun remains pinned to 1.3.14 and ambient auto-install stays disabled; the change adds no dependency, Playwright execution, browser automation, C, Rust, FFI, slow gate, or production sentinel."
tests:
  - "bun test tests/unit/install-git-hooks.test.ts tests/unit/worktree-dependency-bootstrap.test.ts tests/unit/dev-runner-dependency-bootstrap.test.ts --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=0 bun run imports:check"
  - "bun run docs:doctor"
  - "git diff --check"
---

# Imports Hook Self Bootstrap V1

Repository-common hook generation 使当前 managed hooks 能在任意 checkout 被发现，也因此暴露旧 worktree 的真实前置条件：`pre-commit` / `pre-push` 若直接加载 `imports:freeze`，可能在 compiler dependencies 尚未生成时先发生第三方静态 import 失败。

本包不修改 tracked `.githooks`，而由 common-generation materializer 在验证 source blob 与 index 完全一致后，为 `pre-commit` / `pre-push` 的唯一 canonical `imports:freeze` 调用投影一个前置 `platform/dev-runner.ts deps:ensure`。该入口已有递归静态 import 闭包合同，在 generation 完成前只依赖 Bun/Node built-in，并继续委托唯一 `ensureCompilerDepsReady`；随后仍只有一个 `imports:freeze` 负责完整 index transaction。V2 generation digest 绑定最终部署字节并迁移 v1 authority，不修改 custom hook authority。
