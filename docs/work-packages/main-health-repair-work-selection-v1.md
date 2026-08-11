---
schema: codex-development-work-package-v1
id: main-health-repair-work-selection-v1
tracking: issue-221
base: eb5cc38382f8b4932e9e47bce45762a7fb97aebc
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: document-control-main-health-reconciliation
    owner: development-document-control-owner
    ownedPaths:
      - docs/work-packages/main-health-repair-work-selection-v1.md
      - docs/work-packages/work-selection-live-projection-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/contract/document-control-plane-lifecycle.test.ts
forbiddenPaths:
  - .agents/
  - .codex/
  - .github/
  - .githooks/
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - package.json
  - platform/compiler/
  - platform/dev-runner/
  - platform/shared/
  - scripts/codex/work-package-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/verification-session.ts
  - scripts/codex/verification-session-runtime.ts
acceptance:
  - the repair is bound to exact main eb5cc38382f8b4932e9e47bce45762a7fb97aebc canonical check run 93934094079 and the two recorded TypeScript diagnostics in document control lifecycle tests
  - the manifest digest assertion explicitly widens the strict parsed pointer digest to the existing producer public string contract while preserving exact string equality and introducing no cast parser or duplicated digest algorithm
  - the same tree index fence assertion compares Buffer bytes through the Buffer equality contract and preserves the original byte exact requirement without weakening the expectation
  - ordinary select next remains fail closed while main is unhealthy and this package is only the maintainer authorized reconciliation of the exact failed test source not a Tier 0 break glass transition or a selector issued repair
  - the candidate changes no Tier 0 or Tier 1 implementation policy selector provider workflow lock or verification contract and fabricates no MainHealth Gate Review or IntegrationAuthorization receipt
  - one logical run uses exactly one mutable worktree branch and candidate ref and no v2 v3 successor or parallel writer is created
  - the completed work selection manifest is retired in this transition while the bounded roadmap candidate topology is preserved byte for byte for the post repair WorkDecision
  - validation is limited to changed path ownership strict diff and digest review mechanical TCB lock generation and independent exact head static Review with no local code test typecheck affected full or hosted Gate execution
  - post merge canonical sec main health is the decisive readback and any non success keeps selection in typed reconcile instead of being overridden or retried blindly
  - the non health critical manifest digest return type and reconcile owner ref improvements remain explicit follow up work for the next healthy main ordinary package and are not smuggled through this repair
tests:
  - tests/contract/document-control-plane-lifecycle.test.ts
---

# Work Package: MainHealth Repair for Work Selection V1

The exact new main produced by PR #359 was correctly rejected by the canonical
MainHealth owner. Check run `93934094079` reported two source diagnostics in
one document-control contract test: a strict digest actual value met a producer
whose public type is plain `string`, and a Vitest generic equality overload
could not compare Node 25 Buffer specializations. This repair widens only the
test matcher generic and uses Buffer's byte equality contract. Runtime behavior
and assertion strength are unchanged.

Normal selection remains fail-closed while MainHealth is unhealthy. This
package is the maintainer-authorized reconciliation of that exact failed test
source, not a selector output and not a Tier 0 break-glass transition. It
preserves the roadmap catalog and candidate order, changes no Tier 0/Tier 1
implementation owner, and relies on the next exact-main `sec/main-health` run
for the only production health readback.

The failure also exposed two useful but non-health-critical follow-ups: the
manifest digest producer should eventually expose its structured return type,
and reconcile decisions should carry their existing owner refs. Those belong
to the next healthy-main ordinary package and are intentionally not authorized
by this repair.
