---
schema: codex-development-work-package-v1
id: imports-authority-closure-v2
tracking: none
base: 3cdb1f87ed341aed8036147c80aa694ba65463d2
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: imports-authority-closure
    owner: a0
    ownedPaths:
      - AGENTS.md
      - docs/work-packages/imports-authority-closure-v2.md
      - tests/unit/install-git-hooks.test.ts
forbiddenPaths:
  - .github/workflows/
  - .githooks/
  - bun.lock
  - bunfig.toml
  - package.json
  - platform/
acceptance:
  - "The repository agent contract names imports:freeze as the only pre-commit import boundary."
  - "Ordinary commits and rebase/squash candidates derive the complete base-to-index scope automatically; SEC_CHANGED_BASE remains an exact verification input, not an operator requirement."
  - "A focused structure test prevents the tracked hook and repository authority from drifting back to imports:staged."
  - "The change adds no dependency, Bun upgrade, Playwright execution, browser automation, C, Rust, FFI, Full, slow, or production sentinel run."
tests:
  - "bun test tests/unit/install-git-hooks.test.ts --timeout 180000"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=3cdb1f87ed341aed8036147c80aa694ba65463d2 bun run imports:check"
  - "bun run docs:doctor"
  - "git diff --check"
---

# Imports Authority Closure V2

`main@3cdb1f8` 已把依赖解析、candidate normalization、index 原子发布与 hosted read-only Gate 闭合，但仓库级 Agent operating contract 仍描述旧的 staged-only 路径和人工 `SEC_CHANGED_BASE` 记忆步骤。实现与操作 authority 的分叉会继续诱导重复命令、假绿判断和无效诊断。

本包只闭合 authority seam：`AGENTS.md` 与 tracked hook 统一以 `imports:freeze` 为唯一提交边界；普通提交自动解析 merge-base，verification 的 exact base 只作为可验证输入。focused structure test 同时绑定两侧，后续任一侧回退都会在本地快速失败。
