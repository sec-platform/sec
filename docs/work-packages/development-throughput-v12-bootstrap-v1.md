---
schema: codex-development-work-package-v1
id: development-throughput-v12-bootstrap-v1
tracking: issue-132
base: 4eccc767c4dfeae4cd1190b17ceb91864af29f9a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v12
tasks:
  - id: fail-fast-affected-selection-and-remove-workflow-churn
    owner: a0
    ownedPaths:
      - .codex/agents/implementation-worker.toml
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - AGENTS.md
      - docs/04-AI自主实现执行蓝图.md
      - docs/evidence/2026-07-26-development-throughput-audit.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/development-throughput-v12-bootstrap-v1.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - platform/dev-runner.ts
      - platform/dev-runner/test-runner.ts
      - platform/shared/ci-verification-plan.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
      - tests/unit/heavy-verification-gate-lease.test.ts
      - tests/unit/test-runner.test.ts
forbiddenPaths:
  - .claude/
  - .githooks/
  - docs/00-文档索引与一致性规则.md
  - docs/01-用户能力模块化开发-主题整理稿.md
  - docs/02-工程编译器-MVP-PRD与架构稿.md
  - docs/03-MVP实施计划与路线图.md
  - docs/05-编译器核心实现规格.md
  - docs/06-Registry与Block协议规范.md
  - docs/07-Pass状态机、错误码与恢复机制.md
  - docs/08-Verification、Provenance与Graph规范.md
  - docs/09-AI Runtime、任务信封与治理规范.md
  - docs/10-升级迁移与Override规范.md
  - docs/11-Workbench与可视化规范.md
  - docs/12-编译管道与行为流图示.md
  - docs/13-独立工具分发与打包规划.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/archive/
  - docs/goals/
  - docs/governance/
  - docs/scripts/
  - package.json
  - platform/compiler/
  - platform/shared/affected-test-inventory.ts
  - platform/shared/ci-pr-risk-selection.ts
  - platform/shared/ci-verification-revision.ts
  - platform/shared/heavy-verification-gate-lease.ts
  - platform/shared/test-budget-contract.ts
  - platform/shared/test-impact-contract.ts
  - scripts/
  - tests/e2e/
  - tests/fixtures/
  - tests/integration/
acceptance:
  - "test:affected --plan reads the canonical Git changed-path input and existing Risk selector, then prints changed paths, affected owners, selected fast/slow tests, Risk suites/tests/reasons and every unresolved path without starting dependencies, tests, Evidence or a heavy-gate lease."
  - "Plan and formal affected selection fail closed for every unresolved changed path. Formal affected performs this check before dependency bootstrap or test child creation; resolved affected preserves current fast-test selection, concurrency/isolation, slow notice and explicit-argument compatibility."
  - "platform/dev-runner.ts bypasses the heavy verification lease only for the exact test:affected --plan invocation. Every executable test:affected invocation retains the shared zero-wait heavy lease."
  - "The V1 verifier revision advances atomically from ci-verification-v11/sec-verification-v11-* to ci-verification-v12/sec-verification-v12-*. Historical manifests are not mechanically rewritten, retired current-state attempt history is not revision-translated, V11 current artifacts cannot satisfy V12, and V2 composition remains ci-verification-v7."
  - "Current-state startup output contains only reusable stable goal/capability facts; failed candidate, old PR/run/review and diagnostic history no longer re-enters every Context Capsule."
  - "Canonical workflow requires one bounded live snapshot, one agent per owned seam, one candidate epoch, event-driven reload, conditional Gates and standalone long-running commands. A second candidate invalidation forces proof reset to failing reproduction, owner and invariant."
  - "Reconciliation telemetry includes tool_call_count, agent_spawn_count, agent_wait_timeout_count, context_compaction_count and candidate_invalidation_count in addition to existing duration/reload/duplicate-Gate fields."
  - "Focused tests, typecheck, changed-only imports, docs doctor, manifest scope, patch hygiene and exact-head review pass on one frozen candidate."
  - "Because verifier trust-root files change, candidate-hosted evidence cannot self-authorize V12. Integration uses independent exact-head architecture/evidence review and the documented manual bootstrap path."
tests:
  - "affected-focused: bun test tests/unit/test-runner.test.ts tests/unit/heavy-verification-gate-lease.test.ts --timeout 180000"
  - "v12-contract-focused: bun test tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/docs-doctor.test.ts tests/contract/sec-merge-gate.test.ts tests/unit/codex-work-package-contract.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts --timeout 180000"
  - "typecheck: bun run typecheck"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 and SEC_CHANGED_BASE=4eccc767c4dfeae4cd1190b17ceb91864af29f9a with bun run imports:check"
  - "docs-doctor: bun run docs:doctor"
  - "affected-plan: SEC_CHANGED_BASE=4eccc767c4dfeae4cd1190b17ceb91864af29f9a and bun run test:affected --plan"
  - "canonical-affected: SEC_CHANGED_BASE=4eccc767c4dfeae4cd1190b17ceb91864af29f9a and bun run test:affected exactly once on the final exact head"
  - "impacted-risk: one selected ci-verification-v12 Risk execution only after canonical affected PASS"
  - "manual-bootstrap: independent scope, architecture and evidence review plus base-side integration for the V12 trust-root change"
  - "manifest-scope: every base-to-head path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check 4eccc767c4dfeae4cd1190b17ceb91864af29f9a HEAD --"
  - "gitnexus: existing LOW upstream impact for runAffectedTests/affectedTestSelection/dev-runner main, then detect_changes compare against main after final freeze"
---

# 开发吞吐 V12 Bootstrap

## 唯一结果

把已经造成两次“affected PASS 后 Risk 0 Gate 失败”的 ownership 判断前移到同一个 `test:affected` 权威入口，并删除控制面重读、候选 churn、Agent 轮询和重复 Gate 的流程许可。实现不新增 planner、selector、suite registry、Evidence writer或后台服务。

```text
一次 live snapshot
→ proof / owner / invariant
→ implement + focused sentinel
→ test:affected --plan
→ conditional local checks
→ one frozen candidate
→ canonical affected once
→ V12 manual bootstrap and selected Risk once
→ merge readback and cleanup
```

## Context Capsule

- Branch：`codex/development-throughput-v12-bootstrap`
- Base：`main@4eccc767c4dfeae4cd1190b17ceb91864af29f9a`
- Goal：`sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676`
- Prerequisite：live default、本地 default ref、开放 PR/Issue/Review 与 active resolver 已解析；无开放 PR，Issue #132 保持 tracking。
- Authority：changed-path reader、affected inventory、Risk selector、slow-suite registry、heavy lease、V1 Evidence builder均保持唯一 owner；本包只组合现有 authority。
- Gate owner：A0 独占全部本地/hosted Gate 与 integration。
- Candidate epoch：1；只允许一次 focused failure 后的修复 refreeze。第二次 candidate invalidation 返回 `STOP_PROOF_RESET`，不得继续运行昂贵 Gate。
- Reconciliation point：实现与 focused batch完成后冻结一次 exact candidate；Reviewer只审该 exact head。

## Reload if

- live `origin/main` 不再是 `4eccc767c4dfeae4cd1190b17ceb91864af29f9a`。
- Goal combined revision、V1/V2 revision authority、Risk selector或heavy lease合同变化。
- 需要修改任一 forbidden path，或出现第二个 changed-path/ownership/planner/Evidence authority。
- PR head/base/state、CI、Review、unresolved thread或 `REQUEST_CHANGES` 变化。

## Stop

- Risk selector不能在不修改其 canonical ownership语义的前提下提供 fail-fast结果。
- plan路径启动 dependency、test child、Evidence writer或heavy lease。
- 同一 candidate epoch发生第二次失效。
- exact-head Review、Risk或V12人工 bootstrap拒绝候选。
