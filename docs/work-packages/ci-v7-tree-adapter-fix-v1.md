---
schema: codex-development-work-package-v1
id: ci-v7-tree-adapter-fix-v1
tracking: issue-106
base: 469583b90f0eef032436fde722c4261e8f324e97
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: ci-v7-tree-adapter-fix
    owner: a0
    ownedPaths:
      - docs/work-packages/ci-v7-tree-adapter-fix-v1.md
      - scripts/ci-verification.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-verification-v7-execution.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - package.json
  - platform/
  - tests/e2e/
acceptance:
  - "The V7 runner resolves a commit tree with <commit>^{tree}; it never compares a commit object ID directly with a tree object ID."
  - "All runner and base-side merge-gate fixtures return commit IDs for commit refs and tree IDs only for explicit tree expressions."
  - "The regression fails before any verification Gate under the broken adapter and passes with the corrected adapter."
  - "The fix changes no evidence policy, selector, gate plan, workflow, product path, runtime version, Playwright surface, or AppContainer capability."
tests:
  - "bun test tests/unit/ci-verification-v7-execution.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts --timeout 180000"
  - "bun test tests/contract/sec-merge-gate.test.ts --test-name-pattern '^base-side V7 merge gate independently reconstructs the real P0 plan and rejects self-signed drift$' --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run imports:check"
  - "git diff --check"
---

# CI V7 Tree Adapter Fix V1

真实 Git 的 `rev-parse <commit>` 返回 commit object ID，`rev-parse <commit>^{tree}` 才返回 tree object ID。V7 runner 曾把通用 revision resolver 直接作为 tree resolver 传入，导致 exact head/tree 在任何 Gate 启动前必然失配；测试 mock 同时把 commit ref 错误映射为 tree ID，掩盖了真实 Actions 缺陷。

本包只修正 runner adapter，并把 V7 runner 与 base-side merge-gate fixtures 改为真实 Git 语义。失败证据绑定 Actions run `29648329461`、head `5d710d347df8ec622dc297c274e4027d9b4c1f8f`、base `469583b90f0eef032436fde722c4261e8f324e97`；该 run 在零 Gate 状态以 `Evidence composition current head/tree mismatch` fail closed。
