---
schema: codex-development-work-package-v1
id: dev-runner-precise-test-impact-v1
tracking: issue-132
base: b2890f43acfc15c90050002e4053144275afa2fc
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v17
tasks:
  - id: replace-dev-runner-directory-fallback-with-owned-sentinels
    owner: a0
    ownedPaths:
      - docs/test-architecture.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/dev-runner-precise-test-impact-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/shared/ci-pr-risk-selection.ts
      - platform/shared/test-impact-contract.ts
      - platform/shared/test-impact-rules/verification.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/dev-runner-contract.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/test-impact.test.ts
      - tests/integration/project-runtime.test.ts
      - tests/unit/ci-pr-risk-selection.test.ts
forbiddenPaths:
  - .codex/
  - .github/
  - .githooks/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - docs/00-文档索引与一致性规则.md
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/archive/
  - docs/evidence/
  - docs/goals/
  - docs/governance/
  - package.json
  - platform/compiler/
  - platform/dev-runner.ts
  - platform/dev-runner/
  - platform/orchestrator/
  - platform/shared/affected-test-inventory.ts
  - platform/shared/test-budget-contract.ts
  - platform/shared/test-ownership-contract.ts
  - scripts/
  - source/
  - tests/e2e/
  - tests/testkit/
  - tsconfig.json
acceptance:
  - "Every current canonical platform/dev-runner.ts or platform/dev-runner/** module resolves through an explicit architecture owner: core runner modules use the dev-runner declaration, dependency-bootstrap keeps the narrower managed-git-hooks owner, and any new undeclared module fails closed. No module falls through to the generic verification-infrastructure test list."
  - "Local affected selection for dev-runner changes uses a small dev-runner contract and directly relevant unit/contract tests, and does not unconditionally select tests/integration/project-runtime.test.ts or unrelated CI/budget contracts."
  - "PR Risk no longer maps the entire dev-runner directory to all bounded baseline slow suites. It selects no slow suite for contract-only runner changes and preserves exact slow owners for import-organizer and managed-hook dependency changes."
  - "Null changed-file discovery, unknown paths, CI selector authority changes, and every non-dev-runner mandatory trust-root surface retain their existing fail-closed or bounded-baseline behavior."
  - "The project-runtime suite keeps runtime/dependency ownership; dev-runner source-text and package-script assertions move to one lightweight contract without duplicated acceptance."
  - "Because test-impact and PR-Risk selection are CRITICAL verifier trust-root paths, the candidate cannot self-authorize; exact scope, selection closure, TCB closure, and merge semantics require independent review and trusted base-side manual bootstrap."
  - "Structural selection counts are hard invariants. Wall-clock observations remain diagnostic until the fixed-environment protocol performs a warm-up and at least five valid samples and reports median plus observed range; no single sample changes timeout, lane, or candidate validity."
tests:
  - "focused-selector: bun test tests/contract/dev-runner-contract.test.ts tests/contract/test-impact.test.ts tests/unit/ci-pr-risk-selection.test.ts tests/contract/ci-lanes.test.ts --timeout 180000"
  - "moved-acceptance: bun test tests/integration/project-runtime.test.ts --timeout 180000"
  - "trust-root-contract: bun test tests/contract/sec-merge-gate.test.ts --timeout 180000"
  - "typecheck: bun run typecheck once after source stabilizes"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 and SEC_CHANGED_BASE=b2890f43acfc15c90050002e4053144275afa2fc with bun run imports:check once"
  - "docs-doctor: bun run docs:doctor once"
  - "affected-plan: bun run check:affected --plan returns one exact non-redundant union"
  - "performance-observation: after warm-up, execute the stable selected dev-runner focused batch at least five times and report median plus observed range without creating a hard timeout baseline"
  - "manual-bootstrap: independent exact-head scope, local/hosted selector closure, fail-closed behavior, TCB runtime closure, and architecture review"
  - "manifest-scope: every base-to-head path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check b2890f43acfc15c90050002e4053144275afa2fc HEAD --"
---

# Dev Runner Precise Test Impact V1

## 唯一结果

把 `platform/dev-runner.ts` 与 `platform/dev-runner/**` 从目录级通用测试/慢测 fallback 迁移到唯一的 dev-runner ownership declaration。每个变化只选择公共 runner 合同、直接 import 它的测试和更窄 owner 声明的专用验收；未知路径与 selector authority 继续 fail closed。

```text
changed dev-runner module
→ explicit owner declaration
→ common lightweight runner contract
  ∪ direct import sentinels
  ∪ narrower owner acceptance
→ exact local/Risk selection
```

## Context Capsule

- Branch：`codex/dev-runner-precise-impact-v1`
- Base：`main@b2890f43acfc15c90050002e4053144275afa2fc`
- Root cause：`testImpactFallbackRules`把所有 dev-runner 变化固定映射到 6 个通用测试文件，`MANDATORY_SENTINEL_PATTERNS`又把同一目录固定映射到全部 5 个 baseline Risk slow suites；选择与实际模块 owner 无关。
- Failing reproduction：`selectTestsForSources(['platform/dev-runner/check-runner.ts'])`静态返回通用 6 文件；`selectCiPrRiskSlowSuites`对同一路径静态返回全部 baseline slow suite。该过选是确定性集合事实，不用一次 duration 证明。
- Owner：新增 verification test-impact declaration 只拥有 dev-runner source → sentinel 映射；既有 affected inventory、test budget、slow suite registry、CI verification plan、Evidence 与 merge gate authority不迁移。
- Impact：GitNexus对`selectTestsForSources`和`selectCiPrRiskSlowSuites`均判定 CRITICAL，直接影响本地 affected、CI verification、PR Risk 与 merge gate；因此不修改选择算法，只替换 dev-runner 的 ownership 输入和 mandatory目录 fallback。
- Hard invariant：root runner与目录内每个当前 canonical module都解析到显式architecture owner；core runner使用dev-runner owner，dependency bootstrap使用managed-git-hooks owner，direct import/narrow owner保留真实慢验收；新增未声明模块与其他未知输入仍 fail closed。
- Structural delta：`check-runner.ts`本地fast集合从7项收敛为4项、Risk从5个baseline suite收敛为0；`import-organizer.ts`从8个通用fast + 1个专用slow收敛为5个fast + 同一专用slow，Risk从5个baseline + 1个专用slow收敛为该1个专用slow；dependency bootstrap保留原4个fast + 1个managed-hook slow，Risk只保留该1个slow。以上是确定性集合，不是wall-clock推断。
- Removed-fallback coverage census：旧6-file generic fallback中，`ci-contract`的typecheck source-text合同与`ci-lanes`的affected/PR-Risk wiring合同真实依赖dev-runner bytes，现完整迁入公共轻量`dev-runner-contract`；`benchmark-budget`只判断固定路径分类，其结果不依赖source bytes；其余合同没有dev-runner source acceptance。迁移后无重复assertion且不丢失既有acceptance。
- Performance protocol：结构集合可直接作为 hard invariant；真实 wall-clock 只在候选稳定后执行 warm-up + 至少五个有效样本，以 median + observed range报告，不以单次离群建立基准或宣称优化比例。
- Performance observation：固定未来`check-runner.ts`选择的4文件batch，在完整removed-fallback coverage census收口后的最终source delta上先warm-up `1701.1ms`，再得到五个有效样本`1731.6 / 1697.3 / 1759.1 / 1748.5 / 1724.2ms`；median `1731.6ms`，observed range `1697.3–1759.1ms`。该观测证明当前反馈位于数秒内，但`hardBaseline=false`，不据此建立timeout或回归阈值。
- Gate owner：A0；开发中只运行 selector focused batch，稳定后运行一次 final correctness closure和多样本观测；trust-root candidate不发送自证 Quick/Risk，走独立Review与base-side manual bootstrap。

## Reload if

- live `origin/main`不再是`b2890f43acfc15c90050002e4053144275afa2fc`。
- affected inventory、test budget/ownership contract、slow suite registry、CI verification plan、merge gate或canonical verifier trust-root发生外部变化。
- 实现需要修改 dev-runner runtime、生产 compiler、workflow、scripts、test budget或任何 forbidden path。
- selector无法在不弱化unknown-path fail-closed或删除专用slow acceptance的前提下精确化。

## Reconciliation 与停止

返回 tested head/base、changed paths、owner/selection delta、focused与TCB结果、结构选择前后集合、多样本观测、可复用/失效 evidence、blocker、下一 ready seam，以及 `inspect_ms`、`implement_ms`、`focused_validation_ms`、`wait_ms`、`reconcile_ms`、`context_reload_count`、`duplicate_gate_count`。第二次 candidate invalidation立即停止 broad validation并回到 proof。
