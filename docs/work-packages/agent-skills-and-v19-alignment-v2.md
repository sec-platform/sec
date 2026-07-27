---
schema: codex-development-work-package-v1
id: agent-skills-and-v19-alignment-v2
tracking: issue-132
base: 3f0df59e31e0bf5c39c5ce774c2abb8ccbfbb1df
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v17
tasks:
  - id: compile-repository-heuristics-into-agent-skills
    owner: a0
    ownedPaths:
      - .agents/skills/sec-a0-integrator/SKILL.md
      - .agents/skills/sec-ci-and-merge/SKILL.md
      - .agents/skills/sec-context-resume/SKILL.md
      - .agents/skills/sec-documentation-governance/SKILL.md
      - .agents/skills/sec-exact-head-review/SKILL.md
      - .agents/skills/sec-external-capability-governance/SKILL.md
      - .agents/skills/sec-failure-recovery/SKILL.md
      - .agents/skills/sec-impact-and-validation/SKILL.md
      - .agents/skills/sec-repository-orientation/SKILL.md
      - .agents/skills/sec-task-delegation/SKILL.md
      - .agents/skills/sec-toolchain-and-dependencies/SKILL.md
      - .agents/skills/sec-trust-root-bootstrap/SKILL.md
      - .agents/skills/sec-work-package-lifecycle/SKILL.md
      - .agents/skills/sec-worker-development/SKILL.md
      - .agents/skills/sec_a0_integrator/SKILL.md
      - .agents/skills/sec_ci_and_merge/SKILL.md
      - .agents/skills/sec_work_package_lifecycle/SKILL.md
      - .agents/skills/sec_worker_development/SKILL.md
      - AGENTS.md
      - docs/00-文档索引与一致性规则.md
      - docs/evidence/2026-07-27-markdown-docs-analysis.md
      - docs/governance/agent-skills-and-development-run-kernel.md
      - docs/work-packages/agent-skills-and-v19-alignment-v2.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - package.json
      - platform/shared/agent-skill-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - scripts/cleanup-mcp.ps1
      - tests/contract/agent-skills.test.ts
      - tests/contract/repository-runtime.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - docs/04-AI自主实现执行蓝图.md
  - docs/scripts/docs-doctor.ts
  - platform/compiler/
  - platform/dev-runner/
  - platform/orchestrator/
  - scripts/codex/
  - tests/e2e/
acceptance:
  - "The repository contains exactly fourteen strict AgentOperation Skills; every Skill declares trigger, exclusion, input, path/permission boundary, allowed tools, prerequisite gates, execution, completion evidence, stop/recovery, prohibited shortcuts and canonical authority in one fixed order."
  - "Every tracked Markdown file is classified as Skill, projection, active authority, frozen Work Package, Evidence, historical material, verification fixture or repository content; every active/projection/repository-content surface has Skill coverage."
  - "Every known repository heuristic runtime surface resolves at least one Skill owner while deterministic product implementation remains owned by code and canonical contracts."
  - "The V19 authority defines stable runId, Git common-directory state, prompt intake, event-level checkpointing, phase-plus-lock recovery, Hook limits and the WP-A/WP-B trust-epoch sequence without claiming hidden-state losslessness."
  - "Graph-It-Live and GitNexus MCP entrypoints, .mcp.json and the obsolete MCP cleanup script are retired; GitNexus analyze/status and Graphify CLI remain available."
  - "No Skill instructs hard reset, force push, unsupported manifest/pointer states, evidence reuse across heads, unconditional Issue closure, scope expansion without authorization or candidate self-authorization."
  - "Skill, retired-tooling and documentation-cleanup paths have explicit focused test-impact ownership; package and verification trust-root changes retain mandatory bounded Risk selection."
  - "Because package and verifier trust-root inputs change, the candidate uses independent exact-head Review and trusted base-side manual bootstrap, then returns TASK_RESTART_REQUIRED."
tests:
  - "bun test tests/contract/agent-skills.test.ts tests/contract/docs-doctor.test.ts tests/contract/test-impact.test.ts tests/contract/repository-runtime.test.ts tests/unit/ci-pr-risk-selection.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run imports:freeze"
---

# Agent Skills 与 V19 对齐 V2

本包把直接写入 main 的四个提示式 Skill 重建为覆盖仓库启发式行为的 AgentOperation 系统，并将 V19 可验证确定性续跑作为后续 Kernel/Hook 实施的唯一架构 authority。

确定性事实、算法、状态和验证仍由代码、canonical docs、manifest、Evidence 与未来 Development Run Kernel 拥有；Skill 只编译“何时触发、如何选择、怎样回退、何时停止”的启发式决策。全仓库和全部 Markdown 的覆盖由机器合同扫描，不靠人工宣称。

本包同时按用户最新决策正式退役 Graph-It-Live 与 GitNexus MCP 入口，但保留 GitNexus analyze/status 与 Graphify CLI。完成后执行 trust-root manual bootstrap；新 main 必须重启任务，再按 rolling plan进入 Kernel Shadow 与 Hook Activation。
