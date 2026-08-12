---
schema: codex-development-work-package-v1
id: default-branch-health-repair-421d5544dc51820c4f05cf8011415cf4beada468-29f0234d8afcd2086d0763abcded409ed009d5704d63b24a9ea2a6c3d4313fd5
tracking: none
base: 421d5544dc51820c4f05cf8011415cf4beada468
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - verification-governance
tasks:
  - id: exact-transition-compiler-closure
    owner: verification-test-impact-owner
    ownedPaths:
      - platform/shared/ci-git-changed-files.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/test-runner.test.ts
  - id: static-proof-boundary
    owner: verification-governance-owner
    ownedPaths:
      - docs/verification-governance.md
  - id: generated-trust-closure
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/shared/tcb-closure-lock.ts
      - tests/contract/tcb-closure-lock.test.ts
  - id: durable-plan-and-control
    owner: development-governance-owner
    ownedPaths:
      - docs/work-packages/default-branch-health-repair-9ed0291a0b51b4f3f6769ab317c4cc1a2753cb4b-3f2c46ad9f2ce6b136b42e2bd36aeabc67cd129aa7ec10a4d902df54b1e37b29.md
      - docs/work-packages/default-branch-health-repair-421d5544dc51820c4f05cf8011415cf4beada468-29f0234d8afcd2086d0763abcded409ed009d5704d63b24a9ea2a6c3d4313fd5.md
      - docs/work-packages/default-branch-health-repair-v2.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .agents/skills/
  - .codex/
  - .githooks/
  - .github/workflows/
  - AGENTS.md
  - bun.lock
  - docs/authority.json
  - docs/development-governance.md
  - package.json
  - platform/compiler/
  - scripts/
  - source/
acceptance:
  - the repair binds exact live main 421d5544dc51820c4f05cf8011415cf4beada468 tree 271452d21d0ebca93e6e8e970e901b9a9fc8e118 and reuses MainHealth run 31594263265 job 94105963706 failure fingerprint sha256:c77408f815b84f55456fff13d55dd67902dc3cb1664edf412657d4ee91366004 without rerunning the unchanged failed input
  - the failure is classified as one deterministic TypeScript compilation defect with five diagnostics in the exact-transition slice rather than an environment transient or a reason to expand into the ordinary Issue catalog
  - canonical changed-record normalization returns the single public CodexDevelopmentGitChangedRecordV1 contract across paired and unpaired records so sort and identity logic can consume optional previousPath without a duplicate shadow type unsafe cast or widened runtime shape
  - changed-record validation preserves the canonical repository-path failure class for raw invalid Git identities instead of collapsing path violations into a generic malformed-record result
  - negative transition fixtures explicitly accept arbitrary SHA strings for wrong-base and wrong-blob cases instead of accidentally inheriting literal singleton parameter types from the frozen transition registry
  - affected-test unit fixtures explicitly isolate inherited SEC_AFFECTED_TESTS_BASE and SEC_CHANGED_BASE so a hosted candidate identity cannot alter local fixture topology or command expectations
  - TypeScript compilation is a static contract proof rather than a code test; a TypeScript delta receives exactly one post-delta typecheck before Review while unit integration affected full release and nightly execution remain absent for this user-directed repair
  - independent exact-object Review and compiler proof are non-substitutable authorities; neither may be inferred from the other and a progress merge without one cannot be reported as healthy before exact new-main readback
  - the production repair renderer consumes only the fresh content-addressed MainHealthRepairDecision retires the byte-identical published active projection and preserves the five unresolved candidates byte-for-byte and in order without ordinary WorkDecision or manual pointer staging
  - one logical run retains one mutable physical worktree and one active candidate ref; the merged predecessor ref is removed by exact SHA before this successor ref is created and no v2 v3 or parallel repair branch is introduced
  - automatic trust-epoch rollover remains authoritative and after merge plus exact remote new-main readback the coordinator reorients and continues the machine-selected next work without requiring another user continue message
  - this repair tracks no Issue and does not close or reopen any Issue; Issue completion remains controlled by post-main acceptance and remaining-work evidence rather than PR text or a repair manifest
  - the two published repair manifests from prior health generations have zero remaining source consumers and are deleted in this exact candidate; the only retained nonselected manifest is the byte-exact roadmap predecessor required for the delayed Issue 346 handoff
  - docs doctor derives the complete candidate package census from exact Git objects and reports zero stale or ambiguous Work Package identities; old repair prose is not retained as a compatibility alias archive or second activation entrance
  - exact TCB closure is regenerated once after the final source delta and every generated module blob and raw digest must bind the frozen candidate head
  - the production TCB generator requires the reviewed process-dispatcher allowlist to equal the live causal census exactly and the retired defaultGitFiles authorization is absent from both the static allowlist and generated receipt
  - integration requires one final compiler proof imports check exact-head independent Review authorized single-candidate merge candidate-tree parity remote main pointer and MainHealth readback with no repeated same-input verification
tests:
  - tests/unit/ci-git-changed-files.test.ts
  - tests/unit/test-runner.test.ts
  - tests/contract/ci-lanes.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/documentation-corpus-census.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/tcb-closure-lock.test.ts
---

# Exact-transition TypeScript compiler repair

This package repairs the deterministic compiler failure emitted by the first automatic MainHealth observation of
`main@421d5544dc51820c4f05cf8011415cf4beada468`. The implementation is deliberately smaller than the failed
generation: it closes only the public changed-record type and the negative-fixture parameter domains, then records
the non-substitutable static-proof boundary in the canonical verification owner.

The package tracks no Issue. It does not reinterpret the already-merged generation as healthy, does not reopen or
close roadmap work, and does not start ordinary selection while MainHealth is degraded. The existing production
repair route supplies the only activation identity and the existing worktree is reused as the sole mutable candidate.
