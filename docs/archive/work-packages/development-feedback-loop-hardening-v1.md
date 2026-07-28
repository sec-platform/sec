---
schema: codex-development-work-package-v1
id: development-feedback-loop-hardening-v1
tracking: issue-132
base: 1ff00a3883991f5eaf696d29b6d28504b96791b0
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v18
tasks:
  - id: switch-control-plane
    owner: a0
    ownedPaths:
      - docs/archive/work-packages/isolated-runtime-bundle-layout-v1.md
      - docs/work-packages/development-feedback-loop-hardening-v1.md
      - docs/work-packages/isolated-runtime-bundle-layout-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
  - id: harden-development-feedback-loop
    owner: development-flow-worker
    ownedPaths:
      - AGENTS.md
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - .agents/skills/sec-failure-recovery/SKILL.md
      - .agents/skills/sec-impact-and-validation/SKILL.md
      - .agents/skills/sec-repository-orientation/SKILL.md
      - .agents/skills/sec-toolchain-and-dependencies/SKILL.md
      - docs/04-AI自主实现执行蓝图.md
      - docs/governance/agent-skills-and-development-run-kernel.md
      - platform/shared/agent-skill-contract.ts
      - platform/shared/ci-verification-plan.ts
      - platform/shared/project-runtime.ts
      - platform/shared/test-impact-rules/verification.ts
      - scripts/ci-pr-risk.ts
      - scripts/ci-verification.ts
      - scripts/codex/ci-orchestration-core.ts
      - tests/contract/agent-skills.test.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/test-impact.test.ts
      - tests/integration/compiler-dependency-installation.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/ci-verification-v7-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
forbiddenPaths:
  - bun.lock
  - package.json
  - docs/03-MVP实施计划与路线图.md
  - docs/05-编译器核心实现规格.md
  - docs/13-部署、发布与运维手册.md
  - docs/governance/runtime-and-environment-policy.md
  - platform/compiler/
  - platform/shared/collections.ts
  - platform/shared/composition-baseline.ts
  - platform/shared/project-baseline.ts
  - platform/shared/project-integrity-baseline.ts
  - scripts/codex/merge-gate.ts
  - tests/e2e/
acceptance:
  - "The speculative Bun-only runtime policy is not promoted; Issue #167 remains the runtime authority until a dedicated package closes Node and Bun physical support."
  - "CI Risk and Quick/Full share one orchestration authority for Git revision, clean-tree checks, changed paths, process output digests, bounded failure tails and V2 not-run evidence without changing gate order; V1 verification identity advances atomically from v17 to v18 while historical artifacts and Work Packages remain immutable."
  - "Changed-record discovery consumes the already resolved PR base SHA, so a symbolic SEC_CHANGED_BASE cannot move between revision resolution and the one immutable Git observation."
  - "The shared CI orchestration module is covered by trust-root dispatch, test-impact ownership and focused execution tests."
  - "Compiler dependency staging uses a collision-safe bounded directory component independent of the full manifest hash and UUID so long Windows worktree paths do not cause native package extraction failures."
  - "Repository orientation never executes a stale default-branch resolver as current authority; unavailable optional impact tooling does not trigger dynamic package resolution; unchanged infrastructure failures are not retried."
  - "The original dirty worktree remains byte-for-byte untouched, and low-value Prisma/baseline refactors, lodash runtime expansion and weakened assertions are excluded from the candidate."
  - "All base-to-candidate changed paths have exactly one manifest owner and no forbidden intersection; the final candidate is clean and based on current main."
  - "Because the candidate changes verifier, dependency bootstrap and Agent Skill trust roots, it requires independent exact-head Review and trusted-base bootstrap before merge."
tests:
  - "bun test tests/integration/compiler-dependency-installation.test.ts --timeout 180000"
  - "bun test tests/unit/codex-work-package-contract.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts tests/unit/ci-verification-v7-execution.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/contract/agent-skills.test.ts tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/sec-merge-gate.test.ts tests/contract/test-impact.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run audit:repository"
  - "bun run imports:freeze"
---

# 开发反馈环硬化 V1

本包只吸收本地候选中能够缩短并稳定 SEC 开发反馈环的闭包：统一 Risk 与 Quick/Full 的重复进程编排，根治 Windows 长 worktree 下 compiler dependency staging 的路径膨胀，并把本轮已实际触发的 stale resolver、动态工具解析和重复基础设施重试约束收敛到既有 Skill owner。

本包不实现 Issue #167 的 runtime architecture，也不把 “Bun-only” spike 升格为正式政策；不相关且无可测收益的 Prisma/baseline 整理、`lodash-es` 扩张和测试信息弱化均不进入候选。
