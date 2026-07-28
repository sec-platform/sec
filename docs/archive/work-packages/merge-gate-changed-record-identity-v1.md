---
schema: codex-development-work-package-v1
id: merge-gate-changed-record-identity-v1
tracking: issue-175
base: a2f4463ab94c12346134a46ee3ae0ff4a16082a8
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v17
tasks:
  - id: freeze-merge-gate-record-bootstrap
    owner: a0
    ownedPaths:
      - docs/archive/work-packages/runtime-authority-and-package-layout-v1.md
      - docs/work-packages/merge-gate-changed-record-identity-v1.md
      - docs/work-packages/runtime-authority-and-package-layout-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
  - id: normalize-merge-gate-changed-record-identity
    owner: merge-gate-record-worker
    ownedPaths:
      - scripts/codex/merge-gate.ts
      - tests/contract/sec-merge-gate.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - package.json
  - platform/
  - scripts/ci-verification.ts
  - scripts/codex/work-package-contract.ts
  - scripts/run-work-package-gate.ts
acceptance:
  - "The base-side merge gate compares canonical changed-record values independently of JavaScript object property insertion order."
  - "Canonical records always materialize status, path, and optional previousPath in one fixed shape before comparison; sort order alone is not treated as canonicalization."
  - "Semantically equal renamed and copied records from GitHub API and exact Git pass, while any status, path, previousPath, missing-field, or extra-record drift still fails closed."
  - "The fix changes no GitHub API observation, workflow payload, Work Package schema, Evidence schema, verification plan, artifact revision, trust-root inventory, or product/runtime behavior."
  - "The false merge-gate failure on PR 181 is permanently covered by a focused contract regression; Scope and Quick cannot repeat for an unchanged exact identity, while a real base, head, or manifest identity change invalidates the old evidence."
  - "Because scripts/codex/merge-gate.ts is verifier trust root, this candidate cannot self-certify; merge authority comes from trusted-base parser and TCB closure, focused/typecheck/docs evidence, independent exact-head Review, and manual integration."
  - "After the new manifest atomically owns the active pointer, the completed runtime-authority-and-package-layout-v1 manifest moves byte-identically into docs/archive/work-packages and no selected historical Work Package remains in the active directory."
  - "All base-to-candidate changed records have exactly one owner and no forbidden intersection; the frozen candidate is one direct child of the current main."
tests:
  - "bun test tests/contract/sec-merge-gate.test.ts --test-name-pattern 'changed-record value identity' --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run audit:repository"
  - "bun run check:affected --plan"
  - "bun run imports:freeze"
---

# Merge Gate Changed Record Identity V1

PR #181 的 GitHub `pulls.listFiles` 与 exact Git diff 对同一 rename 生成了值相等但属性插入顺序不同的对象。当前 merge gate 在排序后直接 `JSON.stringify` 原对象，因此把 `{status,path,previousPath}` 与 `{status,previousPath,path}` 误判为不同身份。这个失败属于 default-branch verifier trust root，不属于 PR #181 的产品实现；旧 exact identity 已通过的 Scope 与 Quick 不得原样重跑，bootstrap 造成 base/head/manifest identity 变化后才允许对新 identity 各执行一次。

本包只让 changed-record canonicalizer 重新物化固定字段顺序，并增加 rename/copy 正例和真实身份漂移负例。它不改变 changed-record 的采集次数、GitHub workflow、Git diff 参数、Work Package、Evidence 或 Gate 选择语义。候选由旧 `main` 侧的 parser、TCB closure、focused evidence 和独立 exact-head Review人工 bootstrap；进入 `main` 后返回 `TASK_RESTART_REQUIRED`，再由新任务恢复 PR #181。
