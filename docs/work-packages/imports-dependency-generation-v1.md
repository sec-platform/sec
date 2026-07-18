---
schema: codex-development-work-package-v1
id: imports-dependency-generation-v1
tracking: none
base: cb1442ae972d67b5c6fc782e52a614905b23a29b
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: compiler-dependency-generation
    owner: a0
    ownedPaths:
      - docs/work-packages/imports-dependency-generation-v1.md
      - platform/shared/project-runtime.ts
      - tests/integration/project-runtime.test.ts
forbiddenPaths:
  - .github/workflows/
  - AGENTS.md
  - bun.lock
  - package.json
  - platform/compiler/
  - tests/e2e/
acceptance:
  - "Compiler dependency identity binds dependency maps, raw lockfile bytes, declared and actual Bun versions, OS, and architecture."
  - "Readiness verifies every direct package manifest plus the exact TypeScript and ts-morph runtime entry bytes before any external dev-runner module is loaded."
  - "A missing, corrupt, or mismatched tree is rebuilt in a same-volume staging generation and published only after complete validation; installation never mutates the active tree in place."
  - "Publish failure restores the previous active tree, and successful replacement retains one previous generation while removing older backups."
  - "The change preserves the existing candidate freeze and adds no Bun upgrade, Playwright execution, browser automation, C, Rust, FFI, Full, slow, or production sentinel run."
tests:
  - "bun test tests/integration/project-runtime.test.ts tests/unit/dev-runner-dependency-bootstrap.test.ts tests/unit/import-organizer-selection.test.ts tests/unit/import-organizer-staged.test.ts tests/unit/install-git-hooks.test.ts --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=3cdb1f87ed341aed8036147c80aa694ba65463d2 bun run imports:check"
  - "bun run docs:doctor"
  - "git diff --check"
---

# Imports Dependency Generation V1

Import Toolchain Closure V1 已关闭 ambient auto-install、编译器版本漂移和 candidate 选择缺口，但 compiler dependency ready check 仍只确认 binding digest 与顶层 `package.json` 存在。半安装、包清单损坏、critical runtime entry 被外部改写或不同 Bun runtime 复用同一树时，错误仍可能延迟到 typecheck/test/import organizer 中途出现。

本包把 compiler dependencies 提升为可验证 generation。identity 同时绑定 root dependency maps、lockfile 原始字节、声明/实际 Bun 版本与平台；staging 完整安装后验证所有 direct package manifest，并对 TypeScript、ts-morph 的 main entry 记录内容摘要。发布只使用同卷 rename，失败时恢复旧树；dev-runner 的“先 bootstrap、后动态加载外部模块”和现有 candidate freeze 均保持不变。
