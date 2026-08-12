---
schema: codex-development-work-package-v1
id: main-health-repair-unbound-vocabulary-v1
tracking: issue-346
base: 56285ba26b776f12dd2a93c4d9908366d997d13a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: align-unbound-planning-contract-assertions
    owner: development-governance-owner
    ownedPaths:
      - docs/development-governance.md
      - tests/unit/agent-operation-read-plan.test.ts
      - tests/unit/agent-task-capsule.test.ts
  - id: current-control-projection-reconciliation
    owner: development-document-control-owner
    ownedPaths:
      - docs/work-packages/main-health-repair-tcb-closure-single-owner-v1.md
      - docs/work-packages/main-health-repair-unbound-vocabulary-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .agents/
  - .codex/
  - .github/workflows/
  - .githooks/
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - docs/roadmap.md
  - package.json
  - platform/
  - scripts/
  - source/
acceptance:
  - the repair is bound to exact main 56285ba26b776f12dd2a93c4d9908366d997d13a and canonical MainHealth run 31548322778 job 93965413087 where imports TypeScript and documentation authority passed
  - the complete-fast failure receipt identifies one exact concurrent batch with 101 passing tests and only two named negative contract cases whose production calls both rejected the invalid input
  - Task Capsule remains unbound-planning-content with effectAuthority none and scopeGrantId null and no production contract adapter workflow capability or authority behavior changes
  - the Read Plan negative assertion uses the canonical Capsule read proposal vocabulary rather than claiming a trusted scope before an issuer-bound receipt exists
  - the Task Capsule negative assertion uses the canonical proposed write path vocabulary rather than claiming authorization from a scope proposal
  - development governance requires diagnostics fixtures and negative tests to preserve the same authority level as the production object and permits trusted authorized or granted vocabulary only after a real typed authority transition
  - the exact unchanged-input failure receipt is reused and no local code test typecheck affected full docs doctor candidate product CLI or hosted Gate is run
  - the published predecessor manifest is deleted and exactly one new selected frozen manifest remains with pointer raw digest binding and no tombstone alias tracked Evidence or second plan
  - one logical run uses exactly one mutable worktree branch and candidate ref with no v2 v3 successor or parallel writer
  - independent exact-head static Review plus exact post-merge MainHealth are the only new assurance steps and Issue 346 remains open for the issuer-bound activation and three real-operation canary slice
tests:
  - tests/contract/documentation-authority.test.ts
  - tests/unit/agent-operation-read-plan.test.ts
  - tests/unit/agent-task-capsule.test.ts
---

# MainHealth unbound-planning vocabulary repair

This package changes no production behavior. It aligns two negative contract assertions with the existing
unbound Task Capsule authority model and records the invariant in the canonical development-governance owner.
The exact hosted failure tail is the focused reproduction and is not rerun locally.
