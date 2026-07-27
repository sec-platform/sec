---
schema: codex-development-work-package-v1
id: imports-candidate-freeze-v2
tracking: none
base: "c4984ff35bb4bcdd44e4b2062f79eec40e1965d6"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: imports-candidate-freeze
    owner: a0
    ownedPaths:
      - .githooks/pre-commit
      - AGENTS.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/imports-candidate-freeze-v2.md
      - platform/dev-runner.ts
      - platform/dev-runner/import-organizer.ts
      - platform/shared/ci-evidence-composition-policy-registry.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/import-organizer-staged.test.ts
      - tests/unit/install-git-hooks.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - package.json
  - frontend/
  - platform/compiler/
  - platform/orchestrator/
  - platform/policies/
  - platform/registry/
  - scripts/ci-verification.ts
  - scripts/codex/
  - source/
  - tests/e2e/
acceptance:
  - "Normal pre-commit behavior remains limited to exact ACMR TypeScript stage-zero ordinary blobs changed in the current index; no working-tree byte is rewritten."
  - "When A0 explicitly binds SEC_CHANGED_BASE to current main for the final amend, pre-commit invokes the same index-only organizer with that exact candidate base before Git freezes the commit tree."
  - "Candidate mode selects the complete base-to-index ACMR TypeScript diff, including paths replayed by rebase but absent from the current staged delta; the full base must be one exact commit object ID."
  - "Candidate and staged modes share one atomic index-lock publication path, revalidate the same selection before publish, preserve modes and unstaged bytes, and remain idempotent."
  - "Hook installation authority remains the existing tracked executable pre-commit path; existing external hook authority remains fail closed and untouched."
  - "The P0 V7 transition replaces only the two mechanically import-sorted candidate blobs: runtime plan b2e0cef5148d9411d1000e7a6ace9b82cb0cfe34 and child-fence test a77d1d23c5b75d751ef39c0b8a0e81909486136c; all other transition identities and evidence semantics remain unchanged."
  - "This trust-root bootstrap does not execute or self-authorize PR 113, production sentinel, Playwright, AppContainer, Full, or all-slow; PR 113 must rebase, retain one commit, and obtain one V7 Quick after this package enters main."
tests:
  - "bun test tests/unit/import-organizer-staged.test.ts tests/unit/install-git-hooks.test.ts --timeout 180000"
  - "bun test tests/unit/ci-evidence-composition-policy-registry.test.ts --timeout 180000"
  - "bun test tests/contract/sec-merge-gate.test.ts --test-name-pattern 'base-side V7 merge gate independently reconstructs' --timeout 180000"
  - "bun test tests/unit/codex-work-package-contract.test.ts --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=c4984ff35bb4bcdd44e4b2062f79eec40e1965d6 bun run imports:check"
  - "bun run docs:doctor"
  - "git diff --check"
---

# Imports Candidate Freeze V2

现有 staged-index normalization 正确保护了普通提交，但 rebase 由 Git sequencer 重放既有 commit 时不会经过普通 pre-commit authoring 边界；随后只 amend Work Package 的 A0 freeze 也只把 manifest 放进 staged delta。结果是历史 commit 中纯 import 排序漂移能绕过本地 auto-fix，直到 exact-base `imports:check` 才失败。

本包不放宽 hosted import contract。A0 在 rebase/squash 后的最终 amend 必须显式设置 `SEC_CHANGED_BASE=<current-main-full-sha>`；tracked pre-commit 随即调用 `imports:staged --candidate-base <full-sha>`。Organizer 从 base→index 读取完整候选 diff，而不是仅看本轮 staged paths；blob 生成、真实 `index.lock`、selection/entry revalidation、alternate-index publish 和 working-tree preservation 全部复用现有唯一实现。没有显式 base 的普通 commit 仍走原 staged-only 路径。仓库级 Agent 合同和 hook unit tests 同时绑定该 final-freeze 调用方式，避免依赖聊天记忆。

PR #113 当前两个失败只涉及 import declaration 的机械排序。本 bootstrap 同时把 base-owned V7 transition 的对应 candidate blobs 更新为排序后的 exact identities，避免再制造第二个 trust-root PR。候选产品代码仍不在本包中复制或执行；本包按人工 trust-root bootstrap 合入后，#113 才在新 base 上重冻并执行唯一 hosted V7 Quick。
