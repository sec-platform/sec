---
schema: codex-development-work-package-v1
id: import-test-feedback-v1
tracking: issue-132
base: 9f61bca1d8b7d358368270eff783fb6eac27c568
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v15
tasks:
  - id: seed-and-bound-import-organizer-test-fixtures
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/test-architecture.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/import-test-feedback-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/shared/ci-verification-plan.ts
      - platform/shared/test-budget-contract.ts
      - tests/contract/benchmark-budget.test.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/e2e/import-organizer-staged.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-pr-risk-selection.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
      - tests/unit/import-organizer-staged.test.ts
forbiddenPaths:
  - .codex/
  - .githooks/
  - AGENTS.md
  - docs/00-文档索引与一致性规则.md
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/archive/
  - docs/evidence/
  - docs/goals/
  - package.json
  - platform/compiler/
  - platform/dev-runner/
  - platform/shared/ci-contract.ts
  - platform/shared/test-impact-contract.ts
  - scripts/
  - tests/integration/
  - tests/testkit/
  - tsconfig.json
acceptance:
  - "The fast lane keeps one real Git plus TypeScript micro-sentinel that proves staged index normalization, working-tree byte preservation and changed-path publication in a few seconds."
  - "The complete seventeen original organizer scenarios move intact to tests/e2e, with one additional fixture-rollback sentinel, and belong to one explicit non-baseline slow suite; it is selected for direct/impacted Risk or Full, never the ordinary edit loop."
  - "The exhaustive file creates and commits one immutable seed repository, then gives every executed scenario an isolated copied repository; no scenario shares mutable Git index, worktree, lock, config or object publication state."
  - "At most four exhaustive scenario repositories execute concurrently. Successful repository initialization falls from once per scenario to once per file, all existing assertions remain, and creators retain cleanup ownership until every copy or seed is successfully transferred."
  - "A single duration remains diagnostic only. Comparative fast-sentinel performance uses one warm-up plus at least five valid samples and reports median and observed range."
  - "V1 verifier revision and every active artifact producer/lookup advance atomically from V14 to V15. V2 composition stays V7, and the candidate uses manual bootstrap rather than self-authorization."
  - "No production organizer, Git publication, TypeScript authority, timeout, assertion, daemon or persistent semantic cache changes."
tests:
  - "fast-sentinel: bun test tests/unit/import-organizer-staged.test.ts --timeout 180000"
  - "slow-acceptance: bun test tests/e2e/import-organizer-staged.test.ts --timeout 180000 once"
  - "performance-sampling: after one warm-up, run the fast sentinel at least five times under the canonical fixed-environment protocol; report median and observed range"
  - "v15-contract: bun test tests/contract/benchmark-budget.test.ts tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/docs-doctor.test.ts tests/contract/sec-merge-gate.test.ts tests/unit/codex-work-package-contract.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-pr-risk-selection.test.ts tests/unit/ci-verification-execution.test.ts --timeout 180000"
  - "typecheck: bun run typecheck once after source stabilizes"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 and SEC_CHANGED_BASE=9f61bca1d8b7d358368270eff783fb6eac27c568 with bun run imports:check once on the frozen candidate"
  - "docs-doctor: bun run docs:doctor once"
  - "manual-bootstrap: independent exact-head architecture/evidence review plus base-side integration for the V15 trust-root transition"
  - "manifest-scope: every base-to-head path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check 9f61bca1d8b7d358368270eff783fb6eac27c568 HEAD --"
---

# Import Organizer测试反馈V1

## 唯一结果

把编辑循环缩成一个真实Git+TypeScript micro-sentinel；完整Git index、atomic publication、race、mode、rename、CRLF与failure rollback覆盖进入显式slow acceptance。Slow文件继续删除每场景重复初始化仓库的固定成本，并用有界并发把独立场景从十六个串行波次压到最多四个波次。

```text
fast: one real staged organizer micro-sentinel
slow: one immutable seed → isolated copies → p-limit(4)
→ unchanged exhaustive assertions → cleanup
```

## Context Capsule

- Branch：`codex/import-test-feedback-v1`
- Base：`main@9f61bca1d8b7d358368270eff783fb6eac27c568`
- Failing feedback：完整文件的诊断运行分别为31.87秒与35.96秒；seed+四槽实验仍为22.28秒。三者都不是hard baseline，但共同证明完整acceptance不属于编辑循环。
- Comparable sample：最终fast sentinel在同一candidate与环境下完成一次warm-up，再取五个有效样本；wall-clock median为3.528秒，observed range为3.215–3.791秒。该集合只证明本候选反馈已进入几秒级，不形成跨机器hard threshold。
- Structural proof：Windows原有17个测试实际执行16个场景并skip一个symlink场景；旧fixture仅基础仓库就重复112个同步Git child且全部串行。新fast owner只执行一个真实场景；slow owner保留原17个测试并新增一个creator rollback sentinel，只在selected slow acceptance运行一次。
- Owner：unit sentinel拥有快速阻断；e2e suite拥有完整acceptance；test-budget registry拥有lane membership；Git index、TypeScript Language Service与production organizer均禁止修改。
- Trust boundary：slow registry与V1 verification plan属于verifier trust root，因此原子升级V15并走manual bootstrap；V2 composition保持V7。
- Gate owner：A0；开发中只运行fast sentinel；最终slow acceptance、typecheck/imports/docs各一次，不运行重复Risk/Full。

## Reload if

- live `origin/main`不再是`9f61bca1d8b7d358368270eff783fb6eac27c568`。
- 需要修改production organizer、test runner、test impact、V2 composition或任一forbidden path。
- 有界并发暴露共享Git/object/temp authority，或Windows cleanup产生EBUSY/EPERM residue。

## Stop

- fast sentinel不再运行真实Git或TypeScript organizer。
- 任一既有slow场景、断言或平台skip语义被删除。
- 两个slow场景观察到同一mutable repository、index、lock或working tree，active计数超过4，或afterAll仍有active clone。
- V15 producer/lookup不能原子同步，或V2 composition变化。
- 第二次candidate invalidation。
