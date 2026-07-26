---
schema: codex-development-work-package-v1
id: project-runtime-owner-split-v1
tracking: issue-132
base: 16899564957f175f8e96b2d7c75c8a4ba5772191
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v17
tasks:
  - id: split-project-runtime-tests-by-canonical-owner
    owner: a0
    ownedPaths:
      - docs/test-architecture.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/project-runtime-owner-split-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/dev-runner/fast-test-policy.ts
      - platform/dev-runner/test-runner.ts
      - platform/shared/affected-test-inventory.ts
      - platform/shared/contract-freeze-contract.ts
      - platform/shared/test-impact-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - platform/shared/test-impact-rules/pipeline.ts
      - platform/shared/test-impact-rules/semantic.ts
      - platform/shared/test-impact-rules/verification.ts
      - platform/shared/verification-scope-inventory.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/contract-freeze.test.ts
      - tests/contract/documentation-authority.test.ts
      - tests/contract/dev-runner-contract.test.ts
      - tests/contract/repository-runtime.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/test-architecture.test.ts
      - tests/contract/test-impact.test.ts
      - tests/integration/compiler-dependency-installation.test.ts
      - tests/integration/project-base.test.ts
      - tests/integration/project-dependency-runtime.test.ts
      - tests/integration/project-runtime.test.ts
      - tests/unit/local-gate-union.test.ts
      - tests/unit/task-envelope.test.ts
      - tests/unit/test-runner.test.ts
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
  - docs/05-编译器核心实现规格.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/archive/
  - docs/evidence/
  - docs/goals/
  - docs/governance/
  - package.json
  - platform/compiler/
  - platform/dev-runner.ts
  - platform/orchestrator/
  - platform/shared/test-budget-contract.ts
  - platform/shared/test-ownership-contract.ts
  - platform/shared/project-base.ts
  - platform/shared/project-runtime.ts
  - platform/shared/runtime-dependency-spec.ts
  - scripts/
  - source/
  - tests/e2e/
  - tests/helpers/
  - tests/testkit/
  - tsconfig.json
acceptance:
  - "Every one of the 42 existing project-runtime tests has exactly one disposition: move to a canonical runtime, repository, documentation, or Task Envelope owner, or removal only when a stronger existing behavioral contract proves the same acceptance. No assertion is silently lost or duplicated."
  - "Contract Freeze no longer executes runtime dependency installation as the repository.runtime public contract. It targets one lightweight repository contract while runtime state, compiler dependency publication, generated project base, documentation authority, and Task Envelope behavior retain independent sentinels."
  - "Changes to platform/shared/project-runtime.ts and runtime-dependency-spec.ts select only their real dependency/runtime consumers and preserve exact browser/runtime slow owners. Unrelated semantic mutation, pipeline, registry, manifest, and managed-hook inputs do not inherit project-runtime tests without a demonstrated acceptance dependency."
  - "The former project-runtime exclusive process entry is removed only after all retained runtime tests prove isolated temporary roots and no process-global mock, repository mutation, shared server, or ambient dependency cache ownership."
  - "README, roadmap, and compiler specification share one documentation-authority owner and one direct contract; repository tooling, Task Envelope, generated project base, compiler dependency generation, and project dependency state each retain one direct owner-aligned test path, so affected selection can run the smallest meaningful sentinel."
  - "Unknown sources, unresolved ownership, verifier trust-root changes, and bounded Risk fallback remain fail closed. This package changes ownership declarations and contract targets, not the selector algorithm or test-budget semantics."
  - "Removed and renamed-away test paths remain in changed-path ownership and Risk analysis but never enter the runnable test set. Local selection proves current inventory membership; hosted verification requires an ordinary blob at the exact candidate head."
  - "Structural selection sets, acceptance disposition, process scheduling, and Contract Freeze target membership are hard invariants. A single duration is diagnostic only; comparable observations require one warm-up followed by at least five valid fixed-environment samples and report median plus observed range without creating a hard timeout baseline."
  - "Because test-impact declarations and Contract Freeze are verifier trust roots, the candidate cannot self-authorize; exact scope, acceptance census, selection closure, TCB closure, and merge semantics require independent review and trusted base-side manual bootstrap."
tests:
  - "disposition-contracts: bun test tests/contract/repository-runtime.test.ts tests/contract/documentation-authority.test.ts tests/unit/task-envelope.test.ts --timeout 180000"
  - "runtime-focused: bun test tests/integration/compiler-dependency-installation.test.ts tests/integration/project-base.test.ts tests/integration/project-dependency-runtime.test.ts --timeout 180000"
  - "selector-focused: bun test tests/contract/test-impact.test.ts tests/unit/local-gate-union.test.ts tests/contract/test-architecture.test.ts tests/unit/test-runner.test.ts --timeout 180000"
  - "removed-test-selection: bun test tests/unit/test-runner.test.ts -t \"deleted test paths remain changed facts without becoming runnable tests\" --timeout 180000"
  - "contract-freeze-focused: bun test tests/contract/contract-freeze.test.ts --timeout 180000"
  - "typecheck: bun run typecheck once after source stabilizes"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 and SEC_CHANGED_BASE=16899564957f175f8e96b2d7c75c8a4ba5772191 with bun run imports:check once"
  - "docs-doctor: bun run docs:doctor once"
  - "affected-plan: bun run check:affected --plan returns one exact non-redundant union"
  - "performance-observation: after one warm-up, execute the stable owner-aligned focused batch at least five times and report median plus observed range without creating a hard timeout baseline"
  - "manual-bootstrap: independent exact-head acceptance disposition, selection closure, process-isolation proof, TCB runtime closure, and architecture review"
  - "manifest-scope: every base-to-head path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check 16899564957f175f8e96b2d7c75c8a4ba5772191 HEAD --"
---

# Project Runtime Owner Split V1

## 唯一结果

删除 `tests/integration/project-runtime.test.ts` 这个同时承载 runtime state、compiler dependency generation、repository tooling、文档权威、Task Envelope 和 generated project base 的伪 owner。每项 acceptance 迁入唯一真实 owner；Contract Freeze、affected 与默认 fast 只运行受变化影响的最小 sentinel。

```text
changed source
→ canonical owner declaration or direct import
→ one owner-aligned sentinel
→ optional exact slow owner
```

## Context Capsule

- Branch：`codex/project-runtime-owner-split-v1`
- Base：`main@16899564957f175f8e96b2d7c75c8a4ba5772191`
- Root cause：单个 1085 行 integration 文件混合 10 个 describe group、42 个测试与至少六类 authority。Contract Freeze、roadmap、package、verification fallback、semantic mutation aggregate、pipeline、registry manifest 与 managed hooks 因此都把无关 runtime dependency state 带入反馈路径。
- Deterministic failing reproduction：`repository.runtime`冻结目标是完整`tests/integration/project-runtime.test.ts`；roadmap fallback与registry-manifest owner也选择同一文件，尽管文件中的对应 acceptance只占极小片段或完全不存在；`platform/shared/project-runtime.ts`与runtime spec还被并入整组semantic mutation测试集合。以上都是确定性选择集合，不依赖wall-clock。
- Diagnostic only：main上的一次完整运行是42 pass、3.63秒；其中真实runtime/dependency测试为毫秒至亚秒级，静态repository/docs assertions多为亚毫秒。这个单次观察只定位混杂结构和选择浪费，不是hard baseline。
- Owner：A0只拥有测试 acceptance迁移、test-impact declaration输入、fast process classification、Contract Freeze target及其合同/文档；生产runtime、selector算法、test budget、CI plan、workflow与Engineering IR不迁移。
- Impact：GitNexus对`getContractFreezeTargets`判定 HIGH，直接影响Contract Freeze runner与CLI合同，间接影响Dev Runner；对affected inventory判定 CRITICAL，直接支配本地affected、CI verification、PR Risk与merge gate。因此`repository.runtime`只允许等价替换为轻量canonical contract；全部changed paths继续进入ownership/Risk，只有当前head中的普通Git blob测试可进入runnable set。
- Hard invariant：42项旧测试逐项形成move/remove disposition；remove必须引用更强的既有behavioral owner。所有保留的runtime tests只使用独立temp root与注入式runner，不能拥有process-global mock、真实repository mutation、server或ambient cache。
- Structural delta：`repository.runtime`的Contract Freeze target从42-test integration catch-all收敛为9-test lightweight contract；旧42项acceptance形成32项非重复测试。完整fast inventory的结构计划从139 concurrent + 14 bounded-isolated + 7 exclusive / 16 waves变为145 concurrent + 14 bounded-isolated + 6 exclusive / 15 waves；应用default exclusion后的当前实际计划为145 concurrent + 7 bounded-isolated + 3 exclusive / 10 waves。新增owner文件进入既有concurrent waves，旧runtime exclusive tail被删除。
- Documentation owner：README、稳定路线图与编译器规格统一由`documentation-authority`拥有并只选择`tests/contract/documentation-authority.test.ts`；同一canonical文档合同不得再拆成`roadmap-authority`与`documentation-authority`两个owner。
- Performance protocol：结构选择、target membership与process classification可作hard invariant；wall-clock先warm-up，再至少五个有效样本，以median和observed range报告。单次duration不改变timeout、lane、candidate validity或测试归属。
- Performance observation：固定全部32项owner-aligned acceptance的6-file concurrent batch，warm-up为`2783.9ms`；五个有效样本为`3194.6 / 3017.8 / 3343.1 / 3033.0 / 3016.2ms`，median为`3033.0ms`，observed range为`3016.2–3343.1ms`。`hardBaseline=false`；这只证明当前candidate的完整split acceptance稳定处于数秒级，不据此建立timeout或跨机器优化比例。
- Gate owner：A0；开发中只运行受当前delta影响的focused sentinel，最终候选只运行一次完整correctness closure与固定环境多样本观测。候选修改canonical verifier trust root，禁止candidate-hosted自证，必须独立Review与base-side manual bootstrap。

## 42-test acceptance disposition

| 旧组/数量 | 唯一 disposition |
| --- | --- |
| shared runtime dependency installation / 2 | move → `tests/integration/project-dependency-runtime.test.ts` |
| compiler dependency installation / 7 | move → `tests/integration/compiler-dependency-installation.test.ts` |
| root package scripts / 4 | move → `tests/contract/repository-runtime.test.ts` |
| repository/cache/MCP/workflow contracts / 4 | move → `tests/contract/repository-runtime.test.ts` |
| Task Envelope source-text / 2 | consolidate → `tests/unit/task-envelope.test.ts`的一项behavioral builder contract；直接断言typed inputs、writable path、symbol与固定forbidden operations |
| contract scripts bypass dev-runner / 1 | move → `tests/contract/repository-runtime.test.ts` |
| roadmap/compiler spec/README / 3 | move → `tests/contract/documentation-authority.test.ts` |
| project/shared runtime manifests / 1 | move → `tests/integration/project-dependency-runtime.test.ts` |
| generated project base / 2 | move → `tests/integration/project-base.test.ts` |
| dependency bridge + ensureProjectDependencies / 7 | move → `tests/integration/project-dependency-runtime.test.ts` |
| test-budget/benchmark/reference source-text / 3 | remove duplicate → 分别由`tests/contract/benchmark-budget.test.ts`与`tests/contract/reference.test.ts`的builder + CLI behavioral contracts覆盖 |
| duplicate demo:closed-loop content / 1 | remove duplicate → `repository-runtime`中的exact root script contract已覆盖同一命令及verify/artifacts/explain |
| Contract Freeze source-text / 1 | remove duplicate → `tests/contract/contract-freeze.test.ts`直接验证builder、target list、runner argv、text/JSON CLI |
| Error protocol source/contract/CLI source-text / 3 | remove duplicate → `tests/contract/error-protocol.test.ts`直接验证builder self-consistency、全部关键shape/examples及text/JSON CLI |
| process shell source-text / 1 | remove duplicate → `tests/contract/dev-runner-contract.test.ts`直接验证唯一command runner固定`spawn({ shell: false })`边界 |

因此旧42项形成32个非重复behavioral/contract tests：19个runtime-focused、9个repository、3个documentation、1个Task Envelope。删除的10项均有上表中的更强owner，不以“运行很快”为保留无用重复测试的理由。

## Reload if

- live `origin/main`不再是`16899564957f175f8e96b2d7c75c8a4ba5772191`。
- Contract Freeze、test-impact ownership、fast scheduling、test budget、CI verification plan、merge gate或42-test acceptance disposition出现外部变化。
- 实现需要修改production runtime、selector算法、test budget、workflow、scripts、Engineering IR或任何 forbidden path。
- 任一旧assertion无法证明唯一新owner，或删除exclusive scheduling需要依赖未隔离的process/global/repository state。

## Reconciliation 与停止

返回 tested head/base、changed paths、42-test disposition、owner/selection delta、Contract Freeze与process scheduling delta、focused与TCB结果、结构选择前后集合、多样本观测、可复用/失效 evidence、blocker、下一 ready seam，以及 `inspect_ms`、`implement_ms`、`focused_validation_ms`、`wait_ms`、`reconcile_ms`、`context_reload_count`、`duplicate_gate_count`。第二次 candidate invalidation立即停止 broad validation并回到 proof。
