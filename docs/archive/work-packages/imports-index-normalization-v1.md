---
schema: codex-development-work-package-v1
id: imports-index-normalization-v1
tracking: none
base: "7f8cbddaf798e5b0738f162adb0a635d5b6fef4f"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: imports-index-normalization
    owner: ci-v7-writer
    ownedPaths:
      - .gitattributes
      - .githooks/pre-commit
      - AGENTS.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/imports-index-normalization-v1.md
      - package.json
      - platform/dev-runner.ts
      - platform/dev-runner/import-organizer.ts
      - scripts/install-git-hooks.ts
      - tests/integration/project-runtime.test.ts
      - tests/unit/import-organizer-staged.test.ts
      - tests/unit/install-git-hooks.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - frontend/
  - platform/compiler/
  - platform/orchestrator/
  - platform/policies/
  - platform/shared/ci-contract.ts
  - platform/shared/ci-evidence-contract.ts
  - platform/shared/ci-verification-plan.ts
  - scripts/ci-verification.ts
  - scripts/codex/
  - source/
  - tests/e2e/
acceptance:
  - "imports:staged selects exact ACMR TypeScript stage-zero ordinary blobs from the current Git index, including staged additions and rename targets, without changing the committed-diff selection used by imports:check."
  - "Every normalized blob is generated and hashed before acquiring the real index.lock; while holding that lock, the organizer revalidates the expected index, applies one NUL-delimited git update-index --index-info to a unique alternate index, and atomically publishes the completed index with every entry mode preserved."
  - "The staged organizer never rewrites working-tree files; full-stage, partial-stage, added, renamed, CRLF, symlink, external hardlink/symlink alias, and concurrent working-tree bytes remain unchanged, while concurrent Git writers are rejected by the real index lock rather than silently losing updates."
  - "The staged organizer preserves LF or CRLF, is idempotent, handles no-target commits as a no-op, and prevents the pre-commit false-green caused by base..HEAD selection before a commit exists."
  - "The tracked executable pre-commit hook invokes only imports:staged; hosted imports:check remains read-only and fail closed."
  - "hooks:install requires the current worktree to contain .githooks/pre-commit as a tracked 100755 index entry and an actual file, reads effective core.hooksPath, and audits non-sample hooks in the default hooks directory when unset."
  - "It adopts only unset, already managed, or missing configured authority, enables extensions.worktreeConfig, and writes core.hooksPath=.githooks only for the current worktree without changing shared core.hooksPath."
  - "A different existing hook authority remains unchanged; lifecycle conflict and CI/Gitless lifecycle are nonblocking no-ops, while explicit hooks:install fails closed."
  - "The package lifecycle adds no dependency, workflow, CI contract/evidence/policy, product, compiler, orchestrator, AppContainer, Playwright, C, or Rust change."
tests:
  - "bun test tests/unit/import-organizer-selection.test.ts tests/unit/import-organizer-staged.test.ts tests/unit/install-git-hooks.test.ts --timeout 180000"
  - "bun test tests/integration/project-runtime.test.ts --test-name-pattern 'root package exposes budget and contract scripts' --timeout 180000"
  - "bun test tests/unit/codex-work-package-contract.test.ts --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=7f8cbddaf798e5b0738f162adb0a635d5b6fef4f bun run imports:check"
  - "bun run docs:doctor"
  - "CI=true bun install --frozen-lockfile"
  - "git diff --check"
---

# Imports Index Normalization V1

`imports:check` 的 changed-only selector 绑定 committed `base..HEAD`。在 commit 产生前调用它会合法地得到空选择，因此 #118 与 #119 都出现了 `No TypeScript import targets selected` 的本地假绿，直到 exact-head Gate 才发现未整理 imports。该 selector 是 hosted verification contract，不能改成读取可变工作树或 index。

本包新增独立提交边界：tracked `pre-commit` hook 对当前 index 的 ACMR TypeScript entries 执行 `imports:staged`。实现只读取 stage-zero ordinary blob，复用现有 TypeScript organizer，并先生成全部 normalized objects。随后它独占真实 `index.lock`、持锁复核原 index，把一个唯一 alternate index 作为 `GIT_INDEX_FILE` 执行一次 `git update-index -z --index-info`，再将完整字节写入所拥有的 lock 并以 rename 原子发布。整个路径只更新 index，从不改写 working tree；full-stage、partial-stage、added、rename、CRLF、symlink 与并发 working bytes 均保持不变。

Hook installer 先验证当前 worktree 的 `.githooks/pre-commit` 同时是 index mode `100755` 的 tracked entry 与实际文件，再读取 effective `core.hooksPath`；unset 时还审计 `git rev-parse --git-path hooks`，任何非 sample 的真实 hook 都视为既有 authority。Unset、已由当前 worktree 管理或配置目标已不存在时可安全接管：先启用 `extensions.worktreeConfig`，再只写 `git config --worktree core.hooksPath .githooks`，不会改写 common/shared `core.hooksPath`。不同且存在的 authority 保持原状并要求人工集成。`postinstall` 使用 lifecycle 模式避免在 authority conflict、missing/non-executable managed hook、CI 或 Gitless 环境阻断依赖安装；显式 `hooks:install` 仍 fail closed。本包不修改 hosted workflow、verification revision 或产品行为。
