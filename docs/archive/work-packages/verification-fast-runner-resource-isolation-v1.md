---
schema: codex-development-work-package-v1
id: verification-fast-runner-resource-isolation-v1
tracking: issue-176
base: a490a42f5bc8c1b834aad6560360888411cb45c9
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v18
tasks:
  - id: switch-control-plane
    owner: a0
    ownedPaths:
      - docs/archive/work-packages/development-feedback-loop-hardening-v1.md
      - docs/work-packages/development-feedback-loop-hardening-v1.md
      - docs/work-packages/verification-fast-runner-resource-isolation-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
  - id: freeze-fast-runner-resource-isolation
    owner: dev-runner-worker
    ownedPaths:
      - docs/test-architecture.md
      - platform/dev-runner/fast-test-policy.ts
      - tests/unit/test-runner.test.ts
forbiddenPaths:
  - .github/
  - .agents/
  - AGENTS.md
  - bun.lock
  - package.json
  - docs/04-AI自主实现执行蓝图.md
  - docs/test-feedback-and-ci-lanes.md
  - platform/compiler/
  - platform/shared/
  - scripts/
  - tests/e2e/
  - tests/integration/semantic-mutation-apply.test.ts
  - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
acceptance:
  - "Fast process isolation declares one machine-owned resource class per registered suite, and scheduling is derived from that class rather than maintained as an independent competing fact."
  - "Suites that execute production host, browser or runtime lifecycle are exclusive; tests whose mutable state is completely run-owned remain bounded-parallel."
  - "The SM-3 production apply suite cannot share an affected runner wave with recovery or other isolated suites, while the bounded concurrency caps, default inventory exclusions and complete inventory remain unchanged."
  - "Planner and runner preserve every selected file exactly once, wait for already-started siblings, stop after nonzero failure and retain the existing final summary/exit semantics."
  - "The package is only the runner-resource prerequisite exposed by PR #174; it does not claim the remaining verification-result ledger scope of Issue #176."
  - "All base-to-candidate changed paths have exactly one manifest owner and no forbidden intersection; the candidate is single-parent, clean and based on current main."
  - "Because the candidate changes the dev-runner verifier trust root, it requires independent exact-head Review and trusted-base bootstrap before merge."
tests:
  - "bun test tests/unit/test-runner.test.ts tests/contract/dev-runner-contract.test.ts tests/contract/test-architecture.test.ts tests/contract/test-impact.test.ts tests/unit/ci-pr-risk-selection.test.ts --timeout 180000"
  - "bun test tests/contract/sec-merge-gate.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run audit:repository"
  - "bun run imports:freeze"
---

# Fast Runner 资源隔离 V1

本包只修复 PR #174 暴露的 affected runner 调度真值缺口：进程隔离不能替代共享 host/runtime 资源隔离。资源类别成为唯一机器事实，调度结果从类别确定性推导；真实 production host/runtime suite 保持独占，完全绑定 run-owned mutable state 的 suite 继续有界并行。

本包不实现 Issue #176 的 Gate result ledger、platform execution ledger、skip 状态或空选择闭包，也不修改 workspace lease、Semantic Mutation 产品实现、CI workflow、merge authority 或 package/toolchain。
