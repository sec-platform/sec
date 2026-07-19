---
schema: codex-development-work-package-v1
id: sm3-exit-closure-v8
tracking: issue-106
base: f173ffc55b21b2a3dad85f5f5aaaab3613f8d004
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v7
tasks:
  - id: durable-import-runtime-and-snapshot-hook-boundary
    owner: a0
    ownedPaths:
      - docs/03-MVP实施计划与路线图.md
      - docs/evidence/v0-4-semantic-mutation-exit-closure-2026-07-19.json
      - docs/work-packages/sm3-exit-closure-v8.md
      - scripts/install-git-hooks.ts
      - scripts/run-work-package-gate.ts
      - tests/unit/install-git-hooks.test.ts
      - tests/unit/work-package-gate-execution.test.ts
forbiddenPaths:
  - .github/workflows/
  - AGENTS.md
  - bun.lock
  - bunfig.toml
  - package.json
  - platform/
  - tests/e2e/
acceptance:
  - "The V7 residual-fast batch remains frozen at 351 pass, 1 skip, 3 fail; all three failures are localized to execution-snapshot tests whose git worktree add invoked the repository post-checkout dependency hook."
  - "The reproduced checkout completed but returned exit 1 because the installed hook launched bare bun from a PATH that could not resolve it, producing IMPORT-AUTHORITY-002 with uv_spawn bun."
  - "After hook isolation removed that first cause, the remaining deep snapshot fixture exposed Git for Windows Filename too long; snapshot Git commands therefore bind core.longpaths=true instead of relying on caller configuration."
  - "Managed hook generations replace each canonical Bun command with a shell-quoted process.execPath identity, and the generation digest therefore changes whenever the installed Bun executable identity changes."
  - "Tracked hook sources remain portable and authoritative; only the repository-common deployed generation contains the host-bound executable path."
  - "Internal execution-snapshot worktree creation explicitly uses core.hooksPath=/dev/null and core.longpaths=true, because snapshot custody and later gates own validation, checkout lifecycle hooks must not install dependencies or mutate the snapshot, and Windows checkout must not depend on caller Git configuration or parent-path depth."
  - "Focused tests prove the deployed hook bytes contain no bare Bun launch and all three previously failed snapshot cases pass without running product dependency hooks."
  - "No import allowlist weakening, ready-stamp bypass, dependency copy workaround, Playwright/browser execution, C, Rust, FFI, Worker, second builder, request expansion, or product capability claim is added."
tests:
  - "bun test tests/unit/install-git-hooks.test.ts tests/unit/work-package-gate-execution.test.ts --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=f173ffc55b21b2a3dad85f5f5aaaab3613f8d004 bun run imports:check"
  - "git diff --check"
---

# SM-3 Exit Closure V8

V7 的 residual-fast 精确批次暴露了最后一个独立环境耦合：Work Package gate 创建内部 detached worktree 时继承了仓库公共 `post-checkout` hook；已部署 hook 又以裸 `bun` 依赖调用方 `PATH`。因此 checkout 本身已经成功，却因 hook 内 `uv_spawn 'bun'` 返回失败，并触发一次不属于 snapshot materialization 的真实依赖准备。

V8 把两个所有权边界永久分开。开发者 Git 生命周期 hook 仍自动执行依赖准备与 import freeze，但安装器把 tracked portable command 投影成绑定当前 `process.execPath` 的 repository-common generation；Bun 路径或版本变化会产生新的 generation digest。Work Package gate 的内部 snapshot 则显式禁用 checkout hook，并固定启用 Git long-path materialization，因为它已有 frozen head/tree/worktree digest、durable owner、custody、后续 gate 与 cleanup 合同，不得再让全局 hook 产生隐式安装副作用，也不得让 Windows 父路径深度改变 checkout 结果。
