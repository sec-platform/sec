---
schema: codex-development-work-package-v1
id: imports-candidate-seal-v1
tracking: none
base: cb1442ae972d67b5c6fc782e52a614905b23a29b
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: imports-candidate-seal
    owner: a0
    ownedPaths:
      - .githooks/pre-push
      - AGENTS.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/imports-candidate-seal-v1.md
      - platform/dev-runner/import-organizer.ts
      - platform/dev-runner/dependency-bootstrap.ts
      - scripts/install-git-hooks.ts
      - tests/unit/dev-runner-dependency-bootstrap.test.ts
      - tests/unit/import-organizer-selection.test.ts
      - tests/unit/import-organizer-staged.test.ts
      - tests/unit/install-git-hooks.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - package.json
  - platform/compiler/
  - tests/e2e/
acceptance:
  - "Candidate normalization reads tsconfig, targets, and project source context from the complete Git index snapshot, never from unstaged source/config."
  - "Invalid changed-only bases fail once with IMPORT-AUTHORITY-003 and never expand into a full-repository scan."
  - "Pre-commit seals ordinary commits and pre-push recomputes the final candidate after rebase/squash; a drifted candidate is normalized into the index and stopped before remote execution."
  - "The tracked hook installer requires and installs the executable pre-push hook with the existing worktree-local authority rules."
  - "The change adds no Playwright execution, browser automation, C, Rust, FFI, Full, slow, or production sentinel run."
tests:
  - "bun test tests/unit/import-organizer-selection.test.ts tests/unit/import-organizer-staged.test.ts tests/unit/install-git-hooks.test.ts --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=3cdb1f87ed341aed8036147c80aa694ba65463d2 bun run imports:check"
  - "bun run docs:doctor"
  - "git diff --check"
---

# Imports Candidate Seal V1

现有 candidate freeze 已原子更新 index，但 context 仍可读取 unstaged tsconfig/项目源码；changed-only base 失败还会静默扩成全仓扫描；rebase/squash 后若没有新的 commit，pre-commit 也不会再次执行。这三处会把候选身份重新变成操作时序问题。

本包将完整 index materialize 为临时只读 context，target blob 继续直接读取 index object；pre-push 在远端交互前重算同一 freeze。Hosted selector 对 base 错误立即终止。由此本地支持路径固定为 `freeze(base,index) → commit → pre-push zero drift → hosted read-only check`。
