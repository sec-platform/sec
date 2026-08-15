---
schema: codex-development-work-package-v1
id: delegation-consumer-zero-retirement-v1
tracking: issue-275
base: 0137447c4b3821decfa5a6c332d8e7c5f6587ad6
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - roadmap
  - verification-governance
tasks:
  - id: bounded-heuristic-corpus-convergence
    owner: development-governance-owner
    ownedPaths:
      - .agents/skills/sec-architecture-evolution/SKILL.md
      - .agents/skills/sec-exact-head-review/SKILL.md
      - .agents/skills/sec-external-capability-governance/SKILL.md
      - .agents/skills/sec-failure-recovery/SKILL.md
      - .agents/skills/sec-heuristic-governance/SKILL.md
      - .agents/skills/sec-repository-audit/SKILL.md
      - .agents/skills/sec-task-delegation/SKILL.md
      - .agents/skills/sec-worker-development/SKILL.md
      - .codex/agents/architecture-reviewer.toml
      - .codex/agents/implementation-worker.toml
      - .codex/agents/integration-reviewer.toml
      - .codex/agents/repo-state-auditor.toml
      - .codex/agents/verification-evidence-reviewer.toml
      - AGENTS.md
      - docs/development-governance.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/default-branch-health-repair-f58d7395768283f4e032a8f33543d13f69f81ea5-603fa7978e3894ce8f020d52a288d46f6220e7fb232cd39e1123e9044fb23add.md
      - docs/work-packages/delegation-consumer-zero-retirement-v1.md
      - docs/work-packages/git-worktree-physical-closeout-v1.md
      - tests/contract/agent-skills.test.ts
      - tests/contract/documentation-authority.test.ts
  - id: zero-or-one-runtime-consumer
    owner: agent-operation-read-plan-owner
    ownedPaths:
      - platform/shared/agent-operation-read-plan-contract.ts
      - platform/shared/agent-skill-contract.ts
      - platform/shared/agent-task-capsule-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - scripts/codex/operation-read-plan.ts
      - scripts/codex/skill-applicability.ts
      - tests/contract/operation-read-plan.test.ts
      - tests/contract/skill-applicability.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/agent-operation-activation.test.ts
      - tests/unit/agent-operation-read-plan.test.ts
      - tests/unit/agent-skill-markdown-classification.test.ts
      - tests/unit/agent-task-capsule.test.ts
      - tests/unit/skill-applicability-decision.test.ts
  - id: selected-work-retirement-projection
    owner: roadmap-owner
    ownedPaths:
      - docs/roadmap.md
  - id: hosted-work-selection-credential-boundary
    owner: development-work-selection-owner
    ownedPaths:
      - scripts/codex/work-selection.ts
      - tests/unit/work-selection-live.test.ts
  - id: trusted-closure-regeneration
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/shared/tcb-closure-lock.ts
      - tests/contract/tcb-closure-lock.test.ts
forbiddenPaths:
  - .github/
  - .githooks/
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - package.json
  - platform/compiler/
  - platform/orchestrator/
  - platform/shared/physical-no-follow.ts
  - platform/shared/workspace-write-lease.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/worktree-physical-closeout.ts
  - scripts/run-work-package-gate.ts
  - source/
acceptance:
  - the package is the WorkDecision-selected issue-275 canary bound to exact healthy main 0137447c4b3821decfa5a6c332d8e7c5f6587ad6 tree 449585fe5c3f9717e70f3623664e4475314fa059 and current-spec revision sha256:b8fc75c138ab7541f5a29736e6abf275f191bce6bb5df26fc1182e8e438b88a4
  - the manifest-only draft proposal receives a genuine trusted default-branch PRE before any implementation byte and the exact final head receives a matching FINAL; local refs files comments or self-digests never replace either credential
  - Phase A applicability remains adopted and every ordinary operation deterministically resolves to none-required or exactly one trusted bounded Skill body only after its issuer-bound Task Capsule and Read Plan
  - no invariant maps every repository behavior to one Skill and no catch-all guidance ID is introduced for deterministic responsibilities
  - the proposal retires both completed default-tree Work Package manifests so the candidate package census contains one active package and no stale predecessor
  - trusted hosted Work Selection clears ambient Git credential configuration and uses the canonical gh auth git-credential prefix for both exact default-ref and full branch inventory observations under persist-credentials false
  - branch lifecycle selection admits only branch-bound worktrees; detached exact-main trusted checkouts and detached scratch subjects stay outside ref closeout authority so equivalent hosts rederive one whole WorkDecision value
  - retained Skills contain only trigger and exclusion boundaries required inputs judgement method stop or reconcile outcomes and canonical authority references; schema versions current state exact commands and orchestration algorithms remain in machine owners
  - sec-task-delegation is retired only after its real callers consume the typed Operation and Task Envelope owner and repository census proves consumer zero
  - every .codex agent profile references current docs authority owners and no retired numbered document path or mutable capability assumption remains
  - candidate changes to AGENTS Skill metadata Skill bodies or applicability code remain SUT and cannot guide their own implementation Review Gate or merge
  - semantic tests reject missing stale ambiguous conflicting multiple candidate and candidate-self-guidance paths and prove a normal implementation operation with none-required or one trusted Skill
  - test impact selects the declared agent-operation-read-plan and Skill corpus owner closures without adding a competing mapping or broad unrelated verification
  - the generated TCB lock is updated only through the canonical writer and exact-head independent Review remains separate from local focused verification and hosted Gate
  - after merge exact new-main MainHealth and local remote ref worktree Provider and control-plane readback close the candidate without retaining a second worktree or ref fleet
tests:
  - tests/contract/agent-skills.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/operation-read-plan.test.ts
  - tests/contract/skill-applicability.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/test-impact.test.ts
  - tests/unit/agent-operation-activation.test.ts
  - tests/unit/agent-operation-read-plan.test.ts
  - tests/unit/agent-skill-markdown-classification.test.ts
  - tests/unit/agent-task-capsule.test.ts
  - tests/unit/skill-applicability-decision.test.ts
  - tests/unit/work-selection-live.test.ts
---

# Delegation consumer-zero and bounded heuristic convergence

This package is the first real PRE to FINAL activation canary after the trusted
issuer entered main. It preserves the adopted applicability substrate and
removes only guidance responsibilities whose deterministic consumers are live
and proven. It does not create a general Agent runtime, duplicate task
selection, or convert repository prose into effect authority.

The implementation starts only after the hosted PRE is independently resolved.
Until then this file and the document-control projection are unbound proposal
content with no implementation or mutation authority.
