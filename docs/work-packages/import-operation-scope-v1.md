---
schema: codex-development-work-package-v1
id: import-operation-scope-v1
tracking: issue-348
base: 450c9f8764b8159a5463603549af542efdf13869
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: import-operation-scope-cutover
    owner: development-operation-effect-purity-owner
    ownedPaths:
      - docs/development-governance.md
      - docs/roadmap.md
      - docs/work-packages/import-operation-scope-v1.md
      - docs/work-packages/task-capsule-compiler-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - package.json
      - platform/dev-runner.ts
      - platform/dev-runner/check-runner.ts
      - platform/dev-runner/import-organizer.ts
      - platform/shared/ci-execution-environment.ts
      - tests/contract/dev-runner-contract.test.ts
      - tests/contract/documentation-authority.test.ts
      - tests/e2e/import-organizer-staged.test.ts
      - tests/e2e/import-organizer-worktree-isolation.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/import-organizer-selection.test.ts
forbiddenPaths:
  - .agents/skills/
  - .codex/
  - .github/workflows/
  - .githooks/
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - docs/external-provider-policy.md
  - platform/compiler/
  - platform/registry/
  - platform/shared/tcb-closure-lock.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/verification-session-runtime.ts
  - scripts/codex/verification-session.ts
acceptance:
  - imports check apply and freeze are the complete public import command surface and transform remove-unused and staged command aliases have zero production consumers
  - imports check and imports apply compile one immutable exact operation plan containing intent scope exact candidate base sorted targets preimage and replacement digests write set provider revision and one canonical plan digest
  - imports check compares the plan only and imports apply publishes the exact plan write set through the existing canonical lease CAS durable recovery rollback and readback transaction
  - imports check and imports apply default to the exact candidate delta without SEC_IMPORTS_CHANGED_ONLY and accept an explicit full repository scope only through --all
  - candidate selection never falls back to the candidate HEAD as its own base and fails closed unless an explicit exact base trusted SEC_CHANGED_BASE or canonical default merge-base is available
  - exact recovery replay may supply --candidate-base with one full Git object ID and ambiguous all plus candidate-base input is rejected
  - unused removal remains an explicit intent on check or apply and is never mixed into the default sort-and-combine representation operation
  - imports freeze remains a zero-write staged candidate identity seal and its recovery text names imports apply without a compatibility alias
  - check fast affected and full remain compare-only and check full is the sole package script that explicitly selects the full repository import scope
  - true noop publishes zero source index rename chmod and mtime changes and all working-tree writes remain preimage CAS bound
  - one logical run one mutable worktree and one active candidate ref is shown as an executable candidate-control invariant rather than claimed as already enforced
  - the canonical development lifecycle graph uses actual VerificationSession terminal and waiting states and labels implemented activation-pending and planned boundaries without defining a second run state machine
  - issue closeout design makes machine IssueDisposition the sole close writer and partial progress cannot close a focused or Program Issue before exact new-main remaining-work consumer child and provider readback closure
  - rolling work keeps existing Issue owners and orders issue 346 issue 275 issue 312 issue 327 evidence retirement issue 193 and the remaining R14 slices without creating a second roadmap
  - the superseded selected task-capsule manifest is deleted after pointer promotion and no v2 v3 successor worktree or ref is created
  - local validation in this user-directed session is limited to static diff ownership consumer and exact Git object analysis with no test or code gate execution before independent exact-head static Review
tests:
  - tests/unit/import-organizer-selection.test.ts
  - tests/e2e/import-organizer-staged.test.ts
  - tests/e2e/import-organizer-worktree-isolation.test.ts
  - tests/contract/dev-runner-contract.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/unit/ci-evidence-composition-policy-registry.test.ts
---

# Work Package: Import Operation Scope V1

This is the remaining root-cause slice of Issue #348. The earlier cutover made
check/freeze pure and installed the only working-tree writer transaction, but
left the default selector ambient, the authoring command split across three
names, and ordinary apply capable of scanning the entire TypeScript project.

The terminal command surface is `imports:check`, `imports:apply`, and
`imports:freeze`. Check/apply share one compiled plan. Candidate delta is the
safe and fast default; `--all` is explicit. `--remove-unused` selects the
separate TypeScript provider intent, while `--candidate-base <exact-sha>` is
only an exact recovery/replay input. Staged publication remains an internal
mode of `imports:apply --staged`, not a fourth public operation.

This package does not implement TypeScript 7, repository path primitives,
Evidence retirement, dependency adoption, candidate/control, or a second run
coordinator. It records their existing owners and dependency order in the
rolling projection, then leaves each as an independently mergeable vertical
slice from then-current main.
