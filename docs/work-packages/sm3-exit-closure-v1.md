---
schema: codex-development-work-package-v1
id: sm3-exit-closure-v1
tracking: issue-106
base: 75806415f2279106ada32b7619786e5f4f76d35a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: sm3-exit-closure
    owner: a0
    ownedPaths:
      - docs/03-MVP实施计划与路线图.md
      - docs/evidence/v0-4-semantic-mutation-exit-closure-2026-07-19.json
      - docs/work-packages/sm3-exit-closure-v1.md
forbiddenPaths:
  - .github/workflows/
  - AGENTS.md
  - bun.lock
  - bunfig.toml
  - package.json
  - platform/
  - scripts/
  - tests/
acceptance:
  - "The closeout maps every SM-3 lease, staging/CAS, Verification, journal/replay/retention, publish/rebuild, and rollback/recovery exit obligation to exact production and executable contract ownership already present on current main."
  - "PR 113 V7 run 29660572339 is reused only for unchanged product/test blobs; its exact owner/residual, three sibling, production-delta, and risk coverage is not presented as current-head evidence."
  - "The Bun 1.3.14 and dependency-generation transition invalidates the old runtime binding, so one current production sentinel is executed exactly once under a frozen manifest commit and is never hidden inside another batch."
  - "The current-runtime delta batch covers writer lease, recovery generations, terminal receipts, Verification adapter, isolated child lifecycle, project dependency materialization, Windows publish/rollback, and the three non-production apply siblings."
  - "Final evidence records exact head/tree, runtime identity, commands, results, durations, product/test blob ledger, reuse and invalidation decisions, and the docs-only closeout boundary."
  - "No product, test, CI, selector, schema, dependency, Playwright, browser automation, AppContainer execution, C, Rust, or FFI surface changes in this package."
tests:
  - "bun test tests/unit/workspace-write-lease.test.ts tests/integration/pipeline-workspace-write-lease.test.ts tests/unit/semantic-mutation-apply.test.ts tests/integration/semantic-mutation-recovery-lifecycle.test.ts tests/integration/semantic-mutation-windows-rollback.test.ts tests/unit/semantic-mutation-verification-adapter.test.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts tests/integration/project-runtime.test.ts --timeout 180000"
  - "bun test tests/integration/semantic-mutation-apply.test.ts --test-name-pattern <three frozen non-production sibling titles> --timeout 180000"
  - "SEC_RUN_SM3_PRODUCTION_SENTINEL=1 bun test tests/integration/semantic-mutation-production-sentinel.test.ts --timeout 300000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=75806415f2279106ada32b7619786e5f4f76d35a bun run imports:check"
  - "bun run test:affected"
  - "bun run test:contract-freeze"
  - "bun run docs:doctor"
  - "git diff --check"
---

# SM-3 Exit Closure V1

当前 `main` 已具备 SM-3 coordinator 的完整实现表面。PR #113 的 V7 exact-head evidence 在 Bun 1.3.6 上执行了 owner/residual batch、三条 apply sibling、唯一 production delta 和 selector risk files；后续 Import authority 迭代只对 Semantic Mutation production 表面形成 import 排序、canonical Bun version load 和 compiler dependency generation delta，但把 runtime 从 1.3.6 迁移到 1.3.14，因此旧 production binding 不再足以支撑 SM-3 exit。

本包不修改实现。A0 先静态复核当前 `main` 的六类退出义务与 exact blob；再运行一次不含 production seam 的当前运行时 delta batch；随后只运行一次显式 opt-in production sentinel。通过后追加 durable evidence 与路线图 closeout，最终 docs-only diff 不得改变任何已测 product/test blob。AppContainer 保持 optional hardening 且 `capabilityComplete:false`，不作为 SM-3 退出条件或产品能力声明。
