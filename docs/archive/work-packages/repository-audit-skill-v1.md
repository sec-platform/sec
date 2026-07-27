---
schema: codex-development-work-package-v1
id: repository-audit-skill-v1
tracking: issue-132
base: 9043b7f0e22f9437a85bae59726456eb57ceb874
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v17
tasks:
  - id: audit-and-compile-repository-behaviors
    owner: a0
    ownedPaths:
      - .agents/skills/sec-architecture-evolution/SKILL.md
      - .agents/skills/sec-heuristic-governance/SKILL.md
      - .agents/skills/sec-repository-audit/SKILL.md
      - AGENTS.md
      - docs/00-文档索引与一致性规则.md
      - docs/04-AI自主实现执行蓝图.md
      - docs/05-编译器核心实现规格.md
      - docs/archive/work-packages/agent-skills-and-v19-alignment-v2.md
      - docs/archive/work-packages/project-runtime-owner-split-v1.md
      - docs/governance/agent-skills-and-development-run-kernel.md
      - docs/work-packages/agent-skills-and-v19-alignment-v2.md
      - docs/work-packages/project-runtime-owner-split-v1.md
      - docs/work-packages/repository-audit-skill-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - package.json
      - platform/shared/agent-skill-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - scripts/codex/repository-audit.ts
      - scripts/discover-all.ts
      - tests/contract/agent-skills.test.ts
      - tests/contract/discover-all.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/repository-audit.test.ts
      - tests/contract/sandbox-architecture-contract.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - docs/scripts/docs-doctor.ts
  - platform/compiler/
  - platform/dev-runner/
  - platform/orchestrator/
  - tests/e2e/
acceptance:
  - "The repository contains exactly seventeen strict AgentOperation Skills and seventeen machine-registered repository behaviors with a one-to-one owner mapping."
  - "Full repository analysis is a distinct sec-repository-audit Skill and a deterministic tracked-path audit command; repository orientation remains a minimal-context operation."
  - "New heuristic clauses are triaged by sec-heuristic-governance, deterministic rules stay in code/contracts, and architecture/contract evolution has a separate sec-architecture-evolution closure."
  - "Every tracked path is classified from one clean exact HEAD tree; only .md paths enter Markdown lifecycles; active Markdown and registered heuristic runtime surfaces have explicit Skill ownership."
  - "Chinese and English Agent directives are extracted into an inspectable path/line/text/Skill candidate ledger; unowned candidates and unknown inputs fail the default audit without promoting test names or historical examples to authority."
  - "docs/04 is reduced to stable protocol and Skill routing; detailed execution, failure, merge and recovery algorithms are not duplicated there."
  - "All stale completed Work Packages are archived, the new pointer/rolling plan agree on one live manifest, and the repository audit has no critical or high finding."
  - "Runtime dependency identity is owned only by platform/shared/runtime-dependency-spec.ts; sandbox tests consume that authority instead of maintaining a second array."
  - "discover-all declares its repository scope, scans platform and scripts TypeScript, uses SHA-256 and emits one typed relation for every CallExpression without silent truncation."
  - "Dead ownership declarations for deleted MCP cleanup/report paths are removed; focused test ownership includes repository audit."
  - "Because package, Agent governance and verifier trust-root inputs change, the candidate requires independent exact-head Review and trusted base-side manual bootstrap, then returns TASK_RESTART_REQUIRED."
tests:
  - "bun test tests/contract/agent-skills.test.ts tests/contract/discover-all.test.ts tests/contract/repository-audit.test.ts tests/contract/docs-doctor.test.ts tests/contract/test-impact.test.ts tests/contract/sandbox-architecture-contract.test.ts tests/unit/ci-pr-risk-selection.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run audit:repository"
  - "bun run imports:freeze"
---

# 全仓库审计、行为抽取与 Skill 闭包 V1

本包对 exact main 执行 tracked-path、authority、owner、入口、状态、验证和启发式行为审计，把全仓分析、启发式抽取和跨 owner 架构演进建立为三个独立 AgentOperation，并删除文档、测试和脚本中的重复行为 authority。

审计输出只作 exact-revision Evidence；确定性产品事实继续由代码、contract、canonical docs、manifest 和验证拥有。候选修改 verifier/toolchain trust root，不能自证。
