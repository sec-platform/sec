---
schema: codex-development-work-package-v1
id: main-health-repair-fast-contracts-v1
tracking: issue-221
base: 7bab4faa3a4e251c39a423d2b89769950573d0b1
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: main-health-observation-validity
    owner: verification-control-plane-maintainer
    ownedPaths:
      - platform/shared/main-health-contract.ts
      - platform/shared/tcb-closure-lock.ts
      - tests/unit/main-health-contract.test.ts
  - id: ordinary-main-health-observation
    owner: development-work-selection-owner
    ownedPaths:
      - scripts/codex/work-selection.ts
  - id: integration-closeout-contract-consumer
    owner: development-integration-closeout-owner
    ownedPaths:
      - tests/contract/ci-contract.test.ts
  - id: agent-skill-contract-consumers
    owner: development-governance-owner
    ownedPaths:
      - AGENTS.md
      - tests/contract/skill-applicability.test.ts
  - id: current-control-projection-reconciliation
    owner: development-document-control-owner
    ownedPaths:
      - docs/work-packages/main-health-repair-docs-doctor-v1.md
      - docs/work-packages/main-health-repair-fast-contracts-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .agents/
  - .codex/
  - .github/
  - .githooks/
  - bun.lock
  - docs/authority.json
  - docs/development-governance.md
  - docs/evidence/
  - docs/roadmap.md
  - docs/verification-governance.md
  - package.json
  - source/
acceptance:
  - the repair is bound to exact main 7bab4faa3a4e251c39a423d2b89769950573d0b1 and canonical check run 93941027024 where imports check typecheck and docs authority passed and exactly six fast contract tests failed
  - the canonical MainHealth lane decision exposes structured observation validity and reason code so valid lane denial is distinguishable from invalid expired or identity drift without duplicating owner logic in consumers
  - Work Selection calls the canonical MainHealth lane resolver only with literal ordinary and never selects proposal only repair while a valid degraded ledger remains an unhealthy reconciliation fact and invalid or locked observation remains unresolved
  - the merge workflow contract consumes the current Issue disposition closeout step identity without changing the workflow or its effect topology
  - the Agent router and rolling projection retain their exact required navigation and authority markers without becoming a second product architecture or selection owner
  - the Skill ambiguity fixture authorizes both candidate metadata write surfaces and the quarantine fixture derives a real last changing commit pair rather than assuming the current HEAD parent changed the Skill contract
  - the published docs doctor repair manifest is deleted and exactly one new selected frozen manifest remains with pointer raw digest binding and no tombstone alias archive or tracked Evidence copy
  - the MainHealth ledger status identity digest lane eligibility and effect semantics do not change and the canonical TCB generator updates only the exact reviewed closure identities without module or edge expansion
  - no workflow Skill package lock authority registry roadmap verification governance or docs evidence path changes
  - one logical run uses exactly one mutable worktree branch and candidate ref with no v2 v3 successor or parallel writer
  - no local code test typecheck affected full docs doctor or hosted Gate is run and independent exact head static Review plus exact post merge sec main health are the only new assurance steps
tests:
  - tests/contract/agent-skills.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/default-branch-revision-health.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/skill-applicability.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/unit/main-health-contract.test.ts
  - tests/unit/work-selection-contract.test.ts
  - tests/unit/work-selection-live.test.ts
---

# Work Package: MainHealth Fast Contract Reconciliation V1

Canonical check run `93941027024` is the reusable failure observation. It
proved that imports, TypeScript, and documentation authority are healthy, then
reported six deterministic direct-consumer failures in the fast inventory.

The production defect is an authority-boundary violation: Work Selection chose
the proposal-only repair lane when the exact-main ledger was degraded. The
canonical lane decision previously collapsed valid lane denial and invalid
freshness or identity into the same unstructured locked result. This package
adds owner-defined observation validity, restores the ordinary-only production
route, and preserves a valid degraded ledger as an unhealthy reconciliation
fact without duplicating MainHealth validation in the adapter. The remaining
failures are stale direct contracts or fixtures: one renamed workflow step,
two missing navigation markers, an incomplete ambiguity scope, and a quarantine
test coupled to the incidental current `HEAD^` delta.

The transaction replaces the published predecessor manifest, keeps the bounded
candidate topology unchanged, and creates no second planner, compatibility
alias, evidence archive, or repair-lane effect path.
