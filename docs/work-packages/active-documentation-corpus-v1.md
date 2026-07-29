---
schema: codex-development-work-package-v1
id: active-documentation-corpus-v1
tracking: issue-173
base: c289a44609a3502140ede55857d90109d4db744f
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v18
tasks:
  - id: rebuild-document-authority
    owner: documentation-authority-worker
    ownedPaths:
      - AGENTS.md
      - README.md
      - .agents/skills/sec-a0-integrator/SKILL.md
      - .agents/skills/sec-architecture-evolution/SKILL.md
      - .agents/skills/sec-ci-and-merge/SKILL.md
      - .agents/skills/sec-context-resume/SKILL.md
      - .agents/skills/sec-documentation-governance/SKILL.md
      - .agents/skills/sec-exact-head-review/SKILL.md
      - .agents/skills/sec-external-capability-governance/SKILL.md
      - .agents/skills/sec-failure-recovery/SKILL.md
      - .agents/skills/sec-heuristic-governance/SKILL.md
      - .agents/skills/sec-impact-and-validation/SKILL.md
      - .agents/skills/sec-repository-audit/SKILL.md
      - .agents/skills/sec-repository-orientation/SKILL.md
      - .agents/skills/sec-task-delegation/SKILL.md
      - .agents/skills/sec-toolchain-and-dependencies/SKILL.md
      - .agents/skills/sec-trust-root-bootstrap/SKILL.md
      - .agents/skills/sec-work-package-lifecycle/SKILL.md
      - .agents/skills/sec-worker-development/SKILL.md
      - docs/
      - platform/shared/active-documentation-contract.ts
      - platform/shared/agent-skill-contract.ts
      - platform/shared/ci-pr-risk-selection.ts
      - platform/shared/documentation-authority-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - tests/contract/agent-skills.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/unit/active-documentation-contract.test.ts
      - tests/unit/ci-pr-risk-selection.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - package.json
  - platform/compiler/
  - platform/orchestrator/
  - platform/shared/ci-contract.ts
  - platform/shared/contract-freeze-contract.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/merge-gate.ts
  - tests/e2e/
acceptance:
  - "Documentation identity, lifecycle and ownership are parsed from one machine registry; no active authority is inferred from filename or catch-all."
  - "The historical numbered corpus and superseded governance/test prose are archived byte-for-byte at their latest main content and removed from active authority."
  - "Each stable fact and design invariant has exactly one active prose owner; navigation, projection, proposal, ledger and control documents cannot compete."
  - "Portable lease, verifier v18 and fast-runner results already in main are read back and retained without copying their implementation into documentation."
  - "Target IR, incremental compiler, Verification phases, Engineering Workspace domains, Brownfield, Workbench/AI, runtime, release, operations and security retain explicit boundaries and promotion conditions."
  - "Stable authorities reject current SHA, PR, run and blocker facts; dynamic state remains in live control or machine ledgers."
  - "README and docs/README expose at most five primary entrypoints and do not copy current capability inventories."
  - "docs-doctor validates registry schema, owner uniqueness, projections, generated index, lifecycle, links, Unicode, dynamic-fact boundaries and the active Work Package."
  - "Unknown active Markdown fails closed; archive, evidence, proposal and frozen Work Package lifecycle remain distinct."
  - "Agent Skills reference the new authorities and retain one-to-one behavior ownership while preserving trusted resolver, optional impact and failure-reuse invariants."
  - "All focused contracts, typecheck, docs doctor, repository audit, imports and required hosted evidence pass on one single-parent candidate."
tests:
  - "bun test tests/contract/docs-doctor.test.ts tests/contract/agent-skills.test.ts tests/contract/ci-lanes.test.ts tests/unit/active-documentation-contract.test.ts tests/unit/ci-pr-risk-selection.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run audit:repository"
  - "bun run check:affected --plan"
  - "bun run imports:freeze"
---

# Active Documentation Corpus V1

本包以 machine authority registry 替换历史编号和路径 catch-all，原子迁移全部 active prose，并把旧正文按 latest main bytes 归档。它同时完成 PR #174 合并后的控制面 readback，但不实现 Issues #176–#194 的产品能力。Candidate 改变 docs-doctor、active-documentation、Agent coverage 与 Risk selection trust roots，不能由自身实现自证；进入 main 后必须 readback、关闭 Issue #173 并返回 TASK_RESTART_REQUIRED。
