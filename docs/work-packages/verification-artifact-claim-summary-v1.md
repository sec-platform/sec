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
  - "Embedded gates pass CodexDevelopmentAssertVerificationGateResultV1; claim definitions are reconstructed from exact gate requiredForClaims bindings and the embedded aggregate must equal a fresh CodexDevelopmentAggregateVerificationClaimsV1 result."
  - "Contradictory overall/claim results, status/reason drift, duplicate claim/gate identities, empty pass sets, unknown contributing gates, missing required contributions, and unsupported passed claims remain fail-closed."
  - "When claimSummary is present, legacy summary.status is passed if and only if the canonical recomputed overallStatus is passed; every non-passed unified status projects to failed."
  - "Existing no-claimSummary VerificationReport fixtures remain accepted."
  - "tests/unit/verification-artifact-claim-summary.test.ts proves valid passed and failed current-writer reports classify as passed/failed rather than blocked and adversarial forged aggregate cases classify as blocked."
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
candidate then checked new aggregate fields independently, which could admit an
`overallStatus: passed` aggregate containing a failed claim and would create a second status
lattice inside the artifact adapter.

## Fix boundary

- Extend only the artifact serialization validator and its focused regression surface.
- Reuse `CodexDevelopmentAssertVerificationGateResultV1` for exact embedded gate validation.
- Reconstruct claim definitions from each gate's `requiredForClaims` relation and derive owning
  environment keys from the exact required gate observations.
- Re-run `CodexDevelopmentAggregateVerificationClaimsV1` and require the serialized aggregate
  to match the canonical result, including claim status, reason, coverage, and contributing
  gate identity.
- Reject duplicate, empty, unknown, incomplete, or contradictory claim/gate relationships.
- Derive legacy `summary.status` from the canonical recomputed overall status.
- Preserve legacy summary compatibility for unrelated fixtures during migration.
- Complete the active Work Package handoff atomically by archiving the previous manifest,
  removing its live copy, updating the rolling plan, and rebinding the pointer digest.

## Non-goals

- Issue #215 owning-environment, not-applicable, no-test, and aggregate algorithm correction.
- Issue #176 full writer/Evidence migration.
- CI Evidence V3 or workflow changes.
- Semantic Test Impact, Hermetic Runtime, Evidence DAG, or parallel integration.
