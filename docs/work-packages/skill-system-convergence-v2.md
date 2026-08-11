---
schema: codex-development-work-package-v1
id: skill-system-convergence-v2
tracking: issue-275
base: 35e5402c11cd478067eed0357f0fb540793ee49f
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: deterministic-guidance-convergence
    owner: development-governance-owner
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
      - .codex/agents/architecture-reviewer.toml
      - .codex/agents/implementation-worker.toml
      - .codex/agents/integration-reviewer.toml
      - .codex/agents/repo-state-auditor.toml
      - .codex/agents/verification-evidence-reviewer.toml
      - docs/development-governance.md
      - docs/roadmap.md
      - docs/work-packages/skill-system-convergence-v2.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/shared/agent-skill-contract.ts
      - scripts/codex/operation-read-plan.ts
      - scripts/codex/repository-audit.ts
      - tests/contract/agent-skills.test.ts
      - tests/contract/documentation-authority.test.ts
      - tests/contract/repository-audit.test.ts
      - tests/contract/skill-applicability.test.ts
      - tests/unit/agent-skill-markdown-classification.test.ts
      - tests/unit/skill-applicability-decision.test.ts
forbiddenPaths:
  - .github/workflows/
  - .githooks/
  - bun.lock
  - package.json
  - docs/authority.json
  - docs/verification-governance.md
  - platform/compiler/
  - platform/dev-runner/
  - platform/registry/
  - platform/shared/agent-operation-read-plan-contract.ts
  - platform/shared/test-impact-rules/
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/skill-applicability.ts
  - scripts/codex/verification-session.ts
  - scripts/codex/verification-session-runtime.ts
acceptance:
  - repository behavior routing distinguishes deterministic machine owners from bounded heuristic Skill owners and no longer requires one Skill per behavior
  - exactly eight current Skill IDs remain seven durable target owners plus transitional task delegation and each owns judgement not yet derivable by a production deterministic contract
  - orientation resume impact selection integration Work Package lifecycle documentation governance toolchain execution and trust transition route to their existing machine owners with canonical references
  - task delegation remains a bounded Skill until Issue 205 provides the real production Task Capsule compiler consumer cutover canary and readback required for deterministic migration
  - all consumers of the nine retired Skill IDs and files are migrated before deletion and no compatibility aliases remain
  - retained Skill prose contains bounded trigger exclusion input judgement stop and authority guidance without retired schema command choreography current-state claims or draft proposal authority
  - Markdown and repository path classification may resolve deterministic surfaces to zero Skills and never manufactures a catch-all guidance owner
  - Codex agent projections reference current canonical authority and contain no retired documentation routes
  - the normal Issue implementation path consumes the merged Operation Read Plan and selects zero or one trusted Skill without reading the retired corpus
  - required repository refs are always included in the Capsule read scope without expanding the Work Package write scope
  - the seven-item throughput architecture remains canonical and records structural budgets one mutable worktree one active ref zero finding-successor worktrees and one physical start per missing ActionKey
  - no local full-project verification or repeated Gate execution occurs; only one final impact-proven focused batch is eligible before independent exact-head Review
tests:
  - tests/unit/skill-applicability-decision.test.ts
  - tests/unit/agent-skill-markdown-classification.test.ts
  - tests/contract/skill-applicability.test.ts
  - tests/contract/agent-skills.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/contract/documentation-authority.test.ts
---

# Work Package: Skill System V2 Convergence

This package delivers the high-value Issue #275 ownership migration while
leaving the issue open for the final delegation cutover after Issue #205. It preserves
the adopted zero-or-one applicability evaluator and removes the false
repository-behavior-to-Skill bijection. Deterministic behavior is routed to its
existing code owner. Eight Skills remain now: seven durable target owners and
the bounded delegation owner that cannot honestly retire before the production
Task Capsule compiler exists.

The package is also the first real post-merge consumer of Issue #346's
Operation Read Plan. That canary is evidence for #346, not permission to close
#346 before three distinct operations, including the maintainer-mutation case,
have completed.

The first canary exposed a trusted-base ownership conflation: the resolver
required `docs/authority.json` but admitted reads only from Work Package
`ownedPaths`. The correction derives read scope from immutable required refs as
well as owned paths; it does not grant write authority to those refs.

## Root-cause and performance closure

The recurring delay came from four independent amplification factors:

1. reading stable machine rules again as Skill prose;
2. manufacturing one guidance owner for every deterministic behavior;
3. selecting broad tests from path-level catch-all ownership;
4. preserving retired guidance and its prose-sentinel tests as consumers.

The cutover removes those causes at their owner boundary. It does not add a
registry, coordinator, cache, runtime or second verification pipeline. Time
budgets remain measurements owned by #316; this package enforces the structural
budgets that are deterministic now: one mutable worktree, one active ref, zero
finding-successor worktrees, and one physical execution for each unique missing
ActionKey.

## Verification value rule

A local action is useful only when its result can change one of: implementation
choice, exact-diff acceptance, independent Review readiness, or merge legality.
Fresh proof, unchanged deterministic failure, release-only Full, duplicated
local/hosted coverage and checks invalidated by an imminent rewrite are not
executed. The final candidate receives one impact-proven focused batch; the
independent Reviewer remains a separate exact-head action.
