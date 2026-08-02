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
  - "Embedded gates pass CodexDevelopmentAssertVerificationGateResultV1; aggregate and claim results reject status/reason mismatch, contradictory overall status, duplicate claim/gate identities, unresolved contributing gate references, and passed claims unsupported by their contributing gates."
  - "The embedded aggregate follows the declared order-independent lattice failed > invalidated > unsupported > not-run > passed; legacy summary.status is passed if and only if claimSummary.overall.overallStatus is passed."
  - "Existing no-claimSummary VerificationReport fixtures remain accepted."
  - "tests/unit/verification-artifact-claim-summary.test.ts proves passed and failed current-writer reports classify as passed/failed rather than blocked; contradictory, inconsistent, duplicate, unknown-field, and forged-reference claimSummary objects remain blocked."
  - "The previous affected-selection-trust-boundary-v1 manifest is archived, its live manifest is removed, the active pointer and rolling plan identify this package, and repository audit reports no control-plane handoff drift."
  - "Issue #217 is closed only after focused tests, existing semantic-mutation verification adapter tests, typecheck, docs doctor, repository audit, hosted quick evidence, and independent exact-head Review pass."
  - "No changes to verification aggregate execution semantics, runtime/policy writers, CI workflows, package/lock, or canonical product authority."
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
candidate then checked the new aggregate fields independently, which could admit an
`overallStatus: passed` aggregate containing a failed claim. The complete fix therefore must
close both producer/validator shape drift and the contradictory-evidence acceptance path.

## Fix boundary

- Extend only the artifact serialization validator and its focused regression surface.
- Reuse the canonical gate validator from `verification-result-contract.ts`.
- Validate claim result status/reason combinations, unique identities, contributing-gate
  references, aggregate lattice consistency, and the relationship between claims and embedded
  gates without changing the aggregate execution algorithm owned by Issue #215.
- Derive legacy `summary.status` from claimSummary overall status when present.
- Preserve legacy summary compatibility for unrelated fixtures during migration.
- Complete the active Work Package handoff atomically by archiving the previous manifest,
  removing its live copy, updating the rolling plan, and rebinding the pointer digest.

## Non-goals

- Issue #215 owning-environment, not-applicable, no-test, and aggregate algorithm correction.
- Issue #176 full writer/Evidence migration.
- CI Evidence V3 or workflow changes.
- Semantic Test Impact, Hermetic Runtime, Evidence DAG, or parallel integration.
