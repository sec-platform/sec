---
schema: codex-development-work-package-v1
id: agent-skills-hardening-v1
tracking: issue-132
base: 3f0df59e31e0bf5c39c5ce774c2abb8ccbfbb1df
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v17
tasks:
  - id: harden-agent-skills-and-repair-control-plane
    owner: a0
    ownedPaths:
      - .agents/skills/sec_a0_integrator/SKILL.md
      - .agents/skills/sec_ci_and_merge/SKILL.md
      - .agents/skills/sec_work_package_lifecycle/SKILL.md
      - .agents/skills/sec_worker_development/SKILL.md
      - .agents/skills/sec-a0-integrator/SKILL.md
      - .agents/skills/sec-ci-and-merge/SKILL.md
      - .agents/skills/sec-work-package-lifecycle/SKILL.md
      - .agents/skills/sec-worker-development/SKILL.md
      - .mcp.json
      - AGENTS.md
      - docs/evidence/2026-07-27-markdown-docs-analysis.md
      - docs/work-packages/agent-skills-hardening-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/shared/test-impact-rules/governance.ts
      - tests/contract/agent-skills.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - docs/scripts/docs-doctor.ts
  - package.json
  - platform/compiler/
  - platform/dev-runner/
  - platform/orchestrator/
  - scripts/codex/
  - tests/e2e/
acceptance:
  - "The four repository skills use strict lowercase hyphenated Agent Skills identities matching their parent directories and describe both trigger and exclusion boundaries."
  - "A0 dispatch examples carry every exact client_payload key required by the current Scope and frozen Verification workflows."
  - "No skill instructs hard reset, force push, pre-merge head rewriting, unsupported Work Package schema, unsupported pointer none state, or unconditional Issue closure."
  - "Every changed Agent Skill, .mcp.json, and removed machine-local report path resolves to one explicit focused test-impact owner."
  - "The active pointer, rolling plan, and selected Work Package resolve together; only non-selected historical Work Packages are archived."
  - "The tracked MCP configuration required by the repository-runtime contract is restored byte-for-byte and the machine-local narrative report is removed."
  - "Because test-impact authority changes, the candidate uses independent exact-head review and trusted base-side manual bootstrap rather than candidate self-authorization."
tests:
  - "bun test tests/contract/agent-skills.test.ts tests/contract/docs-doctor.test.ts tests/contract/test-impact.test.ts tests/contract/repository-runtime.test.ts tests/unit/ci-pr-risk-selection.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run imports:freeze"
---

# Agent Skills Hardening V1

本包修复直接写入 `main` 的技能矩阵提交所造成的可执行回归：selected Work Package 被移动后 pointer 悬空、`.mcp.json` 被无证据删除、四个 Skill 不符合 Agent Skills identity 规范，并包含会使 frozen Evidence 失效或破坏未审计工作的命令。

最终结果是四个窄职责 Skill、一个机器合同测试、明确 test-impact owner 与重新闭合的三个控制面。Skill 只投影现有 SEC authority，不建设第二套开发状态机、Gate planner 或完整 V19 Kernel。
