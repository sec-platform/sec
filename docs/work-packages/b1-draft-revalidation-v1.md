---
schema: codex-development-work-package-v1
id: b1-draft-revalidation-v1
tracking: none
base: ae815e27f9dff98c9af18cb1d70ab6fdb98863a0
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: b1-control-plane
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/04-AI自主实现执行蓝图.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/b1-draft-revalidation-v1.md
      - platform/shared/ci-verification-plan.ts
      - scripts/ci-pr-risk.ts
      - scripts/ci-verification.ts
      - scripts/codex/merge-gate.ts
      - scripts/codex/work-package-contract.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
forbiddenPaths:
  - AGENTS.md
  - PLANS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/03-MVP实施计划与路线图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/work-packages/b0-bootstrap-v1.md
  - platform/cli/
  - platform/compiler/
  - platform/orchestrator/
  - platform/policies/
  - platform/registry/
  - platform/upgrade/
  - source/
acceptance:
  - "Draft-only heads selected by plan-revalidation receive an explicit failing sec/merge-gate status without entering the executable revalidation matrix."
  - "Push, schedule, and pull-request planning with only Draft pull requests completes successfully with an empty merge-gate matrix."
  - "A head shared by multiple open pull requests receives one deterministic failing status and never enters the executable matrix."
  - "Non-Draft same-repository exact-head planning, pending invalidation, cancellation, artifact validation, and final success rules remain unchanged."
  - "The current CI contract and all verification artifact identities advance to ci-verification-v5; v4 evidence cannot satisfy a v5 gate."
  - "The Work Package parser preserves historical frozen revision metadata, while risk, verification, attestation, and merge-gate entrypoints explicitly require the current revision."
  - "B1 is manually integrated as a trust-root bootstrap and cannot use candidate v5 code to self-verify."
  - "B1 changes no product runtime, compiler, Engineering IR, dependency, roadmap, or repository-level Agent contract."
tests:
  - "bun test tests/unit/codex-work-package-contract.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/sec-merge-gate.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "git diff --check"
---

# B1 Draft Revalidation Bootstrap V1

B1 修复 `ci-verification-v4` 首次进入 `main` 后暴露的真实 revalidator 边界：全局 `push / schedule` planner 曾把 Draft PR 放入只允许非 Draft PR 成功的 merge-gate matrix，导致存在正常 Draft 工作时整个轻量 revalidator 失败。

Draft 是 SEC 的早期可见性与短反馈工具，不是异常状态。`plan-revalidation` 必须把“写入不可合并 status”和“启动 exact-head gate execution”分开：Draft-only head 直接得到 failing `sec/merge-gate`，但不分配 matrix runner；共享同一 head 的多个 open PR 同样确定性 failure；只有唯一的非 Draft same-repository head 才进入 artifact revalidation。由于修复触及 verifier trust root，本包升级为 `ci-verification-v5`，并继续使用人工 bootstrap，而不是由候选 verifier 自证。
