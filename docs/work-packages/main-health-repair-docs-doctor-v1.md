---
schema: codex-development-work-package-v1
id: main-health-repair-docs-doctor-v1
tracking: issue-221
base: 498e8613f9749d3a1fcb6399852ff0206d545a0b
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: active-manifest-consumer-zero-reconciliation
    owner: development-document-control-owner
    ownedPaths:
      - docs/work-packages/issue-disposition-safety-v1.md
      - docs/work-packages/main-health-repair-docs-doctor-v1.md
      - docs/work-packages/main-health-repair-work-selection-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .agents/
  - .codex/
  - .github/
  - .githooks/
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - package.json
  - platform/
  - scripts/
  - source/
  - tests/
acceptance:
  - the repair is bound to exact main 498e8613f9749d3a1fcb6399852ff0206d545a0b and canonical check run 93939281853 where imports check and typecheck passed and the only terminal failure was one docs doctor stale work package finding
  - the exact active directory census contains only issue disposition safety v1 and main health repair work selection v1 before this transaction
  - both published predecessor manifests are deleted and exactly one new selected frozen manifest remains with no tombstone alias archive or tracked evidence copy
  - pointer manifest path and raw digest bind the new manifest while the bounded candidate section and remaining rolling plan tail stay byte identical to the base
  - no code TCB test workflow provider Skill Agent package lock authority registry or docs evidence path changes
  - this package is the maintainer authorized reconciliation of the exact docs doctor failure and is neither selector issued nor Tier 0 break glass nor ordinary Verification authorization
  - one logical run uses exactly one mutable worktree branch and candidate ref with no v2 v3 successor or parallel writer
  - no local code test typecheck affected full docs doctor or hosted Gate is run and exact post merge sec main health is the decisive readback
tests:
  - tests/contract/docs-doctor.test.ts
---

# Work Package: MainHealth Docs Doctor Repair V1

Canonical check run `93939281853` proved that imports and TypeScript were
healthy after the preceding test-source reconciliation, then failed only
because `docs/work-packages/issue-disposition-safety-v1.md` remained beside the
selected package. The active directory census contains exactly that stale
manifest and the now-published selected repair manifest.

This transaction performs the document-control consumer-zero step that should
have accompanied their successors: delete both published predecessors and
install one new frozen reconciliation manifest. It changes no code, TCB,
candidate ordering, Evidence archive, or durable roadmap authority. The next
exact-main `sec/main-health` result is the sole production health readback.
