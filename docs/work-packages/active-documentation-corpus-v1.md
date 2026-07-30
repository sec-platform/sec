---
schema: codex-development-work-package-v1
id: active-documentation-corpus-v1
tracking: issue-173
base: 26038512efd9673fc96065bb7b25c544739ad281
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: rebuild-document-authority
    owner: documentation-authority-worker
    ownedPaths:
      - AGENTS.md
      - README.md
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
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
      - platform/shared/ci-evidence-reuse-contract.ts
      - platform/shared/ci-pr-risk-selection.ts
      - platform/shared/ci-verification-plan.ts
      - platform/shared/ci-verification-revision.ts
      - platform/shared/documentation-authority-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - platform/shared/test-impact-rules/verification.ts
      - platform/shared/test-ownership-contract.ts
      - scripts/codex/merge-gate.ts
      - scripts/codex/work-package-contract.ts
      - scripts/ci-verification.ts
      - tests/contract/agent-skills.test.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/document-control-plane-lifecycle.test.ts
      - tests/contract/documentation-authority.test.ts
      - tests/contract/docs-doctor-ledgers.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/active-documentation-contract.test.ts
      - tests/unit/agent-skill-markdown-classification.test.ts
      - tests/unit/ci-evidence-contract-v3.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-evidence-reuse-contract.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-pr-risk-selection.test.ts
      - tests/unit/ci-verification-composition-execution.test.ts
      - tests/unit/ci-verification-v7-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
      - tests/unit/install-git-hooks.test.ts
      - tests/unit/local-gate-union.test.ts
      - tests/unit/work-package-gate-contract.test.ts
  - id: restore-fast-test-timeout-authority
    owner: fast-test-harness-worker
    ownedPaths:
      - platform/dev-runner/fast-test-policy.ts
      - tests/integration/p0-2a-ir-invariants.test.ts
      - tests/unit/test-runner.test.ts
  - id: isolate-workspace-local-state-path
    owner: runtime-path-worker
    ownedPaths:
      - platform/shared/paths.ts
      - platform/shared/test-impact-rules/semantic.ts
      - platform/shared/workspace-path-contract.ts
      - platform/shared/workspace-write-lease.ts
forbiddenPaths:
  - bun.lock
  - package.json
  - platform/compiler/
  - platform/orchestrator/
  - platform/shared/ci-contract.ts
  - platform/shared/contract-freeze-contract.ts
  - scripts/codex/document-control-plane-contract.ts
  - tests/e2e/
acceptance:
  - "Documentation identity, lifecycle and ownership are parsed from one machine registry; no active authority is inferred from filename or catch-all."
  - "The registry parser reuses the canonical repository-path predicate, rejects case-insensitive physical aliases, and checks projects plus generatedFrom through one acyclic dependency graph."
  - "The historical numbered corpus and superseded governance/test prose are archived byte-for-byte at their latest main content and removed from active authority."
  - "Changed-record scope preserves same-owner Git copy lineage while rejecting duplicate records, ambiguous destinations, cross-owner endpoints and case-insensitive path collisions."
  - "Active composition-verification runtime diagnostics are revision-neutral; historical revision literals remain only in explicit negative or compatibility fixtures."
  - "Each stable fact and design invariant has exactly one active prose owner; navigation, projection, proposal, ledger and control documents cannot compete."
  - "Portable lease, verifier v18 and fast-runner results already in main are read back and retained without copying their implementation into documentation."
  - "Target IR, incremental compiler, Verification phases, Engineering Workspace domains, Brownfield, Workbench/AI, runtime, release, operations and security retain explicit boundaries and promotion conditions."
  - "Stable authorities reject current SHA, PR, run and blocker facts; dynamic state remains in live control or machine ledgers."
  - "Machine-local absolute inline paths are fatal documentation errors, while ordinary filenames remain outside repository-path inference."
  - "README and docs/README expose at most five primary entrypoints and do not copy current capability inventories."
  - "docs-doctor validates registry schema, owner uniqueness, projections, generated index, lifecycle, links, Unicode, dynamic-fact boundaries, complete machine-ledger claims and the active Work Package."
  - "Unknown root Markdown and unregistered docs content fail closed before generic source-kind classification; archive, evidence, proposal and frozen Work Package lifecycle remain distinct."
  - "Agent Skills reference the new authorities and retain one-to-one behavior ownership while preserving trusted resolver, optional impact and failure-reuse invariants."
  - "Hook execution remains owned by executable Hook and Skill contracts; the root AGENTS router does not duplicate import-freeze algorithms."
  - "Local Gate planning follows the active documentation registry, and Test Impact permanently selects its Gate-union sentinel when that registry or projection changes."
  - "Every new verifier runtime dependency is an exact canonical trust root projected identically into both validation workflows and the base-side closure contract."
  - "Fast-runner tests isolate ambient Gate workspace identity, prove fallback namespace generation only when no explicit namespace exists, and preserve a caller-provided safe namespace through execution and cleanup."
  - "Windows AppContainer executor and host-tool lifecycle tests are registered as shared-host-runtime exclusive resources, never enter concurrent shards, and retain their production timing and lifecycle assertions unchanged."
  - "Semantic invariant setup preserves every IR assertion while using the canonical fast-test timeout policy as its sole timing authority; correctness tests do not embed an independent wall-clock performance budget."
  - "Workspace local-state paths have one runtime-layout-free leaf authority; general path projection and the workspace lease consume that leaf without pulling compiler runtime layout into staged native-helper bundles."
  - "The exact production native-helper bundle self-boots from an arbitrary staged path, while workspace lease placement and AppContainer path containment remain unchanged."
  - "Historical Work Package gate fixtures read immutable bytes from the canonical archive while preserving their original logical manifest paths, digests, parser bindings and assertions."
  - "All focused contracts, typecheck, docs doctor, repository audit, imports and required hosted evidence pass on one single-parent candidate."
tests:
  - "bun test tests/contract/docs-doctor.test.ts tests/contract/docs-doctor-ledgers.test.ts tests/contract/agent-skills.test.ts tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/documentation-authority.test.ts tests/contract/document-control-plane-lifecycle.test.ts tests/contract/sec-merge-gate.test.ts tests/contract/test-impact.test.ts tests/integration/p0-2a-ir-invariants.test.ts tests/unit/active-documentation-contract.test.ts tests/unit/agent-skill-markdown-classification.test.ts tests/unit/ci-evidence-contract-v3.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-evidence-reuse-contract.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-pr-risk-selection.test.ts tests/unit/ci-verification-composition-execution.test.ts tests/unit/ci-verification-execution.test.ts tests/unit/codex-work-package-contract.test.ts tests/unit/install-git-hooks.test.ts tests/unit/local-gate-union.test.ts tests/unit/test-runner.test.ts tests/unit/work-package-gate-contract.test.ts --timeout 180000"
  - "bun test tests/unit/windows-appcontainer-executor.test.ts tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts tests/unit/workspace-write-lease.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run audit:repository"
  - "bun run check:affected --plan"
  - "bun run imports:freeze"
---

# Active Documentation Corpus V1

本包以 machine authority registry 替换历史编号和路径 catch-all，原子迁移全部 active prose，并把旧正文按 latest main bytes 归档。它同时完成 PR #174 合并后的控制面 readback，但不实现 Issues #176–#194 的产品能力。Candidate 改变 docs-doctor、active-documentation、Agent coverage 与 Risk selection trust roots，不能由自身实现自证；进入 main 后必须 readback、关闭 Issue #173 并返回 TASK_RESTART_REQUIRED。
