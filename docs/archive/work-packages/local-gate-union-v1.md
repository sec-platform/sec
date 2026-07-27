---
schema: codex-development-work-package-v1
id: local-gate-union-v1
tracking: issue-132
base: 8846d5fa8ff8feaf2bb0fa7758f0c3ac45ea5636
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v17
tasks:
  - id: execute-minimal-local-gate-union
    owner: a0
    ownedPaths:
      - docs/04-AI自主实现执行蓝图.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/local-gate-union-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - package.json
      - platform/dev-runner.ts
      - platform/dev-runner/check-runner.ts
      - platform/dev-runner/test-runner.ts
      - platform/dev-runner/typecheck-runner.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/integration/project-runtime.test.ts
      - tests/unit/local-gate-union.test.ts
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
  - docs/14-Engineering IR与语义事实规范.md
  - docs/archive/
  - docs/evidence/
  - docs/goals/
  - docs/governance/
  - platform/compiler/
  - platform/dev-runner/dependency-bootstrap.ts
  - platform/dev-runner/import-organizer.ts
  - platform/dev-runner/fast-test-policy.ts
  - platform/orchestrator/
  - platform/shared/ci-verification-plan.ts
  - platform/shared/heavy-verification-gate-lease.ts
  - platform/shared/project-runtime.ts
  - platform/shared/test-budget-contract.ts
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - scripts/codex/
  - source/
  - tests/e2e/
  - tests/testkit/
  - tsconfig.json
acceptance:
  - "bun run check:affected --plan is read-only: it does not bootstrap dependencies, acquire the heavy Gate lease, start test/typecheck/docs children, or write Evidence."
  - "The local plan computes one fail-closed ordered union from canonical changed paths and the affected selector, and reports the standalone commands subsumed by the umbrella execution."
  - "Pure active-documentation changes select docs:doctor only; TypeScript changes select imports:prepare and typecheck; selected affected fast tests add test:affected without duplicating any selected gate."
  - "Compiler dependency preparation is lazy and occurs only when the resolved union contains imports:prepare or typecheck; pure docs, empty plans, and unresolved preflight do not pay compiler bootstrap."
  - "bun run check:affected executes the exact resolved plan once in one dev-runner lifecycle and fail-stops on the first failed gate; execution is exposed only as an immutable resolver-issued capability and never accepts a caller-supplied plan."
  - "The umbrella command reuses the already validated compiler dependency context for typecheck rather than revalidating the same generation in the same process."
  - "Existing test:affected plan and execution semantics remain unchanged, including unresolved-path fail-closed, slow notices, and the zero-wait heavy Gate lease."
  - "The canonical verifier runtime closure explicitly includes check-runner.ts, remains entirely inside the declared trust root, and introduces no unreviewed external import or process dispatcher."
  - "check:fast and check:full remain explicit broader profiles; the planner never claims they are required for ordinary affected closure."
  - "Because package.json and platform/dev-runner are canonical verifier trust-root paths, the exact candidate uses independent review and trusted base-side manual bootstrap rather than candidate-hosted self-authorization."
  - "One wall-clock observation remains diagnostic only; performance claims use structural invocation counts or the fixed-environment warm-up plus at least five valid samples, median, and observed range."
tests:
  - "focused-plan: bun test tests/unit/local-gate-union.test.ts tests/unit/test-runner.test.ts --timeout 180000"
  - "package-contract: bun test tests/integration/project-runtime.test.ts --timeout 180000"
  - "trust-root-contract: bun test tests/contract/sec-merge-gate.test.ts --timeout 180000"
  - "typecheck: bun run typecheck once after source stabilizes"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 and SEC_CHANGED_BASE=8846d5fa8ff8feaf2bb0fa7758f0c3ac45ea5636 with bun run imports:check once"
  - "docs-doctor: bun run docs:doctor once"
  - "affected-plan: bun run check:affected --plan performs no dependency bootstrap and selects one non-redundant union"
  - "manual-bootstrap: independent exact-head scope, architecture, TCB runtime-closure, plan canonicality, and execution-order review"
  - "manifest-scope: every base-to-head path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check 8846d5fa8ff8feaf2bb0fa7758f0c3ac45ea5636 HEAD --"
---

# Local Gate Union V1

## 唯一结果

把本地最终验证从“先手工跑 focused/imports/typecheck，再执行一个包含相同步骤的 umbrella command”收敛为一次只读计划和一次最小非重复 Gate 并集。计划由 changed paths 与既有 affected selector 共同决定；执行入口只运行计划选中的 Gate，一项失败立即停止。

```text
read-only changed-path / affected plan
→ one ordered Gate union
→ one umbrella execution
→ no standalone rerun of a subsumed Gate
```

## Context Capsule

- Branch：`codex/local-gate-union-v1`
- Base：`main@8846d5fa8ff8feaf2bb0fa7758f0c3ac45ea5636`
- Root cause：`package.json`把`check:affected`定义成`imports:prepare && typecheck && test:affected`，但流程又要求开发中先运行focused sentinel、稳定后再分别运行imports/typecheck，最终调用umbrella时形成整项重复；命令本身也不能在无副作用前提下先展示它将包含什么。
- Failing reproduction：对同一未变化candidate先运行`imports:prepare`、`typecheck`或`test:affected`，随后运行`check:affected`会无条件再次执行相同子 Gate；这是静态argv结构事实，不用一次duration充当性能基准。
- Owner：`platform/dev-runner/check-runner.ts`拥有本地Gate并集与执行顺序；affected ownership仍由既有selector拥有，依赖、heavy lease、fast/slow registry、hosted CI与Evidence authority不迁移。
- Hard invariant：`--plan`只读、零dependency bootstrap、零heavy lease、零验证child；正式执行每个selected Gate最多一次，且subsumed standalone command不得在同一final closure中先行重复。
- Risk boundary：不修改HIGH风险`withTestDependencies`、browser/runtime、CI verifier revision、hosted Gate plan或Risk/Full语义；但`package.json`和`platform/dev-runner/**`本身属于canonical verifier trust root，因此交付必须走manual bootstrap。
- Gate owner：A0；开发中只跑新planner与focused plan contract，candidate稳定后运行一次最小final union与TCB contract，再做独立exact-head Review；不发送必然`manual-bootstrap-required`的candidate-hosted Quick/Risk。

## Reload if

- live `origin/main`不再是`8846d5fa8ff8feaf2bb0fa7758f0c3ac45ea5636`。
- affected selector、active-documentation path contract、canonical verifier trust-root清单、dependency generation、heavy Gate lease或fast/slow registry发生变化。
- 需要修改任一forbidden path、hosted CI Gate plan、Evidence schema或browser/runtime准备边界。
- exact candidate第一次freeze后继续修改实现。

## Stop

- 通过跳过真实selected test、删除覆盖、弱化unresolved fail-closed或复用非exact candidate结果宣称去重。
- `--plan`安装依赖、获取heavy lease、启动验证child或写Evidence。
- 为减少一次dependency readiness检查而修改HIGH风险共享test dependency入口。
- 发送candidate-hosted Quick/Risk并把必然失败或candidate自证状态当作merge authority。
- 单次duration被用来改变hard timeout、lane归属或正式性能结论。
- candidate发生第二次invalidation。
