---
schema: codex-development-work-package-v1
id: verification-action-kernel-finalization-v1
tracking: issue-311
base: 37c8609d5d54b5fb74292cffc83bd7dfcc362988
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: verification-action-kernel-finalization
    owner: verification-control-plane-maintainer
    ownedPaths:
      - docs/work-packages/verification-action-kernel-finalization-v1.md
      - docs/work-packages/verification-session-action-reuse-t1-1-defect-closure-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - scripts/codex/verification-action-contract.ts
      - scripts/codex/verification-action-journal.ts
      - scripts/codex/verification-action-runner.ts
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
  - 'This is the final ordinary-SUT action-kernel closure after PR #338. It does not enter the trusted TCB and does not start the T2 trust-root migration.'
  - 'A live-flight owner identity is ownerToken plus ActionKey; changing executionDomain cannot bypass same-owner cycle detection, while independent external callers still join one process-wide physical flight.'
  - 'The runner reads the complete dependency closure before physical execution and again after execution. It commits terminal only when every declared dependency is still terminal-passed and the action has not been invalidated or cancelled; otherwise the physical result is discarded fail-closed.'
  - 'ActionKey and ActionPlan creation accept only strict ordinary data: canonical Object.prototype records, canonical arrays, enumerable data properties, no symbols/accessors/toJSON/noncanonical prototypes/proxies/cycles, and no serializer-driven identity.'
  - 'ActionKey and Plan wire schemas advance to V2. The V1 journal namespace and V1 event records are never reused; disposable old journals are deterministically ignored or rejected before any V2 projection.'
  - 'executionClass is removed from ActionKey identity because it is scheduling/cost policy, not result-changing semantic closure. Cheap-before-expensive authorization is expressed only by the producer-owned requiredCheapPreflightActionKeys topology; Plan may carry a validated scheduling lane without changing ActionKey.'
  - 'Focused adversarial identity, ordinary-data, schema-migration, reentrancy, dependency-race, invalidation, reuse and corruption tests pass; strict typecheck, docs doctor, repository audit, affected plan/tests, independent exact-head Review with a machine-visible receipt, required Gate, merge and new-main readback are required.'
  - 'T2 trusted cutover owns trust-root migration, Review-Stable Barrier, physical merge authorization, CI Evidence reuse integration, VerificationSession adoption and admin-bypass retirement; all remain outside this package.'
tests:
  - tests/unit/verification-action-contract.test.ts
  - tests/unit/verification-action-journal.test.ts
  - tests/unit/verification-action-runner.test.ts
  - tests/contract/documentation-authority.test.ts
---

# verification-action-kernel-finalization-v1

本包从已完成 tree readback 的 `main@37c8609d5d54b5fb74292cffc83bd7dfcc362988`
重新冻结。#338 已正确合并，但 post-merge 旁路审计证明 ordinary action kernel 仍有四个
SUT seam：owner cycle identity 被 `executionDomain` 分割、terminal commit 没有复核完整
dependency closure、Action/Plan 没有严格 ordinary-data boundary，以及 V1 schema 已经
发生不兼容演进却仍复用 disposable journal。

本包只修这四个 seam，并作一个架构裁决：`executionClass` 是调度/成本策略，不是
ActionKey 的结果语义；从 ActionKey 移除它，cheap-before-expensive 授权只由
`requiredCheapPreflightActionKeys` 这个 producer-owned topology 表达。Plan 仍可携带
经过验证的 scheduler lane，但 lane 变化不会使同一语义 ActionKey 失效。

## 后继

只有本包在新 `main` 完成 Review receipt、Gate 和 readback 后，才可冻结
`verification-action-trusted-cutover-v1`。T2 一次性承担 trust-root migration、
Review-Stable Barrier、physical merge authorization、CI Evidence/VerificationSession
接线及 `--admin` bypass 退役；不在本包提前修改这些 authority。
