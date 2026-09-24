---
schema: codex-development-work-package-v1
id: coordinated-repository-closeout
tracking: none
base: 8c6dc289e3fe17b358e6a9c335fbbe092b8ce1ce
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: coordinated-repository-closeout
    owner: repository-closeout-owner
    ownedPaths:
      - src/adapters/providers/git/
      - src/adapters/providers/git-read/
      - src/adapters/self-hosting/
      - src/adapters/filesystem/
      - src/adapters/runtime-state/physical/runtime/process-resource-session.ts
      - src/adapters/runtime-state/physical/runtime/process-resource-session.test.ts
      - src/adapters/verification/platform/ci/runtime/verification-session.ts
      - tests/
      - docs/开发/AI协作/规则装载与任务恢复.md
      - .documentation/
      - config/repository/
      - PROJECT_STATUS.md
forbiddenPaths:
  - LICENSE
  - LICENSES/
  - README.md
acceptance:
  - Git scratch mutation admission counts native root and Windows stdin-worker resource costs before effects and preserves bounded process budgets
  - ordinary authorized repository maintenance has a real successful local-ref deletion path without claiming isolation from noncooperating same-privilege writers
  - exact content reconciliation and active worktree protection remain prerequisites to destructive closeout
  - one physical Git ref owner performs all production local-ref deletion with old-OID CAS and independent ref and worktree readback
  - controlled writers sharing a Git common directory coordinate through the existing lease owner with a consistent lock order
  - closed-unmerged and hosted closeout obtain local coordination before remote destructive effects and retain recovery on unknown outcomes
  - dependency and generated-state owners settle managed worktree locators before physical retirement
  - the authorized repository terminal state is continued through merge readback and classified branch worktree and recovery settlement
tests:
  - src/adapters/providers/git/ref-effect.test.ts
  - tests/unit/closed-unmerged-closeout-production.test.ts
  - tests/unit/branch-supersession-review.test.ts
---

# Coordinated repository closeout

Continue the already-authorized repository settlement after SEC-086 convergence. The canonical maintenance contract owns the guarantee boundary; this package limits implementation scope and does not grant an effect, MainHealth or merge approval. Reuse existing lease, native Git transaction, provider and recovery owners. Do not add a parallel lock manager, weaken known-worktree protection, or recreate permanently unavailable ordinary-success paths.
