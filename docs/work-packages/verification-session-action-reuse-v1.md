---
schema: codex-development-work-package-v1
id: verification-session-action-reuse-v1
tracking: issue-311
base: 49fdb7cd3be991742061621e3add982107e50367
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: verification-session-action-reuse-kernel
    owner: verification-control-plane-maintainer
    ownedPaths:
      - docs/work-packages/verification-session-action-reuse-v1.md
      - docs/work-packages/trusted-verifier-causal-closure-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - scripts/codex/verification-session-contract.ts
      - scripts/codex/verification-session.ts
      - scripts/codex/verification-freeze-session.ts
      - scripts/codex/verification-action-contract.ts
      - scripts/codex/verification-action-journal.ts
      - scripts/codex/verification-action-runner.ts
      - tests/unit/verification-freeze-session.test.ts
      - tests/unit/verification-action-contract.test.ts
      - tests/unit/verification-action-journal.test.ts
      - tests/unit/verification-action-runner.test.ts
      - tests/contract/documentation-authority.test.ts
forbiddenPaths:
  - .agents/
  - .github/workflows/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/authority.json
  - docs/archive/
  - docs/evidence/
  - platform/compiler/
  - platform/dev-runner/
  - platform/shared/ci-trust-root-registry.json
  - platform/shared/tcb-closure-lock.ts
  - platform/shared/tcb-trust-root-contract.ts
  - platform/shared/test-impact-rules/
  - platform/shared/ci-evidence-contract.ts
  - platform/shared/ci-evidence-reuse-contract.ts
  - platform/shared/ci-verification-plan.ts
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/sec-merge-bootstrap.ts
  - scripts/codex/sec-merge-bootstrap-runtime.ts
acceptance:
  - 'This slice extends the existing Issue #311 Verification Session foundation; it does not create a second candidate/session/cache/impact/result authority and does not modify the current causal TCB.'
  - 'VerificationAction identity is content-addressed: action kind/producer revision/normalized operation/exact input closure/environment/tool/provider/contract revisions/upstream Action refs determine the ActionKey; branch, PR number, wall-clock, PID and absolute temporary paths do not.'
  - 'A durable local Run Journal records queued/running/terminal/reused/invalidated/cancelled action facts with deterministic parsing, append/readback integrity and corruption/partial-tail rejection; deleting it removes resume optimization but cannot manufacture PASS.'
  - 'The same ActionKey cannot be physically started twice in one live execution domain: an existing running action is joined/read back and a fresh terminal action is reused only when its complete input/trust/environment closure still matches.'
  - 'A failed terminal Action may be reused only as a known failed fact/investigation stop signal; cache/journal reuse can never convert failure, not-run, unsupported, invalidated or unknown into PASS.'
  - 'Changing an input invalidates only actions whose declared input/upstream closure depends on that input; unrelated candidate-tree changes do not globally erase still-valid Action results, and commit-history-only changes with an identical candidate tree do not cause proof reset.'
  - 'Verification action planning makes cheap identity/scope/manifest/trust/selection preflight terminal before an expensive action becomes runnable; this package only proves the pure scheduling contract and does not yet change trusted CI/dev-runner execution.'
  - 'Process/context restart can reconstruct the current action state only from persisted machine journal facts and canonical inputs; hidden Agent reasoning, PR prose and stale local process state are never resume authority.'
  - 'Current CI Evidence reuse remains unchanged in this slice and is treated as a migration consumer for the next trust-aware cutover; no new remote cache, generic CAS, daemon or workflow is introduced.'
  - 'The completed trusted-verifier-causal-closure-v1 manifest is removed when this pointer takes over; Issue #178 remains completed and its TCB/bootstrap results are consumed as existing facts, not reimplemented.'
  - 'Focused positive/negative/corruption/restart/invalidation tests, strict typecheck, docs doctor, repository audit, affected-plan/tests, independent Review, merge and new-main readback are required before this foundation is considered implemented-in-main.'
tests:
  - tests/unit/verification-freeze-session.test.ts
  - tests/unit/verification-action-contract.test.ts
  - tests/unit/verification-action-journal.test.ts
  - tests/unit/verification-action-runner.test.ts
  - tests/contract/documentation-authority.test.ts
---

# verification-session-action-reuse-v1

本包从 `main@49fdb7cd3be991742061621e3add982107e50367` 激活，是 2026-08-08
Development Throughput Acceleration Replan 的第一正式纵切片。

## 为什么现在优先

Issue #327 的物理执行已经证明当前主要瓶颈不是单个测试函数，而是候选变化后
Verification Action 被粗粒度失效、重复启动和反复重跑。一个原本 focused 的
repository-data refactor 在吸收 baseline/verifier 缺陷后扩大到 80+ fast、11 risk，
并触发约 924 秒的 Semantic Mutation integration test。继续先做更多产品/仓库重构，
会持续为缺失的 Action identity、reuse 和 candidate stability 支付同样成本。

## 本包只做什么

本包只扩展现有 `scripts/codex/verification-session*` ordinary-SUT foundation：

```text
FreezeSession / CandidateTree
→ VerificationAction plan
→ content-addressed ActionKey
→ local append/readback Journal
→ execute | join-running | reuse-terminal | invalidate | cancel
→ deterministic terminal projection
```

它不接管 Test Impact、Verification Result、CI Evidence、资源调度、Compiler graph 或
merge authority。下一 trust-aware cutover 包才让现有 TCB consumer 采用这里验证过的
Action identity。

## 性能与正确性的共同不变量

- 同一有效事实只生产一次；速度不能来自少测或把 unknown 当无影响。
- Action reuse 只依赖完整输入闭包，不能依赖 branch、PR、时间或聊天。
- failure 可以复用为“不要盲目再跑”的事实，但永远不能复用成 PASS。
- candidate tree 未改变时，整理 commit history 不得造成全局 Evidence reset。
- 任一输入变化只失效真实依赖它的 Action；未知依赖保守扩大，不能静默缩小。
- expensive Action 前必须先完成 cheap preflight；当前包只冻结这一状态机，不修改
  trusted runner，因此自身不引入新的 bootstrap 成本。
- Journal 是恢复优化而非工程真值；删掉 journal 必须能从 canonical inputs 重建。

## 后继切片

1. `verification-action-trusted-cutover-v1`：#311/#179/#178，把统一 Action identity
   接入现有 CI Evidence reuse / dev-runner / VerificationSession，并建立 candidate scope
   stability 与 MainHealth repair lane。
2. `semantic-impact-failure-routing-v1`：#188/#177/#205/#176，建立昂贵测试因果 witness、
   stable failure fingerprint、retry precondition 和 unrelated failure 路由。
3. `feedback-scheduler-hermetic-runtime-v1`：#189/#190/#316，revision cancellation、
   duration/resource scheduling、workspace/process/cache/browser settlement。
4. `compiler-incremental-toolchain-v1`：#194/#296/#312/#193/#316，Compiler incremental
   node reuse、共享 Source Program/Observation 与经 Evidence 支持的 TS7/toolchain 提速。

这些包必须从 each then-latest `main` 重算，不预建 stacked candidate，也不使用
validation branch/PR 作为 CI 参数或 patch 运输载体。
