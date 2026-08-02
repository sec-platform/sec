---
schema: codex-development-work-package-v1
id: verification-artifact-claim-summary-v1
tracking: issue-217
base: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: verification-artifact-claim-summary
    owner: verification-artifact-contract-worker
    ownedPaths:
      - platform/shared/product-verification-profile.ts
      - platform/shared/verification-artifact-contract.ts
      - tests/unit/verification-artifact-claim-summary.test.ts
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/verification-artifact-claim-summary-v1.md
      - docs/work-packages/affected-selection-trust-boundary-v1.md
      - docs/archive/work-packages/affected-selection-trust-boundary-v1.md
forbiddenPaths:
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - AGENTS.md
  - README.md
  - platform/shared/verification-result-contract.ts
  - platform/shared/verification-types.ts
  - platform/shared/ci-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/compiler/verify/verify-project.ts
  - platform/compiler/verify/run-runtime-verification.ts
  - platform/compiler/verify/run-policy-gate.ts
  - platform/orchestrator/
  - scripts/codex/
  - scripts/ci-verification.ts
  - scripts/ci-pr-risk.ts
  - .github/workflows/
  - docs/authority.json
  - docs/work/current-state.yaml
  - source/
  - project/
  - control/
  - tests/e2e/
acceptance:
  - "platform/shared/verification-artifact-contract.ts accepts both the legacy summary shape and the current summary shape with claimSummary; no other unknown summary keys are accepted."
  - "platform/shared/product-verification-profile.ts is the external current-writer definition for the exact product gate IDs, claim IDs, gate/claim inventory, lane-to-gate projection, and claim definitions consumed by artifact validation."
  - "The artifact cannot define the inventory that proves its own completeness: missing an entire gate and claim, adding an unknown identity, changing requiredForClaims, or clearing supportedClaims on a passed required gate is rejected."
  - "Embedded gates pass CodexDevelopmentAssertVerificationGateResultV1 and must exactly match an independent reconstruction from the serialized fast, runtime, and policy reports."
  - "Contradictory overall/claim results, status/reason drift, duplicate identities, empty pass sets, unknown contributions, incomplete inventory, lane/gate contradictions, and unsupported passed claims remain fail-closed."
  - "When claimSummary is present, legacy summary.status is passed if and only if the independently reconstructed overallStatus is passed; every non-passed unified status projects to failed."
  - "Existing no-claimSummary VerificationReport fixtures remain accepted."
  - "tests/unit/verification-artifact-claim-summary.test.ts proves valid passed and failed current-writer reports classify as passed/failed rather than blocked and all known information-loss attacks classify as blocked."
  - "The previous affected-selection-trust-boundary-v1 manifest is archived, its live manifest is removed, the active pointer and rolling plan identify this package, and repository audit reports no control-plane handoff drift."
  - "Issue #217 is closed only after focused tests, existing semantic-mutation verification adapter tests, typecheck, docs doctor, repository audit, hosted quick evidence, and independent exact-head Review pass."
  - "Issue #215 remains the sole owner of owning-environment, not-applicable, no-test, and aggregate algorithm semantics; this package does not duplicate or alter that algorithm."
tests:
  - tests/unit/verification-artifact-claim-summary.test.ts
  - tests/unit/semantic-mutation-verification-adapter.test.ts
---

# verification-artifact-claim-summary-v1

Issue #217. Repair the exact canonical artifact validator after VerificationReport gained
the optional claim-based summary in PR #211.

## Root cause

The canonical writer now emits `summary.claimSummary`, and `VerificationReport` declares it,
but `exactVerificationReport()` still accepted only the legacy three-key summary. The first
candidate then let the artifact self-declare the gate/claim inventory used to prove its own
completeness. A forged artifact could remove an entire required gate and claim, clear
`supportedClaims`, or contradict the serialized lane reports while preserving a recomputed
green aggregate.

## Fix boundary

- Add one shared `product-verification-profile` as the external current-writer definition for
  product gate and claim identity, complete inventory, lane projection, and claim definitions.
- Keep strict schema validation through `CodexDevelopmentAssertVerificationGateResultV1`.
- Independently reconstruct the expected fast/runtime/policy gates and aggregate from the
  serialized lane reports instead of deriving completeness from the artifact itself.
- Require the serialized claim summary to equal the exact reconstructed current-writer summary.
- Reject duplicate, empty, unknown, incomplete, unsupported, or contradictory relationships.
- Derive legacy `summary.status` from the independently reconstructed overall status.
- Preserve legacy summary compatibility for unrelated fixtures during migration.
- Complete the active Work Package handoff atomically by archiving the previous manifest,
  removing its live copy, updating the rolling plan, and rebinding the pointer digest.

## Non-goals

- Issue #215 owning-environment, not-applicable, no-test, and aggregate algorithm correction.
- Issue #176 full writer/Evidence migration.
- CI Evidence V3 or workflow changes.
- Semantic Test Impact, Hermetic Runtime, Evidence DAG, or parallel integration.
